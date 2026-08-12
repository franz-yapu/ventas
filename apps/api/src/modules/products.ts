import { db, schema, withTenant, type TenantTx } from '@ventafacil/db';
import { upsertProductSchema } from '@ventafacil/shared';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { borrar as borrarArchivo, ErrorDeArchivo, guardar, MAX_BYTES } from '../lib/almacen.js';
import { sinCostos, sinCostosEnJson } from '../lib/costos.js';
import { violaUnica } from '../lib/pg-errores.js';
import { canActOnLocation, NINGUNA_UBICACION, viewScope } from '../lib/scope.js';
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
  /**
   * Stock **donde mira quien pregunta**, no donde se dio de alta el producto.
   *
   * Es la diferencia entera entre que el multi-sucursal funcione o no. Antes el stock
   * salía de la ubicación DUEÑA del producto, así que el vendedor de una sucursal veía
   * el stock de la central —o, si el producto era de otra sucursal, no veía el producto
   * en absoluto—. Una sucursal con 57 unidades en su bodega recibía una lista vacía.
   */
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

    /*
      El catálogo es DEL NEGOCIO; el stock es de cada sucursal.

      Antes se filtraba por `product.locationId`, la ubicación que dio de alta el
      producto, y eso rompía el multi-sucursal de raíz: el vendedor de Sucursal Norte,
      con 57 unidades en 6 productos en su propia bodega, recibía `items: []` — también
      buscando por SKU—, porque esos productos los había creado la central. No podía
      vender.

      La tabla `inventory` ya estaba modelada por ubicación, así que el modelo correcto
      estaba a medio hacer: un producto es del negocio y su existencia es de cada local.
      `product.locationId` se queda, pero para lo único que significa de verdad: **quién
      lo administra** (ver `canManage` más abajo). No para quién lo ve.
    */
    const filters = [eq(schema.product.businessId, user.businessId)];
    const scope = viewScope(user);
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
    /*
      ¿El stock de qué ubicación se enseña? La de quien mira.

      - Un vendedor o un encargado de sucursal ven la suya, y no pueden pedir otra.
      - Un admin de la central ve la suya por defecto, y puede mirar la de cualquier
        sucursal con `?locationId=`, que es lo que necesita para reponer.

      Sin ubicación asignada se usa `NINGUNA_UBICACION`, que es un uuid válido que no
      casa con ninguna fila: el `leftJoin` deja el stock en null en vez de reventar.
    */
    const ubicacionDeStock = scope ?? q.locationId ?? user.locationId ?? NINGUNA_UBICACION;

    /**
     * Una sucursal ve SU surtido, no el del negocio entero.
     *
     * El catálogo sigue siendo del negocio —por eso una sucursal ve lo que dio de alta la
     * central, que es lo que arregló el multi-sucursal en su día—, pero lo que le aparece
     * es lo que tiene en su bodega: basta con que exista su fila de inventario.
     *
     * Sin esto, una sucursal recién abierta veía en el POS los 29 productos del negocio
     * con «stock —», ninguno suyo: el cajero los tocaba, los metía al carrito y cobraba
     * mercadería que no estaba en su local. El servidor ahora rechaza esa venta, pero el
     * arreglo de verdad es no ofrecer lo que no se puede vender.
     *
     * La CENTRAL no se filtra: es quien reparte, y necesita ver el catálogo entero para
     * mandar mercadería a donde falta.
     *
     * Va en `filters` —y no en el JOIN— para que la CUENTA salga igual de filtrada: si el
     * total contara todo el catálogo mientras la lista trae sólo lo suyo, la sucursal
     * vería un «Cargar más» que no trae nada.
     */
    /*
      Quien no tiene ubicación asignada queda fuera de esta regla, a propósito: no tiene
      surtido que filtrar. Sigue viendo el catálogo sin existencias de nadie, que es lo
      que ya se decidió para ese caso —y vender no puede igualmente, porque la venta se
      registra en la ubicación de quien cobra y él no tiene ninguna.
    */
    if (!user.isCentral && user.locationId) {
      filters.push(
        inArray(
          schema.product.id,
          db
            .select({ id: schema.inventory.productId })
            .from(schema.inventory)
            .where(
              and(
                eq(schema.inventory.businessId, user.businessId),
                eq(schema.inventory.locationId, ubicacionDeStock),
              ),
            ),
        ),
      );
    }
    const where = and(...filters);

    const { rows, count } = await withTenant(user.businessId, async (tx) => {
      const rows = await tx
        .select(productSelect)
        .from(schema.product)
        .leftJoin(schema.location, eq(schema.location.id, schema.product.locationId))
        .leftJoin(
          schema.inventory,
          and(
            eq(schema.inventory.productId, schema.product.id),
            eq(schema.inventory.locationId, ubicacionDeStock),
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

    // Marca qué productos puede gestionar este usuario (su propia ubicación), y le
    // quita lo que no le toca ver.
    const items = rows.map((r) => ({
      ...sinCostos(r, user),
      canManage: canActOnLocation(user, r.locationId),
    }));
    return reply.send({
      data: { items, total: count?.n ?? 0, page: q.page, limit: q.limit },
      error: null,
    });
  });

  // GET /products/:id/history — historial de acciones del producto (auditoría).
  app.get('/products/:id/history', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = req.authUser!;
    /*
      El producto es del negocio, así que su historial se puede consultar desde
      cualquier sucursal: quien lo vende necesita saber cuándo cambió de precio.

      Lo que NO se abre es el movimiento de las demás: las ventas que trae este
      historial siguen filtradas por `scope` más abajo, igual que en `/sales`. Mirar la
      ficha del producto es trabajo; mirar cuánto vendió el local de al lado es
      supervisar, y eso es del administrador.
    */
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
    //
    // El `after` de un alta es la fila ENTERA del producto, y el de una edición son las
    // dos versiones completas: el costo viajaba aquí de contrabando, en una ruta que el
    // vendedor sí puede abrir (necesita ver su movimiento diario). Se limpia al final,
    // sobre la línea de tiempo ya fusionada, para que ningún origen futuro se escape.
    const merged = [...auditRows, ...saleEntries]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 50)
      .map((e) => ({
        ...e,
        before: sinCostosEnJson(e.before, user),
        after: sinCostosEnJson(e.after, user),
      }));
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
      if (violaUnica(e, 'product_business_sku_uq')) {
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

      /*
        La cuota del plan también se aplica aquí.

        `POST /products` la comprobaba y esto no, así que un plan con tope de 500
        productos se llenaba con 600 subiendo un archivo: el límite sólo existía por la
        puerta pequeña. Se comprueba el lote ENTERO antes de insertar nada, en vez de ir
        cortando a mitad — dejar 500 productos dentro y 100 fuera, sin decir cuáles, es
        peor que no importar.
      */
      if (!(await permiteCrear(user.businessId, 'products', reply, body.data.rows.length))) {
        return reply;
      }

      /*
        Cada fila rechazada dice POR QUÉ y en qué línea del archivo iba.

        Antes era `catch { skipped++ }`: la respuesta decía "87 saltadas" y ahí terminaba.
        Con un archivo de 5.000 filas eso es inservible — no hay forma de saber cuáles ni
        de arreglarlas, así que lo único que queda es volver a intentarlo entero y esperar.

        `fila` es el número de línea EN EL ARCHIVO, no el índice del lote: quien está
        corrigiendo mira una hoja de cálculo, no nuestro JSON.
      */
      let created = 0;
      const errores: Array<{ fila: number; sku?: string; nombre?: string; motivo: string }> = [];

      for (const [i, row] of body.data.rows.entries()) {
        const { locationId: _l, initialStock, minStock, ...productData } = row;
        /*
          Posición DENTRO DEL LOTE, base 1. La traducción a la fila del archivo la hace
          quien envía: es el único que sabe qué filas se saltó por venir mal, y por tanto
          el único que puede acertar. El servidor no puede inventarse esa correspondencia.
        */
        const fila = i + 1;
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
        } catch (e) {
          errores.push({
            fila,
            sku: productData.sku,
            nombre: productData.name,
            motivo: violaUnica(e, 'product_business_sku_uq')
              ? `Ya existe un producto con el código ${productData.sku}`
              : 'No se pudo guardar esta fila',
          });
          // Lo inesperado al log del servidor: ahí puede mirarlo quien sabe qué hacer.
          if (!violaUnica(e, 'product_business_sku_uq')) req.log.error(e, 'importando producto');
        }
      }

      await app.audit(req, {
        action: 'import',
        entity: 'product',
        after: { created, saltadas: errores.length },
      });
      return reply.send({
        data: { created, skipped: errores.length, errores },
        error: null,
      });
    },
  );

  /**
   * La foto del producto.
   *
   * ## Por qué el cuerpo va en crudo y no como formulario
   *
   * Sube los bytes tal cual, con el `Content-Type` de la imagen. Lo normal sería
   * `multipart/form-data`, que aquí significaría añadir `@fastify/multipart`: una
   * dependencia más, y encima de las que parsean archivos que llegan de fuera —justo la
   * clase de librería por la que hace cuatro días se echó `xlsx` de este repositorio.
   *
   * No hace falta. Lo que sube el navegador es UN blob, no un formulario con campos, y
   * mandarlo como cuerpo es más simple en los dos lados. El precio es el analizador de
   * contenido de abajo, que son cuatro líneas.
   *
   * ## Lo que protege
   *
   * El `Content-Type` lo elige quien sube, así que por sí solo no vale nada: `lib/almacen.ts`
   * comprueba los primeros bytes del archivo antes de escribir nada. Y el tope de cuerpo va
   * a nivel de ruta porque el de Fastify son 1 MB y el nuestro son 2.
   */
  const TIPOS_DE_IMAGEN = ['image/webp', 'image/jpeg', 'image/png'];
  app.addContentTypeParser(TIPOS_DE_IMAGEN, { parseAs: 'buffer' }, (_req, body, done) =>
    done(null, body),
  );

  app.post(
    '/products/:id/image',
    {
      preHandler: [app.requireAuth, app.requireAdmin],
      // Un poco por encima del tope real, para que el mensaje que explica el límite salga
      // de `almacen.ts` —que dice cuántos MB son— en vez del 413 pelado de Fastify.
      bodyLimit: MAX_BYTES + 1024,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const user = req.authUser!;

      const tipo = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
      const datos = req.body;
      if (!Buffer.isBuffer(datos) || datos.byteLength === 0) {
        return reply.code(400).send({ data: null, error: 'No llegó ninguna imagen.' });
      }

      const antes = await withTenant(user.businessId, async (tx) => {
        const [p] = await tx
          .select()
          .from(schema.product)
          .where(and(eq(schema.product.id, id), eq(schema.product.businessId, user.businessId)))
          .limit(1);
        return p ?? null;
      });
      if (!antes) return reply.code(404).send({ data: null, error: 'Producto no encontrado' });
      if (!canActOnLocation(user, antes.locationId)) {
        return reply
          .code(403)
          .send({ data: null, error: 'Sólo puedes editar productos de tu propia ubicación' });
      }

      let guardada: { url: string; bytes: number };
      try {
        guardada = await guardar(user.businessId, datos, tipo);
      } catch (e) {
        if (e instanceof ErrorDeArchivo)
          return reply.code(400).send({ data: null, error: e.message });
        throw e;
      }

      const [after] = await withTenant(user.businessId, (tx) =>
        tx
          .update(schema.product)
          .set({ imageUrl: guardada.url })
          .where(eq(schema.product.id, id))
          .returning(),
      );

      /*
        La anterior se borra DESPUÉS de que la nueva esté escrita y apuntada.

        Al revés —borrar y luego guardar— un fallo en medio deja el producto apuntando a un
        archivo que ya no existe: un hueco roto en la rejilla del POS, y sin forma de
        recuperarlo. Así, lo peor que puede pasar es un archivo huérfano ocupando 60 kB.
      */
      await borrarArchivo(user.businessId, antes.imageUrl);

      await app.audit(req, {
        action: 'update',
        entity: 'product',
        entityId: id,
        before: { imageUrl: antes.imageUrl },
        after: { imageUrl: guardada.url, bytes: guardada.bytes },
      });
      return reply.send({ data: after, error: null });
    },
  );

  app.delete(
    '/products/:id/image',
    { preHandler: [app.requireAuth, app.requireAdmin] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const user = req.authUser!;

      const antes = await withTenant(user.businessId, async (tx) => {
        const [p] = await tx
          .select()
          .from(schema.product)
          .where(and(eq(schema.product.id, id), eq(schema.product.businessId, user.businessId)))
          .limit(1);
        return p ?? null;
      });
      if (!antes) return reply.code(404).send({ data: null, error: 'Producto no encontrado' });
      if (!canActOnLocation(user, antes.locationId)) {
        return reply
          .code(403)
          .send({ data: null, error: 'Sólo puedes editar productos de tu propia ubicación' });
      }

      const [after] = await withTenant(user.businessId, (tx) =>
        tx
          .update(schema.product)
          .set({ imageUrl: null })
          .where(eq(schema.product.id, id))
          .returning(),
      );
      await borrarArchivo(user.businessId, antes.imageUrl);

      await app.audit(req, {
        action: 'update',
        entity: 'product',
        entityId: id,
        before: { imageUrl: antes.imageUrl },
        after: { imageUrl: null },
      });
      return reply.send({ data: after, error: null });
    },
  );
}
