import { schema } from '@ventafacil/db';
import type { CreateSaleInput } from '@ventafacil/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';

type Tx = PgTransaction<any, any, any>;

/**
 * Asigna el correlativo de recibo POR negocio de forma atomica.
 * Reutilizado por la venta online (Fase 1) y el sync offline (Fase 2).
 */
export async function nextReceiptNumber(tx: Tx, businessId: string): Promise<number> {
  const [row] = await tx
    .update(schema.businessCounter)
    .set({ lastReceiptNumber: sql`${schema.businessCounter.lastReceiptNumber} + 1` })
    .where(eq(schema.businessCounter.businessId, businessId))
    .returning({ n: schema.businessCounter.lastReceiptNumber });
  if (!row) throw new Error('business_counter no inicializado para el negocio');
  return row.n;
}

export interface PersistSaleResult {
  saleId: string;
  receiptNumber: number;
  duplicated: boolean;
}

/**
 * Persiste una venta de forma idempotente por UUID.
 * Si el UUID ya existe (reintento/offline), devuelve la existente sin duplicar.
 * El business_id/user_id SIEMPRE vienen del token, nunca del payload del cliente.
 */
export async function persistSale(
  tx: Tx,
  ctx: {
    businessId: string;
    userId: string;
    locationId: string | null;
    isCentral: boolean;
    role: 'admin' | 'seller';
  },
  input: CreateSaleInput,
): Promise<PersistSaleResult> {
  /**
   * Una venta se registra DONDE OCURRE. Sin excepción, tampoco para la central.
   *
   * Antes la central podía grabar una venta en cualquier sucursal, y eso rompía el
   * arqueo del otro local: si desde la central se registra una venta en efectivo de
   * Bs. 500 en Norte, el sistema espera esos Bs. 500 en la caja de Norte, donde nadie
   * los recibió. Al cerrar el turno, al cajero de Norte le falta dinero que nunca tuvo
   * — un faltante que no cometió y que no puede explicar.
   *
   * El dinero está donde está la persona que lo cobró, y ahí es donde tiene que constar
   * la venta.
   */
  if (input.locationId !== ctx.locationId) {
    throw new Error('LOCATION_SCOPE');
  }

  // …de SU negocio. "La central puede vender en cualquier ubicación" se comprobaba
  // sólo contra el rol, no contra la tenencia: un admin (que siempre es central) podía
  // grabar una venta con el `location_id` o el `product_id` de OTRO negocio. RLS impedía
  // que tocara su stock, así que no era una fuga de datos, pero ensuciaba `sale_item` y
  // la venta desaparecía de todo arqueo.
  /**
   * Tope de descuento del VENDEDOR.
   *
   * Sin esto, cualquier cajero podía descontar el total entero y cobrar Bs. 0: un
   * agujero de caja abierto, y encima difícil de detectar. El administrador no tiene
   * tope — se supone que es su mercadería.
   */
  if (ctx.role === 'seller' && Number(input.discount) > 0) {
    const [biz] = await tx
      .select({ pct: schema.business.maxSellerDiscountPct })
      .from(schema.business)
      .where(eq(schema.business.id, ctx.businessId))
      .limit(1);
    const pct = biz?.pct ?? 0;
    const maximo = (Number(input.subtotal) * pct) / 100;
    // Medio centavo de holgura por el redondeo del porcentaje.
    if (Number(input.discount) > maximo + 0.005) {
      throw new Error(`DISCOUNT_LIMIT:${pct}`);
    }
  }

  const [loc] = await tx
    .select({ id: schema.location.id })
    .from(schema.location)
    .where(
      and(
        eq(schema.location.id, input.locationId),
        eq(schema.location.businessId, ctx.businessId),
      ),
    )
    .limit(1);
  if (!loc) throw new Error('LOCATION_SCOPE');

  const productIds = [...new Set(input.items.map((it) => it.productId).filter(Boolean))] as string[];
  const costoDeProducto = new Map<string, string | null>();
  if (productIds.length > 0) {
    const propios = await tx
      .select({ id: schema.product.id, cost: schema.product.cost })
      .from(schema.product)
      .where(
        and(
          inArray(schema.product.id, productIds),
          eq(schema.product.businessId, ctx.businessId),
        ),
      );
    if (propios.length !== productIds.length) throw new Error('PRODUCT_SCOPE');
    for (const p of propios) costoDeProducto.set(p.id, p.cost);
  }

  const existing = await tx
    .select({ id: schema.sale.id, receiptNumber: schema.sale.receiptNumber })
    .from(schema.sale)
    .where(and(eq(schema.sale.id, input.id), eq(schema.sale.businessId, ctx.businessId)))
    .limit(1);

  if (existing[0]) {
    return {
      saleId: existing[0].id,
      receiptNumber: existing[0].receiptNumber ?? 0,
      duplicated: true,
    };
  }

  const receiptNumber = await nextReceiptNumber(tx, ctx.businessId);

  await tx.insert(schema.sale).values({
    id: input.id,
    businessId: ctx.businessId,
    locationId: input.locationId,
    customerId: input.customerId ?? null,
    userId: ctx.userId,
    status: input.status,
    subtotal: input.subtotal,
    discount: input.discount,
    total: input.total,
    paymentMethod: input.paymentMethod,
    receiptNumber,
    clientCreatedAt: new Date(input.clientCreatedAt),
  });

  /**
   * El costo lo pone el SERVIDOR, no el cliente.
   *
   * El precio de venta sí llega del cliente y con razón (es la foto del momento, y el
   * POS vende sin conexión). Con el costo no se puede hacer lo mismo, por dos motivos
   * que apuntan al mismo sitio:
   *
   * 1. El vendedor ya no lo recibe. Desde que el costo dejó de salir por el cable hacia
   *    quien no debe verlo, su catálogo offline no lo tiene, así que su venta llegaba
   *    aquí sin costo y se guardaba en NULL. Los reportes cuentan `COALESCE(costo, 0)`,
   *    de modo que cada venta suya declaraba como ganancia el precio entero. No fallaba
   *    nada: sólo salía mal el número que el dueño usa para decidir. Y no se recupera,
   *    porque `unit_cost_snapshot` es histórico — el costo de hoy no vale para la venta
   *    de ayer.
   * 2. Quien no tiene el dato tampoco puede acreditarlo. Cualquier cosa que un vendedor
   *    mandara en este campo sería inventada, y el margen del negocio no puede depender
   *    de lo que diga un dispositivo.
   *
   * Así que se toma del producto —ya está cargado por la comprobación de tenencia de
   * arriba, no cuesta una consulta más— y sólo se respeta lo que manda el cliente
   * cuando quien vende es el administrador, que sí lo tiene y cuya copia offline es más
   * fiel al momento de la venta que el costo de hoy.
   */
  await tx.insert(schema.saleItem).values(
    input.items.map((it) => {
      const delCliente = ctx.role === 'admin' ? (it.unitCostSnapshot ?? null) : null;
      const delProducto = it.productId ? (costoDeProducto.get(it.productId) ?? null) : null;
      return {
        saleId: input.id,
        productId: it.productId,
        productNameSnapshot: it.productNameSnapshot,
        unitPriceSnapshot: it.unitPriceSnapshot,
        unitCostSnapshot: delCliente ?? delProducto,
        quantity: it.quantity,
        lineTotal: it.lineTotal,
      };
    }),
  );

  // Descuento automático de stock (sólo ventas completadas y productos con inventario en la ubicación).
  // Como es parte de la transacción idempotente, las ventas offline descuentan al sincronizar (una vez).
  if (input.status === 'completed') {
    for (const it of input.items) {
      if (!it.productId) continue;
      await tx
        .update(schema.inventory)
        .set({ quantity: sql`${schema.inventory.quantity} - ${it.quantity}` })
        .where(
          and(
            eq(schema.inventory.businessId, ctx.businessId),
            eq(schema.inventory.productId, it.productId),
            eq(schema.inventory.locationId, input.locationId),
          ),
        );
    }
  }

  return { saleId: input.id, receiptNumber, duplicated: false };
}
