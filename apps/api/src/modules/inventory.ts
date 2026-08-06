import { schema, withTenant } from '@ventafacil/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { canAdjustInventory, filtroDeUbicacion } from '../lib/scope.js';

export async function inventoryRoutes(app: FastifyInstance) {
  // GET /inventory — stock por producto y ubicación (alcance por ubicación visible).
  app.get('/inventory', { preHandler: app.requireAuth }, async (req, reply) => {
    const q = z.object({ locationId: z.string().uuid().optional() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ data: null, error: 'Parámetros inválidos' });
    const user = req.authUser!;
    const businessId = user.businessId;

    const filters = [eq(schema.inventory.businessId, businessId)];
    // La sucursal queda fijada a la suya; la central sí puede elegir una por parámetro.
    const alcance = filtroDeUbicacion(user, schema.inventory.locationId);
    if (alcance) filters.push(alcance);
    else if (q.data.locationId) filters.push(eq(schema.inventory.locationId, q.data.locationId));

    const rows = await withTenant(businessId, (tx) =>
      tx
        .select({
          id: schema.inventory.id,
          productId: schema.inventory.productId,
          productName: schema.product.name,
          sku: schema.product.sku,
          locationId: schema.inventory.locationId,
          locationName: schema.location.name,
          quantity: schema.inventory.quantity,
          minStock: schema.inventory.minStock,
        })
        .from(schema.inventory)
        .innerJoin(schema.product, eq(schema.product.id, schema.inventory.productId))
        .innerJoin(schema.location, eq(schema.location.id, schema.inventory.locationId))
        .where(and(...filters))
        .orderBy(asc(schema.product.name), asc(schema.location.name)),
    );

    // Marca qué filas puede ajustar (central: cualquiera; sucursal admin: la suya).
    const items = rows.map((r) => ({ ...r, canAdjust: canAdjustInventory(user, r.locationId) }));
    return reply.send({ data: items, error: null });
  });

  // PATCH /inventory/:id — ajustar cantidad/mínimo con MOTIVO obligatorio. Queda en el historial.
  app.patch(
    '/inventory/:id',
    { preHandler: [app.requireAuth, app.requireAdmin] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = z
        .object({
          quantity: z.number().int().optional(),
          minStock: z.number().int().nullable().optional(),
          reason: z.string().min(3, 'El motivo es obligatorio (mín. 3)'),
        })
        .safeParse(req.body);
      if (!parsed.success)
        return reply.code(400).send({ data: null, error: parsed.error.issues[0]?.message });
      const user = req.authUser!;

      const before = await withTenant(user.businessId, async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.inventory)
          .where(and(eq(schema.inventory.id, id), eq(schema.inventory.businessId, user.businessId)))
          .limit(1);
        return row ?? null;
      });
      if (!before) return reply.code(404).send({ data: null, error: 'Registro no encontrado' });
      if (!canAdjustInventory(user, before.locationId)) {
        return reply
          .code(403)
          .send({ data: null, error: 'No puedes ajustar el inventario de esta ubicación' });
      }

      const { reason, ...changes } = parsed.data;
      const [after] = await withTenant(user.businessId, (tx) =>
        tx
          .update(schema.inventory)
          .set(changes)
          .where(and(eq(schema.inventory.id, id), eq(schema.inventory.businessId, user.businessId)))
          .returning(),
      );

      // entityId = productId para que aparezca en el historial del producto.
      await app.audit(req, {
        action: 'stock_adjust',
        entity: 'inventory',
        entityId: before.productId,
        before: { quantity: before.quantity, minStock: before.minStock },
        after: {
          quantity: after!.quantity,
          minStock: after!.minStock,
          locationId: before.locationId,
          reason,
        },
      });
      return reply.send({ data: after, error: null });
    },
  );

  // POST /inventory/transfer — transferir stock entre ubicaciones (admin). Auditado.
  app.post(
    '/inventory/transfer',
    { preHandler: [app.requireAuth, app.requireAdmin] },
    async (req, reply) => {
      const parsed = z
        .object({
          productId: z.string().uuid(),
          fromLocationId: z.string().uuid(),
          toLocationId: z.string().uuid(),
          quantity: z.number().int().positive(),
        })
        .safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ data: null, error: 'Datos inválidos' });
      const { productId, fromLocationId, toLocationId, quantity } = parsed.data;
      if (fromLocationId === toLocationId) {
        return reply.code(400).send({ data: null, error: 'Las ubicaciones deben ser distintas' });
      }
      const user = req.authUser!;
      const businessId = user.businessId;
      if (!canAdjustInventory(user, fromLocationId)) {
        return reply
          .code(403)
          .send({ data: null, error: 'No puedes transferir desde esa ubicación' });
      }

      try {
        await withTenant(businessId, async (tx) => {
          const [from] = await tx
            .select()
            .from(schema.inventory)
            .where(
              and(
                eq(schema.inventory.businessId, businessId),
                eq(schema.inventory.productId, productId),
                eq(schema.inventory.locationId, fromLocationId),
              ),
            )
            .limit(1);
          if (!from || from.quantity < quantity) throw new Error('STOCK_INSUFICIENTE');

          await tx
            .update(schema.inventory)
            .set({ quantity: sql`${schema.inventory.quantity} - ${quantity}` })
            .where(eq(schema.inventory.id, from.id));

          // Crea el registro destino si no existe.
          await tx
            .insert(schema.inventory)
            .values({ businessId, productId, locationId: toLocationId, quantity })
            .onConflictDoUpdate({
              target: [schema.inventory.productId, schema.inventory.locationId],
              set: { quantity: sql`${schema.inventory.quantity} + ${quantity}` },
            });
        });
      } catch (e) {
        if (String(e).includes('STOCK_INSUFICIENTE')) {
          return reply
            .code(409)
            .send({ data: null, error: 'Stock insuficiente en la ubicación de origen' });
        }
        throw e;
      }

      await app.audit(req, {
        action: 'transfer',
        entity: 'inventory',
        entityId: productId,
        after: { fromLocationId, toLocationId, quantity },
      });
      return reply.send({ data: { ok: true }, error: null });
    },
  );
}
