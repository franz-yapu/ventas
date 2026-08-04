import fastifyJwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../env.js';
import { tokenSigueValiendo, vigenciaDelUsuario } from '../lib/sessions.js';
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
      const payload = await req.jwtVerify<
        AuthUser & { typ?: 'access' | 'refresh'; tv?: number }
      >();
      if (payload.typ === 'refresh') throw new Error('refresh token no valido para acceso');

      // El token puede estar bien firmado y aun así no valer: al usuario lo dieron de
      // baja, o cambió su contraseña y se cortaron las sesiones. Se comprueba contra
      // una caché de 60 s, así que echar a alguien surte efecto en menos de un minuto
      // sin pagar una consulta por petición.
      const vigencia = await vigenciaDelUsuario(payload.businessId, payload.sub);
      if (!tokenSigueValiendo(vigencia, payload.tv)) {
        throw new Error('sesión revocada o usuario inactivo');
      }

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
