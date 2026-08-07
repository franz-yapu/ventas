import { schema, withTenant } from '@ventafacil/db';
import { cancelSaleSchema, createSaleSchema, syncSalesSchema } from '@ventafacil/shared';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { sinCostosLista } from '../lib/costos.js';
import { persistSale } from '../lib/sales-service.js';
import { canCancelSale, filtroDeUbicacion, viewScope } from '../lib/scope.js';

const historyQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  locationId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  status: z.enum(['completed', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Traduce los motivos por los que `persistSale` rechaza una venta.
 *
 * Estaba escrito sólo dentro de `POST /sales`, así que el camino del sync —el que usa el
 * POS cuando vuelve la conexión— serializaba la excepción tal cual y devolvía cosas como
 * `"Error: LOCATION_SCOPE"` al navegador: sin mensaje que enseñarle al cajero, y con el
 * riesgo de filtrar nombres de constraint o de columna si el fallo venía de Postgres.
 *
 * Devuelve `null` cuando el error no es uno de los previstos: eso no se traduce, se deja
 * estallar (o se registra), porque inventarle un mensaje bonito a un fallo desconocido es
 * la forma de que nadie se entere de que existe.
 */
function errorDeVenta(e: unknown): { status: number; error: string; code?: string } | null {
  const s = String(e);
  if (s.includes('LOCATION_SCOPE')) {
    return { status: 403, error: 'Sólo puedes vender en tu propia ubicación' };
  }
  const tope = /DISCOUNT_LIMIT:(\d+)/.exec(s);
  if (tope) {
    return {
      status: 403,
      error: `Como vendedor puedes descontar hasta el ${tope[1]}%. Pide a un administrador que lo autorice.`,
      code: 'discount_limit',
    };
  }
  if (s.includes('PRODUCT_SCOPE')) {
    return { status: 400, error: 'Algún producto de la venta no es de este negocio' };
  }
  return null;
}

export async function saleRoutes(app: FastifyInstance) {
  // POST /sales — venta online (misma logica que usara el sync offline en Fase 2).
  app.post('/sales', { preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = createSaleSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ data: null, error: parsed.error.issues[0]?.message });
    }
    const { businessId, sub: userId, locationId, isCentral, role } = req.authUser!;

    let result;
    try {
      result = await withTenant(businessId, (tx) =>
        persistSale(tx, { businessId, userId, locationId, isCentral, role }, parsed.data),
      );
    } catch (e) {
      const conocido = errorDeVenta(e);
      if (!conocido) throw e;
      const { status, ...cuerpo } = conocido;
      return reply.code(status).send({ data: null, ...cuerpo });
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
    const { businessId, sub: userId, locationId, isCentral, role } = req.authUser!;

    const results = [];
    for (const cruda of parsed.data.sales) {
      /*
        Cada venta se valida por su cuenta.

        El sobre ya no valida el contenido (ver `syncSalesSchema`): antes una sola venta
        mal formada hacía que el lote entero se rechazara con 400 y ninguna de las demás
        subiera. En una PWA que cobra sin conexión, eso es una fila corrupta secuestrando
        el día de trabajo de una caja — reintentando cada 30 segundos, sin que nadie
        entienda por qué. La corrupta sale como `error` con su motivo, y las sanas entran.
      */
      const v = createSaleSchema.safeParse(cruda);
      if (!v.success) {
        const id = (cruda as { id?: unknown })?.id;
        results.push({
          id: typeof id === 'string' ? id : null,
          status: 'error',
          error: v.error.issues[0]?.message ?? 'Venta con datos inválidos',
          code: 'venta_invalida',
        });
        continue;
      }
      const sale = v.data;
      try {
        const r = await withTenant(businessId, (tx) =>
          persistSale(tx, { businessId, userId, locationId, isCentral, role }, sale),
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
        const conocido = errorDeVenta(e);
        results.push({
          id: sale.id,
          status: 'error',
          // Lo inesperado va al log del servidor, no al navegador: ahí es donde puede
          // mirarlo quien sabe qué hacer con ello.
          error: conocido?.error ?? 'No se pudo sincronizar esta venta',
          ...(conocido?.code ? { code: conocido.code } : {}),
        });
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
    /*
      Filtrar por vendedor es cosa de administrar.

      `?userId=` se empujaba tal cual, sin mirar quién preguntaba: bastaba con poner el id
      del compañero para sacar sus ventas y su total. `cash.ts` ya había respondido esta
      misma pregunta para el historial de turnos —"mirar lo propio es el trabajo, mirar lo
      de otro es supervisar, y supervisar es del administrador"— y aquí no se aplicó.

      A quien no es admin se le fuerza a sí mismo en vez de responderle 403: pedir "las
      ventas de Fulano" desde una caja es casi siempre una pantalla mal enlazada, no un
      ataque, y devolverle las suyas es lo que iba a hacer con ellas.

      Lo que NO se toca es la lista sin filtro: un vendedor sigue viendo las ventas de su
      ubicación, que es lo que necesita para reimprimir el recibo de un cliente al que
      atendió el turno anterior. El local es común; el desglose por persona, no.
    */
    if (q.userId) {
      filters.push(eq(schema.sale.userId, user.role === 'admin' ? q.userId : user.sub));
    }
    if (q.status) filters.push(eq(schema.sale.status, q.status));
    const where = and(...filters);

    const { rows, count } = await withTenant(businessId, async (tx) => {
      const rows = await tx
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
        .offset((q.page - 1) * q.limit);
      const [count] = await tx
        .select({
          n: sql<number>`count(*)::int`,
          // Sólo las COMPLETADAS suman. Con el filtro por defecto ("todos los estados")
          // la suma incluía las anuladas, así que lo primero que veía el dueño
          // sobreestimaba lo vendido — dinero que se devolvió, contado como ingreso.
          sum: sql<string>`COALESCE(SUM(${schema.sale.total}) FILTER (WHERE ${schema.sale.status} = 'completed'), 0)::text`,
        })
        .from(schema.sale)
        .where(where);
      return { rows, count };
    });

    return reply.send({
      // sumTotal = suma de "total" de TODAS las ventas que cumplen el filtro (no sólo la página).
      data: {
        items: rows,
        total: count?.n ?? 0,
        sumTotal: count?.sum ?? '0',
        page: q.page,
        limit: q.limit,
      },
      error: null,
    });
  });

  // GET /sales/:id — detalle para el recibo.
  app.get('/sales/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const businessId = req.authUser!.businessId;
    // Alcance: la sucursal sólo puede leer el detalle de su ubicación.

    const detalle = await withTenant(businessId, async (tx) => {
      const [sale] = await tx
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
            filtroDeUbicacion(req.authUser!, schema.sale.locationId),
          ),
        )
        .limit(1);
      if (!sale) return null;
      // Columnas explícitas, no `select()`: con el asterisco viajaba `unitCostSnapshot`,
      // y el recibo de una venta lo abre cualquiera. Un vendedor recorriendo su propio
      // historial reconstruía la lista de costos entera del catálogo.
      const items = await tx
        .select({
          id: schema.saleItem.id,
          productId: schema.saleItem.productId,
          productNameSnapshot: schema.saleItem.productNameSnapshot,
          unitPriceSnapshot: schema.saleItem.unitPriceSnapshot,
          unitCostSnapshot: schema.saleItem.unitCostSnapshot,
          quantity: schema.saleItem.quantity,
          lineTotal: schema.saleItem.lineTotal,
        })
        .from(schema.saleItem)
        .where(eq(schema.saleItem.saleId, id));
      return { ...sale, items: sinCostosLista(items, req.authUser!) };
    });

    if (!detalle) return reply.code(404).send({ data: null, error: 'Venta no encontrada' });
    return reply.send({ data: detalle, error: null });
  });

  // POST /sales/:id/cancel — admin (su alcance) o vendedor sobre su propia ubicación.
  // Exige motivo y registra en audit_log; nunca borra la venta.
  app.post('/sales/:id/cancel', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = cancelSaleSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ data: null, error: 'Motivo requerido (min 3)' });
    const businessId = req.authUser!.businessId;

    const before = await withTenant(businessId, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.sale)
        .where(and(eq(schema.sale.id, id), eq(schema.sale.businessId, businessId)))
        .limit(1);
      return row ?? null;
    });
    if (!before) return reply.code(404).send({ data: null, error: 'Venta no encontrada' });
    if (!canCancelSale(req.authUser!, before.locationId)) {
      return reply
        .code(403)
        .send({ data: null, error: 'Sólo puedes cancelar ventas de tu ubicación' });
    }
    if (before.status === 'cancelled') {
      return reply.code(409).send({ data: null, error: 'La venta ya está cancelada' });
    }

    // Cancelar = status='cancelled' (nunca se borra) + devolver stock a la ubicación.
    const after = await withTenant(businessId, async (tx) => {
      const [row] = await tx
        .update(schema.sale)
        .set({
          status: 'cancelled',
          cancelledReason: parsed.data.reason,
          cancelledBy: req.authUser!.sub,
        })
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
      before: { status: before.status, paymentMethod: before.paymentMethod, total: before.total },
      after: { status: 'cancelled', reason: parsed.data.reason },
    });

    /*
      Si era en efectivo, hay un billete que sacar del cajón.

      Anular ya NO devuelve el dinero por su cuenta en el arqueo (ver `calcularDesglose`):
      el efectivo que entró sigue contando y devolverlo es un retiro de caja, registrado
      como cualquier otro. Eso es lo que impide cuadrar la caja anulando la propia venta.

      El API no crea el retiro solo —hacerlo sería volver al punto de partida, con el
      esperado cuadrando sin que nadie haya tocado un billete—, pero sí avisa, para que
      el POS pueda ofrecer el retiro en el mismo gesto en lugar de dejarlo a la memoria
      de quien está atendiendo.
    */
    const devolverEfectivo = before.status === 'completed' && before.paymentMethod === 'cash';

    return reply.send({
      data: { ...after, devolverEfectivo, montoADevolver: devolverEfectivo ? before.total : null },
      error: null,
    });
  });
}
