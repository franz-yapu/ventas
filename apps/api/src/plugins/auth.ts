import fastifyJwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../env.js';
import { gateSubscription } from '../lib/subscription.js';
import type { AuthUser } from '../types.js';

/** Registra JWT y expone requireAuth / requireAdmin. */
export const authPlugin = fp(async (app) => {
  await app.register(fastifyJwt, {
    secret: env.jwtAccessSecret,
    sign: { expiresIn: env.jwtAccessTtl },
  });

  app.decorate('requireAuth', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = await req.jwtVerify<AuthUser & { typ?: 'access' | 'refresh' }>();
      if (payload.typ === 'refresh') throw new Error('refresh token no valido para acceso');
      req.authUser = {
        sub: payload.sub,
        businessId: payload.businessId,
        locationId: payload.locationId,
        isCentral: payload.isCentral ?? false,
        role: payload.role,
        name: payload.name,
      };
    } catch {
      return reply.code(401).send({ data: null, error: 'No autorizado' });
    }

    // La suscripción se comprueba aquí y no en cada ruta: así una ruta nueva queda
    // cubierta por el solo hecho de pedir autenticación, sin acordarse de nada.
    return gateSubscription(req, reply);
  });

  app.decorate('requireAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.authUser) {
      return reply.code(401).send({ data: null, error: 'No autorizado' });
    }
    if (req.authUser.role !== 'admin') {
      return reply.code(403).send({ data: null, error: 'Requiere rol admin' });
    }
  });
});
