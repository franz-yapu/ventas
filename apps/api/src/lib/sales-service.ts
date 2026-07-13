import { schema } from '@ventafacil/db';
import type { CreateSaleInput } from '@ventafacil/shared';
import { and, eq, sql } from 'drizzle-orm';
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
  ctx: { businessId: string; userId: string; locationId: string | null; isCentral: boolean },
  input: CreateSaleInput,
): Promise<PersistSaleResult> {
  // Alcance de escritura: un usuario de sucursal sólo puede vender en SU ubicación.
  // La central puede registrar ventas en cualquier ubicación del negocio.
  if (!ctx.isCentral && input.locationId !== ctx.locationId) {
    throw new Error('LOCATION_SCOPE');
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

  await tx.insert(schema.saleItem).values(
    input.items.map((it) => ({
      saleId: input.id,
      productId: it.productId,
      productNameSnapshot: it.productNameSnapshot,
      unitPriceSnapshot: it.unitPriceSnapshot,
      unitCostSnapshot: it.unitCostSnapshot ?? null,
      quantity: it.quantity,
      lineTotal: it.lineTotal,
    })),
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
