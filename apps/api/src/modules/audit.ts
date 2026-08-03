import { schema, withTenant } from '@ventafacil/db';
import { and, desc, eq, gte, ilike, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { viewScope } from '../lib/scope.js';

const listQuery = z.object({
  action: z.string().optional(),
  entity: z.string().optional(),
  userId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  search: z.string().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export async function auditRoutes(app: FastifyInstance) {
  // GET /audit — registro de actividad (solo admin), con filtros y diff before/after.
  app.get('/audit', { preHandler: [app.requireAuth, app.requireAdmin] }, async (req, reply) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ data: null, error: 'Parámetros inválidos' });
    const q = parsed.data;
    const businessId = req.authUser!.businessId;

    const filters = [eq(schema.auditLog.businessId, businessId)];
    // Alcance: un admin de sucursal sólo ve la actividad de su ubicación; la central, toda.
    const scope = viewScope(req.authUser!);
    if (scope !== undefined) filters.push(eq(schema.auditLog.locationId, scope));
    if (q.action) filters.push(eq(schema.auditLog.action, q.action));
    if (q.entity) filters.push(eq(schema.auditLog.entity, q.entity));
    if (q.userId) filters.push(eq(schema.auditLog.userId, q.userId));
    if (q.locationId) filters.push(eq(schema.auditLog.locationId, q.locationId));
    if (q.from) filters.push(gte(schema.auditLog.createdAt, new Date(q.from)));
    if (q.to) filters.push(lte(schema.auditLog.createdAt, new Date(q.to)));
    if (q.search) filters.push(ilike(schema.auditLog.entityId, `%${q.search}%`));
    const where = and(...filters);

    // Ambas consultas comparten transaccion (y por tanto el contexto de tenant). Van
    // en serie a proposito: una transaccion usa UNA conexion, asi que lanzarlas en
    // paralelo no ahorraria nada.
    const { rows, count } = await withTenant(businessId, async (tx) => {
      const rows = await tx
        .select({
          id: schema.auditLog.id,
          action: schema.auditLog.action,
          entity: schema.auditLog.entity,
          entityId: schema.auditLog.entityId,
          before: schema.auditLog.beforeJson,
          after: schema.auditLog.afterJson,
          createdAt: schema.auditLog.createdAt,
          userName: schema.appUser.name,
          locationName: schema.location.name,
        })
        .from(schema.auditLog)
        .leftJoin(schema.appUser, eq(schema.appUser.id, schema.auditLog.userId))
        .leftJoin(schema.location, eq(schema.location.id, schema.auditLog.locationId))
        .where(where)
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(q.limit)
        .offset((q.page - 1) * q.limit);
      const [count] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.auditLog)
        .where(where);
      return { rows, count };
    });

    return reply.send({
      data: { items: rows, total: count?.n ?? 0, page: q.page, limit: q.limit },
      error: null,
    });
  });
}
