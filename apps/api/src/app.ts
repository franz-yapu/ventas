import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { API_PREFIX } from '@ventafacil/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { resolve } from 'node:path';
import { db } from '@ventafacil/db';
import { sql } from 'drizzle-orm';
import { env, originPermitido } from './env.js';
import { avisarDeError } from './lib/alertas.js';
import { authPlugin } from './plugins/auth.js';
import { auditPlugin } from './plugins/audit.js';
import { platformAuthPlugin } from './plugins/platform-auth.js';
import { subscriptionPlugin } from './plugins/subscription.js';
import { analyticsRoutes } from './modules/analytics.js';
import { auditRoutes } from './modules/audit.js';
import { authRoutes } from './modules/auth.js';
import { dashboardConfigRoutes } from './modules/dashboard-config.js';
import { exportRoutes } from './modules/export.js';
import { inventoryRoutes } from './modules/inventory.js';
import { businessRoutes } from './modules/business.js';
import { cashRoutes } from './modules/cash.js';
import { categoryRoutes } from './modules/categories.js';
import { customerRoutes } from './modules/customers.js';
import { locationRoutes } from './modules/locations.js';
import { platformRoutes } from './modules/platform.js';
import { productRoutes } from './modules/products.js';
import { registerRoutes } from './modules/register.js';
import { reportRoutes } from './modules/reports.js';
import { saleRoutes } from './modules/sales.js';
import { subscriptionRoutes } from './modules/subscription.js';
import { userRoutes } from './modules/users.js';
import { esIdInvalido } from './lib/pg-errores.js';
import './types.js';

/**
 * Construye la app sin escucharla. Separado de index.ts para que los tests puedan
 * levantarla en memoria (app.inject) sin abrir un puerto.
 */
export async function buildApp(
  opts: { logger?: boolean; loginRateLimitMax?: number; exportRateLimitMax?: number } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : env.nodeEnv === 'development'
          ? { transport: { target: 'pino-pretty' } }
          : true,
  });

  // Tope del login de esta instancia. Por defecto el de la configuración; los tests que
  // prueban el limitador levantan su propia app con el valor real.
  app.decorate('loginRateLimitMax', opts.loginRateLimitMax ?? env.loginRateLimitMax);
  app.decorate('exportRateLimitMax', opts.exportRateLimitMax ?? env.exportRateLimitMax);

  /*
    Cabeceras de seguridad. Se desactiva la CSP global: este servicio responde JSON y, desde
    que hay fotos de producto, imágenes — nunca HTML, así que una política de contenido
    global no protege nada y sí puede estorbar.

    Lo que SÍ importa de helmet aquí es `X-Content-Type-Options: nosniff`, y ahora más que
    antes: `/media` sirve archivos que suben los clientes. Sin nosniff, un archivo que
    empiece como imagen y siga como HTML podría acabar interpretado por el navegador desde
    NUESTRO dominio. La otra mitad de esa defensa vive en `lib/almacen.ts`, que comprueba
    los primeros bytes en vez de fiarse del `Content-Type` que declara quien sube; y la
    tercera, en la CSP propia que `/media` se pone abajo.
  */
  await app.register(helmet, { contentSecurityPolicy: false });

  // Con un subdominio por cliente, los orígenes no se pueden enumerar: `CORS_ORIGINS`
  // admite comodín (`https://*.ventafacil.com`) y aquí se resuelve por petición.
  await app.register(cors, {
    origin:
      env.corsOrigins === true
        ? true
        : (origin, cb) => {
            // Sin cabecera Origin (curl, healthchecks, la propia app en el servidor).
            if (!origin) return cb(null, true);
            cb(null, originPermitido(origin, env.corsOrigins as string[]));
          },
    credentials: true,
  });

  /*
    Tope global por IP. Los límites finos van por ruta (ver /auth/login).

    `/media` queda FUERA de este cubo y tiene el suyo, más abajo. El motivo: estas 600 por
    minuto se dimensionaron cuando este servicio «sólo respondía JSON, nunca HTML», y una
    tienda entera —las tabletas y la caja— sale por UNA sola IP. Desde que se sirven fotos,
    una rejilla de POS pide una imagen por producto y un admin navegando el catálogo
    recién fotografiado dispara cientos: el cupo se gastaba mirando fotos y el `POST /sales`
    siguiente volvía con un 429. O sea, el cajero sin poder cobrar por culpa de unas
    miniaturas — y como los 429 de las imágenes se ven como fotos rotas, nada en pantalla
    lo explicaba.
  */
  await app.register(rateLimit, {
    max: env.rateLimitMax,
    timeWindow: env.rateLimitWindow,
    allowList: (req) => {
      const url = req.raw.url ?? '';
      return url === '/media' || url.startsWith('/media/');
    },
    // Mensaje en el formato { data, error } que usa el resto del API.
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      data: null,
      error: `Demasiadas peticiones. Reintenta en ${Math.ceil(context.ttl / 1000)} s.`,
    }),
  });

  await app.register(authPlugin);
  await app.register(platformAuthPlugin);
  await app.register(auditPlugin);
  await app.register(subscriptionPlugin);

  /**
   * Manejador de errores único.
   *
   * Sin esto, un fallo no controlado sale con el formato de Fastify y **con el mensaje
   * crudo dentro**: un error de Postgres llegaba al navegador diciendo qué columna y
   * qué tipo falló. Eso le regala a cualquiera un mapa del esquema, y encima rompe el
   * formato `{ data, error }` que espera el cliente.
   *
   * Los errores por debajo de 500 (validación, límite de peticiones, 404) sí llevan un
   * mensaje útil para quien llama, así que se conservan; sólo se tapa el 500.
   */
  app.setErrorHandler((err: Error & { statusCode?: number; error?: unknown }, req, reply) => {
    const status = err.statusCode ?? 500;

    /*
      Un identificador mal formado es culpa de quien pregunta, no del servidor.

      Un `:id` que no es un uuid llega hasta Postgres y allí revienta con 22P02. Antes eso
      salía como 500: código equivocado, entrada de "error no controlado" en el log, y un
      aviso por correo — así que bastaba un rastreador probando URLs para llenar el buzón
      de operación con avisos de algo que no está roto. Se atiende aquí, en un solo sitio,
      porque afecta a todas las rutas con parámetro y seguirá afectando a las que vengan.
    */
    if (esIdInvalido(err)) {
      return reply.code(400).send({ data: null, error: 'Identificador no válido' });
    }

    if (status >= 500) {
      req.log.error({ err }, 'error no controlado');
      // Además del log, un aviso: nadie mira un log a las 3 de la tarde de un martes.
      avisarDeError(err, `${req.method} ${req.routeOptions?.url ?? req.url}`, app.log);
      return reply.code(500).send({ data: null, error: 'Error interno del servidor' });
    }
    // Debajo de 500 el mensaje SÍ le sirve a quien llama. Algunas piezas (el limitador
    // de peticiones) ya lanzan un cuerpo con el formato de la casa; se respeta el suyo.
    const mensaje = typeof err.error === 'string' ? err.error : err.message;
    return reply.code(status).send({ data: null, error: mensaje });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ data: null, error: 'Ruta no encontrada' }),
  );

  /**
   * Health check para el monitor de uptime.
   *
   * Comprueba la BASE DE DATOS, no sólo que el proceso responda: un API que contesta
   * "ok" con la base caída es exactamente el falso positivo que hace inútil un monitor.
   * Devuelve 503 cuando algo falla, que es lo que dispara la alerta.
   */
  app.get('/health', async (_req, reply) => {
    const t0 = performance.now();
    try {
      await db.execute(sql`select 1`);
    } catch (e) {
      app.log.error({ err: e }, 'health: la base de datos no responde');
      return reply.code(503).send({
        data: { status: 'error', db: 'no responde' },
        error: 'Base de datos no disponible',
      });
    }
    return reply.send({
      data: {
        status: 'ok',
        db: 'ok',
        dbMs: Math.round(performance.now() - t0),
        uptimeSeg: Math.round(process.uptime()),
      },
      error: null,
    });
  });

  /**
   * Las fotos de producto, servidas desde el disco.
   *
   * Va FUERA del prefijo `/api/v1` a propósito: son archivos, no una API, y la URL que se
   * guarda en `product.image_url` es la que acaba en un `<img src>` — cuanto más corta y
   * más estable, mejor.
   *
   * - **Caché para siempre.** El nombre lleva un uuid y cambia al reemplazar la foto (ver
   *   `lib/almacen.ts`), así que el archivo bajo una URL dada nunca cambia. Sin esto, cada
   *   apertura del POS volvería a pedir las mismas veinte imágenes por la conexión de una
   *   tienda.
   * - **Sin listado de directorio**: la carpeta de un negocio no es asunto de otro.
   * - **CSP propia**, aunque la global esté apagada: si algún día se cuela un archivo que
   *   el navegador quiera interpretar, que no pueda cargar ni ejecutar nada.
   */
  await app.register(async (media) => {
    /*
      Su propio cubo, no barra libre.

      Quedan fuera del tope global (ver `allowList` arriba) porque no pueden competir con
      el cobro, pero dejarlas sin ningún contador abriría la única puerta del servicio que
      sirve archivos. Se les da diez veces el cupo del API: sobra para la ráfaga real —una
      pantalla de POS son ~24 miniaturas, y el `immutable` de abajo hace que sólo se pidan
      la primera vez— y sigue habiendo un techo.
    */
    media.addHook(
      'onRequest',
      app.rateLimit({
        max: env.rateLimitMax * 10,
        timeWindow: env.rateLimitWindow,
        // `allowList: () => false` no es redundante: un limitador creado con
        // `app.rateLimit()` HEREDA las opciones globales, incluida la lista de exenciones
        // — que es justo la que deja fuera a `/media`. Sin esta línea, este tope se
        // eximía a sí mismo y las fotos se quedaban sin ningún contador.
        allowList: () => false,
      }),
    );

    /*
      La CSP va en un hook y no en `setHeaders` del plugin: esa opción está tipada como si
      recibiera un `FastifyReply` cuando en tiempo de ejecución recibe la respuesta cruda de
      Node, así que lo que compila no es lo que corre. Un hook no tiene esa ambigüedad.

      `nosniff` no se repite aquí: lo pone helmet para todas las respuestas, y este plugin
      cuelga del mismo servidor.
    */
    media.addHook('onSend', async (_req, reply) => {
      reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
      /*
        `cross-origin` aquí, y no es un descuido de seguridad: es lo que hace que las fotos
        se vean.

        Helmet pone `Cross-Origin-Resource-Policy: same-origin` para todo, que es el valor
        correcto para una API que devuelve datos del negocio. Pero la web y el API son
        orígenes DISTINTOS —dominios distintos en producción, puertos distintos en local—,
        así que con ese valor el navegador bloquea cada `<img>` con
        `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin` y el catálogo entero sale sin fotos.

        No lo vio ningún test —`app.inject` no aplica políticas de navegador, y ahí las
        cabeceras eran perfectas— ni el typecheck. Se descubrió abriendo la pantalla.

        Lo que se abre es sólo esto: archivos que ya son públicos por diseño (cualquiera
        con la URL los ve; la URL lleva un uuid y no se puede adivinar). Las respuestas de
        `/api/v1` siguen con el `same-origin` de helmet.
      */
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    });
    await media.register(fastifyStatic, {
      root: resolve(env.mediaDir),
      prefix: '/media/',
      index: false,
      list: false,
      cacheControl: true,
      maxAge: '365d',
      immutable: true,
    });
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(registerRoutes);
      await api.register(platformRoutes);
      await api.register(subscriptionRoutes);
      await api.register(businessRoutes);
      await api.register(exportRoutes);
      await api.register(categoryRoutes);
      await api.register(productRoutes);
      await api.register(locationRoutes);
      await api.register(userRoutes);
      await api.register(inventoryRoutes);
      await api.register(customerRoutes);
      await api.register(saleRoutes);
      await api.register(cashRoutes);
      await api.register(reportRoutes);
      await api.register(analyticsRoutes);
      await api.register(dashboardConfigRoutes);
      await api.register(auditRoutes);
    },
    { prefix: API_PREFIX },
  );

  return app;
}
