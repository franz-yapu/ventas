import { schema, withTenant, type TenantTx } from '@ventafacil/db';
import { upsertProductSchema } from '@ventafacil/shared';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { canActOnLocation, viewScope } from '../lib/scope.js';
import { permiteCrear } from '../lib/subscription.js';

const listQuery = z.object({
  search: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const productSelect = {
  id: schema.product.id,
  locationId: schema.product.locationId,
  locationName: schema.location.name,
  sku: schema.product.sku,
  barcode: schema.product.barcode,
  name: schema.product.name,
  description: schema.product.description,
  categoryId: schema.product.categoryId,
  price: schema.product.price,
  cost: schema.product.cost,
  costWholesale: schema.product.costWholesale,
  imageUrl: schema.product.imageUrl,
  attributes: schema.product.attributes,
  isActive: schema.product.isActive,
  // Stock del producto en su propia ubicación (para mostrarlo en el POS).
  stock: schema.inventory.quantity,
  minStock: schema.inventory.minStock,
};

/**
 * Genera un SKU correlativo por negocio (P000001, P000002…) de forma atómica.
 * Salta números ya usados por SKUs escritos a mano para no colisionar. Corre dentro de una tx.
 */
async function nextProductSku(tx: TenantTx, businessId: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const [row] = await tx
      .update(schema.businessCounter)
      .set({ lastSku: sql`${schema.businessCounter.lastSku} + 1` })
      .where(eq(schema.businessCounter.businessId, businessId))
      .returning({ n: schema.businessCounter.lastSku });
    if (!row) throw new Error('business_counter no inicializado para el negocio');
    const sku = `P${String(row.n).padStart(6, '0')}`;
    const [taken] = await tx
      .select({ id: schema.product.id })
      .from(schema.product)
      .where(and(eq(schema.product.businessId, businessId), eq(schema.product.sku, sku)))
      .limit(1);
    if (!taken) return sku;
  }
  throw new Error('No se pudo generar un SKU automático');
}

/** Devuelve la ubicación si pertenece al negocio y está activa; si no, null. */
async function locationOfBusiness(tx: TenantTx, locationId: string, businessId: string) {
  const [loc] = await tx
    .select({ id: schema.location.id })
    .from(schema.location)
    .where(
      and(
        eq(schema.location.id, locationId),
        eq(schema.location.businessId, businessId),
        eq(schema.location.isActive, true),
      ),
    )
    .limit(1);
  return loc ?? null;
}

export async function productRoutes(app: FastifyInstance) {
  // GET /products — filtrado por ubicación visible (sucursal: la suya; central: todas).
  app.get('/products', { preHandler: app.requireAuth }, async (req, reply) => {
    const parsedQ = listQuery.safeParse(req.query);
    if (!parsedQ.success)
      return reply.code(400).send({ data: null, error: 'Parámetros inválidos' });
    const q = parsedQ.data;
    const user = req.authUser!;

    const filters = [eq(schema.product.businessId, user.businessId)];
    const scope = viewScope(user);
    if (scope !== undefined) filters.push(eq(schema.product.locationId, scope));
    else if (q.locationId) filters.push(eq(schema.product.locationId, q.locationId)); // central puede filtrar
    if (q.categoryId) filters.push(eq(schema.product.categoryId, q.categoryId));
    if (q.search) {
      const like = `%${q.search}%`;
      filters.push(
        or(
          ilike(schema.product.name, like),
          ilike(schema.product.sku, like),
          ilike(schema.product.barcode, like),
        )!,
      );
    }
    const where = and(...filters);

    const { rows, count } = await withTenant(user.businessId, async (tx) => {
      const rows = await tx
        .select(productSelect)
        .from(schema.product)
        .leftJoin(schema.location, eq(schema.location.id, schema.product.locationId))
        // Stock en la ubicación dueña del producto: admin ve el de su oficina, vendedor el de su sucursal.
        .leftJoin(
          schema.inventory,
          and(
            eq(schema.inventory.productId, schema.product.id),
            eq(schema.inventory.locationId, schema.product.locationId),
          ),
        )
        .where(where)
        .orderBy(asc(schema.product.name))
        .limit(q.limit)
        .offset((q.page - 1) * q.limit);
      const [count] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.product)
        .where(where);
      return { rows, count };
    });

    // Marca qué productos puede gestionar este usuario (su propia ubicación).
    const items = rows.map((r) => ({ ...r, canManage: canActOnLocation(user, r.locationId) }));
    return reply.send({
      data: { items, total: count?.n ?? 0, page: q.page, limit: q.limit },
      error: null,
    });
  });

  // GET /products/:id/history — historial de acciones del producto (auditoría).
  app.get('/products/:id/history', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = req.authUser!;
    // Alcance: la sucursal sólo puede ver el historial de productos de su ubicación.
    const scope = viewScope(user);
    const prod = await withTenant(user.businessId, async (tx) => {
      const [p] = await tx
        .select({ locationId: schema.product.locationId })
        .from(schema.product)
        .where(and(eq(schema.product.id, id), eq(schema.product.businessId, user.businessId)))
        .limit(1);
      return p ?? null;
    });
    if (!prod) return reply.code(404).send({ data: null, error: 'Producto no encontrado' });
    if (scope !== undefined && prod.locationId !== scope) {
      return reply
        .code(403)
        .send({ data: null, error: 'No puedes ver el historial de productos de otra ubicación' });
    }
    // 1) Acciones administrativas (alta, edición, ajuste de stock, transferencia, importación).
    const auditRows = await withTenant(user.businessId, (tx) =>
      tx
        .select({
          id: schema.auditLog.id,
          action: schema.auditLog.action,
          entity: schema.auditLog.entity,
          before: schema.auditLog.beforeJson,
          after: schema.auditLog.afterJson,
          createdAt: schema.auditLog.createdAt,
          userName: schema.appUser.name,
        })
        .from(schema.auditLog)
        .leftJoin(schema.appUser, eq(schema.appUser.id, schema.auditLog.userId))
        .where(
          and(
            eq(schema.auditLog.businessId, req.authUser!.businessId),
            eq(schema.auditLog.entityId, id),
          ),
        )
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(50),
    );

    // 2) Ventas del producto: no quedan en audit_log con entityId=producto, así que
    //    las tomamos de sale_item + sale para que el vendedor vea su movimiento diario.
    //    Alcance: la sucursal sólo ve las ventas de su ubicación; la central, todas.
    const saleFilters = [
      eq(schema.saleItem.productId, id),
      eq(schema.sale.businessId, user.businessId),
    ];
    if (scope !== undefined) saleFilters.push(eq(schema.sale.locationId, scope));
    const saleRows = await withTenant(user.businessId, (tx) =>
      tx
        .select({
          id: schema.saleItem.id,
          receiptNumber: schema.sale.receiptNumber,
          quantity: schema.saleItem.quantity,
          lineTotal: schema.saleItem.lineTotal,
          status: schema.sale.status,
          paymentMethod: schema.sale.paymentMethod,
          createdAt: schema.sale.clientCreatedAt,
          userName: schema.appUser.name,
        })
        .from(schema.saleItem)
        .innerJoin(schema.sale, eq(schema.sale.id, schema.saleItem.saleId))
        .leftJoin(schema.appUser, eq(schema.appUser.id, schema.sale.userId))
        .where(and(...saleFilters))
        .orderBy(desc(schema.sale.clientCreatedAt))
        .limit(50),
    );

    const saleEntries = saleRows.map((s) => ({
      id: s.id,
      action: 'sale',
      entity: 'sale',
      before: null as unknown,
      after: {
        receiptNumber: s.receiptNumber,
        quantity: s.quantity,
        lineTotal: s.lineTotal,
        status: s.status,
        paymentMethod: s.paymentMethod,
      } as unknown,
      createdAt: s.createdAt,
      userName: s.userName,
    }));

    // Fusionamos ambos orígenes en una sola línea de tiempo (más recientes primero).
    const merged = [...auditRows, ...saleEntries]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 50);
    return reply.send({ data: merged, error: null });
  });

  // POST /products (sólo central) — la central elige a qué ubicación se asigna
  // (una sucursal o la central) y se siembra su inventario inicial ahí mismo.
  app.post('/products', { preHandler: [app.requireAuth, app.requireAdmin] }, async (req, reply) => {
    const parsed = upsertProductSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ data: null, error: parsed.error.issues[0]?.message });
    const user = req.authUser!;
    if (!user.isCentral)
      return reply.code(403).send({ data: null, error: 'Sólo la central puede crear productos' });

    const { locationId: bodyLocationId, initialStock, minStock, ...productData } = parsed.data;
    const locationId = bodyLocationId ?? user.locationId;
    if (!locationId) return reply.code(400).send({ data: null, error: 'Selecciona una ubicación' });
    if (!(await permiteCrear(user.businessId, 'products', reply))) return reply;
    try {
      const row = await withTenant(user.businessId, async (tx) => {
        // La ubicacion se valida DENTRO de la transaccion: comparte el contexto de
        // tenant y evita que cambie entre la comprobacion y el alta.
        const loc = await locationOfBusiness(tx, locationId, user.businessId);
        if (!loc) return null;
        const sku = productData.sku ?? (await nextProductSku(tx, user.businessId));
        const [p] = await tx
          .insert(schema.product)
          .values({ ...productData, sku, businessId: user.businessId, locationId })
          .returning();
        // Fila de inventario en la ubicación dueña -> el producto aparece en Inventario y es ajustable.
        await tx.insert(schema.inventory).values({
          businessId: user.businessId,
          productId: p!.id,
          locationId,
          quantity: initialStock ?? 0,
          minStock: minStock ?? null,
        });
        return p!;
      });
      if (!row) return reply.code(400).send({ data: null, error: 'Ubicación no válida' });
      await app.audit(req, { action: 'create', entity: 'product', entityId: row.id, after: row });
      return reply.code(201).send({ data: row, error: null });
    } catch (e) {
      if (String(e).includes('product_business_sku_uq')) {
        return reply.code(409).send({ data: null, error: 'Ya existe un producto con ese SKU' });
      }
      throw e;
    }
  });

  // PATCH /products/:id (admin) — sólo productos de la propia ubicación.
  app.patch(
    '/products/:id',
    { preHandler: [app.requireAuth, app.requireAdmin] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const user = req.authUser!;
      const parsed = upsertProductSchema.partial().safeParse(req.body);
      if (!parsed.success)
        return reply.code(400).send({ data: null, error: parsed.error.issues[0]?.message });

      const before = await withTenant(user.businessId, async (tx) => {
        const [p] = await tx
          .select()
          .from(schema.product)
          .where(and(eq(schema.product.id, id), eq(schema.product.businessId, user.businessId)))
          .limit(1);
        return p ?? null;
      });
      if (!before) return reply.code(404).send({ data: null, error: 'Producto no encontrado' });
      if (!canActOnLocation(user, before.locationId)) {
        return reply
          .code(403)
          .send({ data: null, error: 'Sólo puedes editar productos de tu ubicación' });
      }

      // No permitir mover el producto ni tocar el stock por este endpoint
      // (locationId/initialStock/minStock son sólo para el alta; el stock se ajusta en Inventario).
      const {
        locationId: _omitLoc,
        initialStock: _omitStock,
        minStock: _omitMin,
        ...patch
      } = parsed.data as Record<string, unknown>;
      const [after] = await withTenant(user.businessId, (tx) =>
        tx
          .update(schema.product)
          .set({ ...patch, updatedAt: new Date() })
          .where(and(eq(schema.product.id, id), eq(schema.product.businessId, user.businessId)))
          .returning(),
      );

      const action = before.price !== after!.price ? 'price_change' : 'update';
      await app.audit(req, { action, entity: 'product', entityId: id, before, after });
      return reply.send({ data: after, error: null });
    },
  );

  // POST /products/import (sólo central) — la central importa asignando a una ubicación.
  app.post(
    '/products/import',
    { preHandler: [app.requireAuth, app.requireAdmin] },
    async (req, reply) => {
      const body = z
        .object({
          rows: z.array(upsertProductSchema).max(1000),
          locationId: z.string().uuid().optional(),
        })
        .safeParse(req.body);
      if (!body.success) return reply.code(400).send({ data: null, error: 'Filas invalidas' });
      const user = req.authUser!;
      if (!user.isCentral)
        return reply
          .code(403)
          .send({ data: null, error: 'Sólo la central puede importar productos' });

      const locationId = body.data.locationId ?? user.locationId;
      if (!locationId)
        return reply.code(400).send({ data: null, error: 'Selecciona una ubicación' });
      const locOk = await withTenant(user.businessId, (tx) =>
        locationOfBusiness(tx, locationId, user.businessId),
      );
      if (!locOk) return reply.code(400).send({ data: null, error: 'Ubicación no válida' });

      let created = 0;
      let skipped = 0;
      for (const row of body.data.rows) {
        const { locationId: _l, initialStock, minStock, ...productData } = row;
        try {
          await withTenant(user.businessId, async (tx) => {
            const sku = productData.sku ?? (await nextProductSku(tx, user.businessId));
            const [p] = await tx
              .insert(schema.product)
              .values({ ...productData, sku, businessId: user.businessId, locationId })
              .returning();
            await tx.insert(schema.inventory).values({
              businessId: user.businessId,
              productId: p!.id,
              locationId,
              quantity: initialStock ?? 0,
              minStock: minStock ?? null,
            });
          });
          created++;
        } catch {
          skipped++;
        }
      }
      await app.audit(req, { action: 'import', entity: 'product', after: { created, skipped } });
      return reply.send({ data: { created, skipped }, error: null });
    },
  );
}
