import { type PlanFeature } from '@ventafacil/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { cargarAcceso, hasFeature } from '../lib/subscription.js';

/**
 * `requireFeature('reportes_avanzados')` — preHandler que cierra una pantalla que no
 * entra en el plan del negocio.
 *
 * Va DESPUÉS de `requireAuth` en el array de preHandlers, porque necesita el token ya
 * verificado. Es imprescindible tenerlo en el servidor: ocultar el botón en el
 * frontend no impide llamar al endpoint a mano.
 */
export const subscriptionPlugin = fp(async (app) => {
  app.decorate('requireFeature', (feature: PlanFeature) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      if (!req.authUser) {
        return reply.code(401).send({ data: null, error: 'No autorizado' });
      }
      const access = await cargarAcceso(req.authUser.businessId);
      if (hasFeature(access, feature)) return;
      return reply.code(402).send({
        data: null,
        error: `Esta función no está incluida en tu plan ${access.plan?.name ?? ''}.`.trim(),
        code: 'plan_feature',
        feature,
      });
    };
  });
});
