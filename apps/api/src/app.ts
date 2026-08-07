import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { API_PREFIX } from '@ventafacil/shared';
import Fastify, { type FastifyInstance } from 'fastify';
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

  // Cabeceras de seguridad. Se desactiva CSP: este servicio sólo responde JSON, nunca
  // HTML, así que una política de contenido no protege nada y sí puede estorbar.
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

  // Tope global por IP. Los límites finos van por ruta (ver /auth/login).
  await app.register(rateLimit, {
    max: env.rateLimitMax,
    timeWindow: env.rateLimitWindow,
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
