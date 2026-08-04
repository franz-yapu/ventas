import { crearNegocio, slugDisponible } from '@ventafacil/db';
import {
  MENSAJE_SLUG,
  registerSchema,
  TRIAL_DAYS,
  validarSlug,
} from '@ventafacil/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../env.js';
import { emitirToken, limpiarTokensViejos } from '../lib/auth-tokens.js';
import { enviarCorreo, urlDelNegocio } from '../lib/mailer.js';

/**
 * Registro self-service: un negocio desconocido se da de alta solo.
 *
 * Vive fuera de `authRoutes` porque no requiere sesión de nadie y porque es el único
 * endpoint público que ESCRIBE en la base sin tenant. Toda la lógica del alta está en
 * `crearNegocio()` (@ventafacil/db), compartida con el CLI.
 */
export async function registerRoutes(app: FastifyInstance) {
  // Tope estricto: sin él, este endpoint llena la base de negocios basura.
  const limite = {
    rateLimit: { max: env.registerRateLimitMax, timeWindow: env.registerRateLimitWindow },
  };

  /**
   * GET /register/slug?slug=mi-negocio — ¿está libre esta dirección?
   *
   * Consultable sin límite estricto porque el formulario la llama mientras se teclea.
   * Sí revela qué subdominios existen, cosa que de todos modos revela el propio DNS.
   */
  app.get('/register/slug', async (req, reply) => {
    const q = z.object({ slug: z.string().max(60) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ data: null, error: 'Falta el slug' });

    // Se normaliza a minúsculas antes de validar: los hostnames no distinguen
    // mayúsculas, así que rechazar "Mi-Tienda" sería pedantería. Se devuelve el slug
    // ya normalizado para que el formulario enseñe la dirección que va a quedar.
    const slug = q.data.slug.toLowerCase().trim();
    const problema = validarSlug(slug);
    if (problema) {
      return reply.send({
        data: { slug, disponible: false, motivo: MENSAJE_SLUG[problema] },
        error: null,
      });
    }
    const libre = await slugDisponible(slug);
    return reply.send({
      data: {
        slug,
        disponible: libre,
        motivo: libre ? null : 'Esa dirección ya está ocupada. Prueba con otra.',
      },
      error: null,
    });
  });

  /** POST /register — crea el negocio y devuelve a dónde tiene que entrar. */
  app.post('/register', { config: limite }, async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ data: null, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
    }
    const d = parsed.data;
    const slug = d.slug.toLowerCase().trim();
    const email = d.email.toLowerCase().trim();

    const problema = validarSlug(slug);
    if (problema) return reply.code(400).send({ data: null, error: MENSAJE_SLUG[problema] });
    if (!(await slugDisponible(slug))) {
      return reply
        .code(409)
        .send({ data: null, error: 'Esa dirección ya está ocupada. Prueba con otra.' });
    }

    let creado;
    try {
      creado = await crearNegocio({
        name: d.businessName.trim(),
        slug,
        adminName: d.adminName.trim(),
        adminUsername: d.username.toLowerCase().trim(),
        adminPasswordHash: await argon2.hash(d.password),
        adminEmail: email,
        // El esquema ya exige `acceptTerms: true`, así que llegar aquí implica que se
        // aceptaron; se pasa explícito para que quede claro de dónde sale la constancia.
        aceptaTerminos: d.acceptTerms,
      });
    } catch (e) {
      // Dos altas simultáneas con el mismo slug: la segunda choca contra el índice
      // único. Se traduce a un mensaje que la persona entiende.
      if (String(e).includes('business_slug_unique')) {
        return reply
          .code(409)
          .send({ data: null, error: 'Esa dirección ya está ocupada. Prueba con otra.' });
      }
      throw e;
    }

    // Verificación del correo. NO bloquea: el negocio ya puede vender. Verificar es lo
    // que después permite recuperar la contraseña, y ése es el incentivo honesto.
    const { token } = await emitirToken(
      creado.adminId,
      creado.businessId,
      'email_verify',
      env.verifyTokenTtlHours * 3_600_000,
    );
    const enlace = urlDelNegocio(slug, `/verificar?token=${token}`);

    await enviarCorreo(
      {
        to: email,
        subject: `Confirma tu correo de ${d.businessName.trim()}`,
        text:
          `Hola ${d.adminName.trim()}:\n\n` +
          `Tu negocio "${d.businessName.trim()}" ya está listo en VentaFácil.\n\n` +
          `Entra aquí: ${urlDelNegocio(slug)}\n` +
          `Tu usuario: ${d.username.toLowerCase().trim()}\n\n` +
          `Confirma tu correo para poder recuperar la contraseña si algún día la olvidas:\n` +
          `${enlace}\n\n` +
          `El enlace vale ${env.verifyTokenTtlHours} horas.\n\n` +
          `Tienes ${TRIAL_DAYS} días de prueba gratis. No hace falta tarjeta.`,
      },
      app.log,
    );

    // Aprovecha el alta para barrer tokens caducados: sin cron que pueda dejar de correr.
    limpiarTokensViejos().catch((e) => app.log.warn({ err: e }, 'limpieza de tokens'));

    app.log.info({ slug, businessId: creado.businessId }, 'negocio registrado');

    // No se devuelve token de sesión: la app del negocio vive en OTRO origen (su
    // subdominio) y el almacenamiento del navegador no se comparte entre orígenes.
    // Se devuelve a dónde ir, y allí inicia sesión.
    return reply.code(201).send({
      data: {
        businessId: creado.businessId,
        slug,
        url: urlDelNegocio(slug),
        username: d.username.toLowerCase().trim(),
        trialDays: TRIAL_DAYS,
      },
      error: null,
    });
  });
}
