import { db, schema } from '@ventafacil/db';
import { cancelSaleSchema, createSaleSchema, syncSalesSchema } from '@ventafacil/shared';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { persistSale } from '../lib/sales-service.js';
import { canActOnLocation, viewScope } from '../lib/scope.js';

const historyQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  locationId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  status: z.enum(['completed', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function saleRoutes(app: FastifyInstance) {
  // POST /sales — venta online (misma logica que usara el sync offline en Fase 2).
  app.post('/sales', { preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = createSaleSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ data: null, error: parsed.error.issues[0]?.message });
    }
    const { businessId, sub: userId, locationId, isCentral } = req.authUser!;

    let result;
    try {
      result = await db.transaction((tx) =>
        persistSale(tx, { businessId, userId, locationId, isCentral }, parsed.data),
      );
    } catch (e) {
      if (String(e).includes('LOCATION_SCOPE')) {
        return reply.code(403).send({ data: null, error: 'Sólo puedes vender en tu propia ubicación' });
      }
      throw e;
    }

    if (!result.duplicated) {
      await app.audit(req, {
        action: 'sale',
        entity: 'sale',
        entityId: result.saleId,
        after: { receiptNumber: result.receiptNumber, total: parsed.data.total },
      });
    }
    return reply.code(result.duplicated ? 200 : 201).send({ data: result, error: null });
  });

  // POST /sales/sync — sincronizacion en lote de ventas offline. Responde POR ITEM.
  // Idempotente: si un UUID ya existe, no duplica y devuelve su recibo.
  app.post('/sales/sync', { preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = syncSalesSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ data: null, error: 'Lote invalido' });
    }
    const { businessId, sub: userId, locationId, isCentral } = req.authUser!;

    const results = [];
    for (const sale of parsed.data.sales) {
      try {
        const r = await db.transaction((tx) =>
          persistSale(tx, { businessId, userId, locationId, isCentral }, sale),
        );
        if (!r.duplicated) {
          await app.audit(req, {
            action: 'sale',
            entity: 'sale',
            entityId: r.saleId,
            after: { receiptNumber: r.receiptNumber, total: sale.total, synced: true },
          });
        }
        results.push({
          id: sale.id,
          status: r.duplicated ? 'duplicated' : 'ok',
          receiptNumber: r.receiptNumber,
        });
      } catch (e) {
        req.log.error(e, 'error sincronizando venta');
        results.push({ id: sale.id, status: 'error', error: String(e) });
      }
    }
    return reply.send({ data: { results }, error: null });
  });

  // GET /sales — historial con filtros.
  app.get('/sales', { preHandler: app.requireAuth }, async (req, reply) => {
    const parsedQ = historyQuery.safeParse(req.query);
    if (!parsedQ.success) {
      return reply.code(400).send({ data: null, error: 'Parámetros inválidos' });
    }
    const q = parsedQ.data;
    const user = req.authUser!;
    const businessId = user.businessId;

    const filters = [eq(schema.sale.businessId, businessId)];
    // Alcance por ubicación: sucursal ve sólo la suya; central ve todas.
    const scope = viewScope(user);
    if (scope !== undefined) filters.push(eq(schema.sale.locationId, scope));
    if (q.from) filters.push(gte(schema.sale.clientCreatedAt, new Date(q.from)));
    if (q.to) filters.push(lte(schema.sale.clientCreatedAt, new Date(q.to)));
    if (q.locationId) filters.push(eq(schema.sale.locationId, q.locationId));
    if (q.userId) filters.push(eq(schema.sale.userId, q.userId));
    if (q.status) filters.push(eq(schema.sale.status, q.status));
    const where = and(...filters);

    const [rows, [count]] = await Promise.all([
      db
        .select({
          id: schema.sale.id,
          receiptNumber: schema.sale.receiptNumber,
          total: schema.sale.total,
          status: schema.sale.status,
          paymentMethod: schema.sale.paymentMethod,
          clientCreatedAt: schema.sale.clientCreatedAt,
          locationName: schema.location.name,
          sellerName: schema.appUser.name,
          customerName: schema.customer.name,
        })
        .from(schema.sale)
        .leftJoin(schema.location, eq(schema.location.id, schema.sale.locationId))
        .leftJoin(schema.appUser, eq(schema.appUser.id, schema.sale.userId))
        .leftJoin(schema.customer, eq(schema.customer.id, schema.sale.customerId))
        .where(where)
        .orderBy(desc(schema.sale.clientCreatedAt))
        .limit(q.limit)
        .offset((q.page - 1) * q.limit),
      db
        .select({
          n: sql<number>`count(*)::int`,
          sum: sql<string>`COALESCE(SUM(${schema.sale.total}), 0)::text`,
        })
        .from(schema.sale)
        .where(where),
    ]);

    return reply.send({
      // sumTotal = suma de "total" de TODAS las ventas que cumplen el filtro (no sólo la página).
      data: { items: rows, total: count?.n ?? 0, sumTotal: count?.sum ?? '0', page: q.page, limit: q.limit },
      error: null,
    });
  });

  // GET /sales/:id — detalle para el recibo.
  app.get('/sales/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const businessId = req.authUser!.businessId;
    // Alcance: la sucursal sólo puede leer el detalle de ventas de su ubicación.
    const scope = viewScope(req.authUser!);

    const [sale] = await db
      .select({
        id: schema.sale.id,
        receiptNumber: schema.sale.receiptNumber,
        status: schema.sale.status,
        subtotal: schema.sale.subtotal,
        discount: schema.sale.discount,
        total: schema.sale.total,
        paymentMethod: schema.sale.paymentMethod,
        clientCreatedAt: schema.sale.clientCreatedAt,
        locationName: schema.location.name,
        sellerName: schema.appUser.name,
        customerName: schema.customer.name,
      })
      .from(schema.sale)
      .leftJoin(schema.location, eq(schema.location.id, schema.sale.locationId))
      .leftJoin(schema.appUser, eq(schema.appUser.id, schema.sale.userId))
      .leftJoin(schema.customer, eq(schema.customer.id, schema.sale.customerId))
      .where(
        and(
          eq(schema.sale.id, id),
          eq(schema.sale.businessId, businessId),
          scope !== undefined ? eq(schema.sale.locationId, scope) : undefined,
        ),
      )
      .limit(1);
    if (!sale) return reply.code(404).send({ data: null, error: 'Venta no encontrada' });

    const items = await db
      .select()
      .from(schema.saleItem)
      .where(eq(schema.saleItem.saleId, id));

    return reply.send({ data: { ...sale, items }, error: null });
  });

  // POST /sales/:id/cancel — solo admin, exige motivo, registra en audit_log.
  app.post('/sales/:id/cancel', { preHandler: [app.requireAuth, app.requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = cancelSaleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ data: null, error: 'Motivo requerido (min 3)' });
    const businessId = req.authUser!.businessId;

    const [before] = await db
      .select()
      .from(schema.sale)
      .where(and(eq(schema.sale.id, id), eq(schema.sale.businessId, businessId)))
      .limit(1);
    if (!before) return reply.code(404).send({ data: null, error: 'Venta no encontrada' });
    if (!canActOnLocation(req.authUser!, before.locationId)) {
      return reply.code(403).send({ data: null, error: 'Sólo puedes cancelar ventas de tu ubicación' });
    }
    if (before.status === 'cancelled') {
      return reply.code(409).send({ data: null, error: 'La venta ya está cancelada' });
    }

    // Cancelar = status='cancelled' (nunca se borra) + devolver stock a la ubicación.
    const after = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(schema.sale)
        .set({ status: 'cancelled', cancelledReason: parsed.data.reason, cancelledBy: req.authUser!.sub })
        .where(and(eq(schema.sale.id, id), eq(schema.sale.businessId, businessId)))
        .returning();

      // Sólo devolvemos stock si la venta estaba completada (descontó al vender).
      if (before.status === 'completed') {
        const items = await tx.select().from(schema.saleItem).where(eq(schema.saleItem.saleId, id));
        for (const it of items) {
          if (!it.productId) continue;
          await tx
            .update(schema.inventory)
            .set({ quantity: sql`${schema.inventory.quantity} + ${it.quantity}` })
            .where(
              and(
                eq(schema.inventory.businessId, businessId),
                eq(schema.inventory.productId, it.productId),
                eq(schema.inventory.locationId, before.locationId),
              ),
            );
        }
      }
      return row;
    });

    await app.audit(req, {
      action: 'cancel',
      entity: 'sale',
      entityId: id,
      before: { status: before.status },
      after: { status: 'cancelled', reason: parsed.data.reason },
    });
    return reply.send({ data: after, error: null });
  });
}
