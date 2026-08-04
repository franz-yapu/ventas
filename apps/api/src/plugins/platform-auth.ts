import fastifyJwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../env.js';
import type { PlatformUser } from '../types.js';

/**
 * Autenticación del panel de plataforma, separada de la de los negocios.
 *
 * Se registra una SEGUNDA instancia de @fastify/jwt con su propio secreto (namespace
 * `platform`). Las dos puertas quedan con llaves distintas:
 *
 *   · Un token de negocio no verifica contra el secreto de plataforma -> `requirePlatform`
 *     lo rechaza aunque alguien consiguiera meterle `typ: 'platform'`.
 *   · Un token de plataforma no verifica contra el secreto de negocio -> no sirve para
 *     entrar a los endpoints del POS, ni siquiera a los de un tenant concreto.
 *
 * Sin esta separación, todo el aislamiento dependería de comprobar un claim; con ella,
 * depende de no tener la llave.
 */
export const platformAuthPlugin = fp(async (app) => {
  // Se registra DESPUÉS de authPlugin: @fastify/jwt cuelga los namespaces de
  // `fastify.jwt`, que crea la primera instancia (la de los negocios).
  await app.register(fastifyJwt, {
    secret: env.jwtPlatformSecret,
    namespace: 'platform',
    jwtVerify: 'platformVerify',
    jwtSign: 'platformSign',
    sign: { expiresIn: env.jwtPlatformTtl },
  });

  // El firmador namespaced vive en `app.jwt.platform`, que los tipos de @fastify/jwt
  // no conocen. Se expone con nombre propio para no repartir casts por los módulos.
  const platformJwt = (app.jwt as unknown as { platform: { sign: (p: object) => string } })
    .platform;
  app.decorate('platformJwt', platformJwt);

  app.decorate('requirePlatform', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = await req.platformVerify<PlatformUser & { typ?: string }>();
      // Cinturón además de los tirantes: la llave ya es distinta, pero el claim se
      // comprueba igual por si algún día ambos secretos se unificaran por error.
      if (payload.typ !== 'platform') throw new Error('no es un token de plataforma');
      req.platformUser = { sub: payload.sub, email: payload.email, name: payload.name };
    } catch {
      return reply.code(401).send({ data: null, error: 'No autorizado' });
    }
  });
});
