import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, History, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { useAuth } from '@/features/auth/AuthProvider';
import { HistoryModal } from '@/features/inventory/HistoryModal';
import { api, ApiError } from '@/lib/api';
import type { InventoryRow, Location } from '@/lib/types';

export function InventoryPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isCentral = !!user?.isCentral;
  const [transferOpen, setTransferOpen] = useState(false);
  const [adjust, setAdjust] = useState<InventoryRow | null>(null);
  const [history, setHistory] = useState<{ productId: string; name: string } | null>(null);
  const [locationId, setLocationId] = useState('');

  // Sólo la central filtra por ubicación; la sucursal siempre ve la suya.
  const { data: locations } = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<Location[]>('/locations'),
    enabled: isCentral,
  });
  const { data: rows } = useQuery({
    queryKey: ['inventory', locationId],
    queryFn: () => api.get<InventoryRow[]>(`/inventory${locationId ? `?locationId=${locationId}` : ''}`),
  });
  const canTransfer = rows?.some((r) => r.canAdjust) ?? false;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Inventario</h1>
        {canTransfer && (
          <Button onClick={() => setTransferOpen(true)}>
            <ArrowLeftRight size={18} /> Transferir
          </Button>
        )}
      </div>

      {isCentral && (
        <Select className="max-w-xs" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          <option value="">Todas las ubicaciones</option>
          {locations?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="ds-table w-full">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                <th className="p-3">Producto</th>
                <th className="p-3">Ubicación</th>
                <th className="p-3 text-right">Stock</th>
                <th className="p-3 text-right">Mínimo</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows?.map((r) => {
                const low = r.minStock != null && r.quantity <= r.minStock;
                return (
                  <tr key={r.id} className={`border-b border-border last:border-0 ${low ? 'bg-red-50' : ''}`}>
                    <td className="p-3">
                      {r.productName} <span className="text-xs text-muted">{r.sku}</span>
                    </td>
                    <td className="p-3">{r.locationName}</td>
                    <td className="p-3 text-right font-medium">{r.quantity}</td>
                    <td className="p-3 text-right text-muted">{r.minStock ?? '—'}</td>
                    <td className="p-3">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setHistory({ productId: r.productId, name: r.productName })}
                          className="text-muted hover:text-primary"
                          title="Historial"
                        >
                          <History size={16} />
                        </button>
                        {r.canAdjust && (
                          <button onClick={() => setAdjust(r)} className="text-muted hover:text-primary" title="Ajustar">
                            <SlidersHorizontal size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows && rows.length === 0 && <p className="py-8 text-center text-muted">Sin inventario</p>}
        </CardContent>
      </Card>

      {adjust && (
        <AdjustModal
          row={adjust}
          onClose={() => setAdjust(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ['inventory'] });
            setAdjust(null);
          }}
        />
      )}
      {transferOpen && (
        <TransferModal
          rows={(rows ?? []).filter((r) => r.canAdjust)}
          allRows={rows ?? []}
          onClose={() => setTransferOpen(false)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ['inventory'] });
            setTransferOpen(false);
          }}
        />
      )}
      {history && (
        <HistoryModal productId={history.productId} title={`Historial · ${history.name}`} onClose={() => setHistory(null)} />
      )}
    </div>
  );
}

function AdjustModal({ row, onClose, onDone }: { row: InventoryRow; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState(String(row.quantity));
  const [min, setMin] = useState(row.minStock == null ? '' : String(row.minStock));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/inventory/${row.id}`, {
        quantity: Number(qty),
        minStock: min === '' ? null : Number(min),
        reason,
      }),
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Error al ajustar'),
  });

  return (
    <Modal open onClose={onClose} title={`Ajustar stock · ${row.productName}`}>
      <div className="flex flex-col gap-3">
        <div className="text-sm text-muted">{row.locationName}</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-muted">Stock</label>
            <Input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div>
            <label className="text-sm text-muted">Mínimo</label>
            <Input inputMode="numeric" value={min} placeholder="—" onChange={(e) => setMin(e.target.value)} />
          </div>
        </div>
        <label className="text-sm text-muted">Motivo (obligatorio)</label>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. conteo físico, merma, ingreso" autoFocus />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button disabled={reason.trim().length < 3 || save.isPending} onClick={() => { setError(null); save.mutate(); }}>
          Guardar ajuste
        </Button>
      </div>
    </Modal>
  );
}

function TransferModal({
  rows,
  allRows,
  onClose,
  onDone,
}: {
  rows: InventoryRow[];
  allRows: InventoryRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  // Origen: sólo ubicaciones que el usuario puede ajustar. Destino: cualquiera visible.
  const fromLocs: Location[] = Array.from(
    new Map(rows.map((r) => [r.locationId, { id: r.locationId, name: r.locationName } as Location])).values(),
  );
  const toLocs: Location[] = Array.from(
    new Map(allRows.map((r) => [r.locationId, { id: r.locationId, name: r.locationName } as Location])).values(),
  );
  const products = Array.from(new Map(rows.map((r) => [r.productId, { id: r.productId, name: r.productName }])).values());

  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [fromLocationId, setFrom] = useState(fromLocs[0]?.id ?? '');
  const [toLocationId, setTo] = useState(toLocs.find((l) => l.id !== fromLocs[0]?.id)?.id ?? '');
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState<string | null>(null);

  const stockAt = (loc: string) => allRows.find((r) => r.productId === productId && r.locationId === loc)?.quantity ?? 0;

  const transfer = useMutation({
    mutationFn: () => api.post('/inventory/transfer', { productId, fromLocationId, toLocationId, quantity: Number(quantity) }),
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Error al transferir'),
  });

  return (
    <Modal open onClose={onClose} title="Transferir stock">
      <div className="flex flex-col gap-3">
        <label className="text-sm text-muted">Producto</label>
        <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-muted">Desde ({stockAt(fromLocationId)})</label>
            <Select value={fromLocationId} onChange={(e) => setFrom(e.target.value)}>
              {fromLocs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-sm text-muted">Hacia ({stockAt(toLocationId)})</label>
            <Select value={toLocationId} onChange={(e) => setTo(e.target.value)}>
              {toLocs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <label className="text-sm text-muted">Cantidad</label>
        <Input value={quantity} inputMode="numeric" onChange={(e) => setQuantity(e.target.value)} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button
          disabled={transfer.isPending || Number(quantity) < 1 || fromLocationId === toLocationId}
          onClick={() => { setError(null); transfer.mutate(); }}
        >
          Transferir
        </Button>
      </div>
    </Modal>
  );
}
