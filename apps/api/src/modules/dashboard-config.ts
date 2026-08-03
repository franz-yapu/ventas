import { schema, withTenant } from '@ventafacil/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';

const configSchema = z.object({ widgets: z.array(z.string()).max(50) });

export async function dashboardConfigRoutes(app: FastifyInstance) {
  // GET /dashboard-config — layout del usuario (o null -> el front usa el default del registry).
  app.get('/dashboard-config', { preHandler: app.requireAuth }, async (req, reply) => {
    const [row] = await withTenant(req.authUser!.businessId, (tx) =>
      tx
        .select({ widgets: schema.userDashboardConfig.widgets })
        .from(schema.userDashboardConfig)
        .where(eq(schema.userDashboardConfig.userId, req.authUser!.sub))
        .limit(1),
    );
    return reply.send({ data: row?.widgets ?? null, error: null });
  });

  // PUT /dashboard-config — guarda la lista ordenada de widgets activos.
  app.put('/dashboard-config', { preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ data: null, error: 'Config inválida' });
    const { sub: userId, businessId } = req.authUser!;

    await withTenant(businessId, (tx) =>
      tx
        .insert(schema.userDashboardConfig)
        .values({ userId, businessId, widgets: parsed.data.widgets })
        .onConflictDoUpdate({
          target: schema.userDashboardConfig.userId,
          set: { widgets: parsed.data.widgets, updatedAt: new Date() },
        }),
    );
    return reply.send({ data: { widgets: parsed.data.widgets }, error: null });
  });
}
