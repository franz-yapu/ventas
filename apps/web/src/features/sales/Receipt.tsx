import { money, PAYMENT_LABELS, dateTime } from '@/lib/format';
import type { SaleDetail } from '@/lib/types';
import type { BusinessConfig } from '@/theme/ThemeProvider';

/** Recibo térmico 80mm. La clase receipt-area se aísla para @media print. */
export function Receipt({ sale, business }: { sale: SaleDetail; business: BusinessConfig | null }) {
  const appName = business?.texts?.app_name ?? business?.name ?? 'VentaFácil';
  const footer = business?.texts?.receipt_footer ?? '¡Gracias por su compra!';

  return (
    <div className="receipt-area mx-auto w-[80mm] max-w-full bg-white p-4 font-mono text-[13px] text-black">
      <div className="text-center">
        {business?.logoUrl && (
          <img src={business.logoUrl} alt="logo" className="mx-auto mb-1 max-h-16 max-w-[60mm] object-contain" />
        )}
        <div className="text-base font-bold">{appName}</div>
        {sale.locationName && <div>{sale.locationName}</div>}
        <div className="my-2 border-t border-dashed border-black" />
      </div>

      <div className="flex justify-between">
        <span>Recibo</span>
        <span>{sale.receiptNumber ? `#${sale.receiptNumber}` : `PROV-${sale.id.slice(0, 8)}`}</span>
      </div>
      {!sale.receiptNumber && (
        <div className="text-center text-[11px]">(folio provisional — se confirma al sincronizar)</div>
      )}
      <div className="flex justify-between">
        <span>Fecha</span>
        <span>{dateTime(sale.clientCreatedAt)}</span>
      </div>
      {sale.sellerName && (
        <div className="flex justify-between">
          <span>Vendedor</span>
          <span>{sale.sellerName}</span>
        </div>
      )}
      {sale.customerName && (
        <div className="flex justify-between">
          <span>Comprador</span>
          <span>{sale.customerName}</span>
        </div>
      )}
      <div className="my-2 border-t border-dashed border-black" />

      {sale.items.map((it) => (
        <div key={it.id} className="mb-1">
          <div>{it.productNameSnapshot}</div>
          <div className="flex justify-between">
            <span>
              {it.quantity} x {money(it.unitPriceSnapshot)}
            </span>
            <span>{money(it.lineTotal)}</span>
          </div>
        </div>
      ))}

      <div className="my-2 border-t border-dashed border-black" />
      <div className="flex justify-between">
        <span>Subtotal</span>
        <span>{money(sale.subtotal)}</span>
      </div>
      {Number(sale.discount) > 0 && (
        <div className="flex justify-between">
          <span>Descuento</span>
          <span>-{money(sale.discount)}</span>
        </div>
      )}
      <div className="flex justify-between text-base font-bold">
        <span>TOTAL</span>
        <span>{money(sale.total)}</span>
      </div>
      <div className="flex justify-between">
        <span>Pago</span>
        <span>{PAYMENT_LABELS[sale.paymentMethod]}</span>
      </div>

      <div className="my-2 border-t border-dashed border-black" />
      <div className="text-center">{footer}</div>
      {sale.status === 'cancelled' && (
        <div className="mt-2 text-center font-bold">*** ANULADO ***</div>
      )}
    </div>
  );
}
