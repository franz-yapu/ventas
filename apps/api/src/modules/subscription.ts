import { db, schema } from '@ventafacil/db';
import { trialDaysLeft } from '@ventafacil/shared';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { cargarAcceso, usoDelPlan } from '../lib/subscription.js';

export async function subscriptionRoutes(app: FastifyInstance) {
  /**
   * GET /subscription/me — plan, estado y cupos del negocio del token.
   *
   * De aquí sale todo lo que el frontend necesita: el banner de "te quedan 3 días",
   * la pantalla de bloqueo y qué menús mostrar. Está en la lista de rutas libres, así
   * que un negocio bloqueado también puede consultarla — si no, no podría enterarse
   * de por qué está bloqueado.
   */
  app.get('/subscription/me', { preHandler: app.requireAuth }, async (req, reply) => {
    const access = await cargarAcceso(req.authUser!.businessId);
    const usage = await usoDelPlan(access);

    return reply.send({
      data: {
        plan: access.plan,
        status: access.subscription?.status ?? null,
        blocked: access.blocked,
        trialEndsAt: access.subscription?.trialEndsAt ?? null,
        trialDaysLeft: trialDaysLeft(access.subscription?.trialEndsAt),
        currentPeriodEnd: access.subscription?.currentPeriodEnd ?? null,
        features: access.plan?.features ?? null,
        usage,
      },
      error: null,
    });
  });

  /**
   * GET /plans — catálogo público. Sin autenticación: lo consumen la página de
   * precios y la pantalla de bloqueo, y no expone nada de ningún negocio.
   */
  app.get('/plans', async (_req, reply) => {
    const rows = await db
      .select({
        code: schema.plan.code,
        name: schema.plan.name,
        description: schema.plan.description,
        priceMonthly: schema.plan.priceMonthly,
        currency: schema.plan.currency,
        maxLocations: schema.plan.maxLocations,
        maxUsers: schema.plan.maxUsers,
        maxProducts: schema.plan.maxProducts,
        features: schema.plan.features,
      })
      .from(schema.plan)
      .where(eq(schema.plan.isPublic, true))
      .orderBy(asc(schema.plan.sortOrder));
    return reply.send({ data: rows, error: null });
  });
}
