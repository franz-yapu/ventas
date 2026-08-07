import { useQuery } from '@tanstack/react-query';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import type { HistoryEntry } from '@/lib/types';

const ACTION_LABELS: Record<string, string> = {
  create: 'Producto creado',
  update: 'Editado',
  price_change: 'Cambio de precio',
  stock_adjust: 'Ajuste de stock',
  transfer: 'Transferencia',
  import: 'Importado',
  sale: 'Venta',
};

function describe(e: HistoryEntry): string {
  const a = (e.after ?? {}) as Record<string, unknown>;
  const b = (e.before ?? {}) as Record<string, unknown>;
  switch (e.action) {
    case 'stock_adjust':
      return `Stock ${b.quantity} → ${a.quantity}${a.reason ? ` · Motivo: ${a.reason}` : ''}`;
    case 'price_change':
      return `Precio ${b.price} → ${a.price}`;
    case 'transfer':
      return `${a.quantity} u. transferidas`;
    case 'sale': {
      const cancelled = a.status === 'cancelled';
      const recibo = a.receiptNumber ? ` · Recibo #${a.receiptNumber}` : '';
      return `${a.quantity} u. vendidas${recibo}${cancelled ? ' · CANCELADA' : ''}`;
    }
    default:
      return '';
  }
}

export function HistoryModal({
  productId,
  title,
  onClose,
}: {
  productId: string;
  title: string;
  onClose: () => void;
}) {
  const { data } = useQuery({
    queryKey: ['product-history', productId],
    queryFn: () => api.get<HistoryEntry[]>(`/products/${productId}/history`),
  });

  return (
    <Modal open onClose={onClose} title={title} className="max-w-lg">
      {!data ? (
        <p className="text-muted">Cargando…</p>
      ) : data.length === 0 ? (
        <p className="text-muted">Sin acciones registradas.</p>
      ) : (
        <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
          {data.map((e) => (
            <li key={e.id} className="border-b border-border pb-2 last:border-0">
              <div className="flex items-center justify-between">
                <span className="font-medium">{ACTION_LABELS[e.action] ?? e.action}</span>
                <span className="text-xs text-muted">{dateTime(e.createdAt)}</span>
              </div>
              {describe(e) && <div className="text-sm">{describe(e)}</div>}
              <div className="text-xs text-muted">{e.userName ?? 'Sistema'}</div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
