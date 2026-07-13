import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Printer } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { useAuth } from '@/features/auth/AuthProvider';
import { Receipt } from '@/features/sales/Receipt';
import { api } from '@/lib/api';
import { dateTime, money, PAYMENT_LABELS } from '@/lib/format';
import { printReceipt } from '@/lib/print';
import type { Location, SaleDetail, SaleRow } from '@/lib/types';
import { useInfiniteList } from '@/lib/useInfinite';
import { useBusiness } from '@/theme/ThemeProvider';

export function SalesPage() {
  const { user } = useAuth();
  const business = useBusiness();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'admin';
  // Sólo la central ve varias ubicaciones; una sucursal siempre ve la suya.
  const isCentral = !!user?.isCentral;
  const [locationId, setLocationId] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [viewing, setViewing] = useState<SaleDetail | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const { data: locations } = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<Location[]>('/locations'),
  });

  const query = new URLSearchParams();
  if (locationId) query.set('locationId', locationId);
  if (status) query.set('status', status);
  // Rango de fechas: 'from' desde el inicio del día; 'to' hasta el fin del día.
  if (from) query.set('from', new Date(`${from}T00:00:00`).toISOString());
  if (to) query.set('to', new Date(`${to}T23:59:59.999`).toISOString());
  const { items, total, sumTotal, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteList<SaleRow>(
    ['sales', locationId, status, from, to],
    `/sales?${query.toString()}`,
  );

  async function openReceipt(id: string) {
    setViewing(await api.get<SaleDetail>(`/sales/${id}`));
  }

  const cancel = useMutation({
    mutationFn: () => api.post(`/sales/${cancelId}/cancel`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      setCancelId(null);
      setReason('');
    },
  });

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">Ventas</h1>

      <div className="flex flex-wrap gap-2">
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
        <Select className="max-w-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="completed">Completadas</option>
          <option value="cancelled">Canceladas</option>
        </Select>
        <div className="flex items-center gap-1">
          <label className="text-sm text-muted">Desde</label>
          <Input type="date" className="max-w-[10rem]" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          <label className="text-sm text-muted">Hasta</label>
          <Input type="date" className="max-w-[10rem]" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          {(from || to) && (
            <Button variant="ghost" className="h-9 px-2 text-sm" onClick={() => { setFrom(''); setTo(''); }}>
              Limpiar
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                <th className="p-3">Recibo</th>
                <th className="p-3">Fecha</th>
                <th className="p-3">Ubicación</th>
                <th className="p-3">Vendedor</th>
                <th className="p-3">Comprador</th>
                <th className="p-3">Pago</th>
                <th className="p-3 text-right">Total</th>
                <th className="p-3">Estado</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0">
                  <td className="p-3 font-mono font-medium">#{s.receiptNumber}</td>
                  <td className="p-3 text-muted">{dateTime(s.clientCreatedAt)}</td>
                  <td className="p-3">{s.locationName}</td>
                  <td className="p-3">{s.sellerName}</td>
                  <td className="p-3 text-muted">{s.customerName ?? '—'}</td>
                  <td className="p-3">{PAYMENT_LABELS[s.paymentMethod]}</td>
                  <td className="p-3 text-right font-medium">{money(s.total)}</td>
                  <td className="p-3">
                    <Badge tone={s.status === 'cancelled' ? 'neutral' : 'success'}>
                      {s.status === 'cancelled' ? 'Cancelada' : 'Completada'}
                    </Badge>
                  </td>
                  <td className="p-3">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => openReceipt(s.id)} className="text-muted hover:text-primary" title="Ver recibo">
                        <Printer size={16} />
                      </button>
                      {isAdmin && s.status === 'completed' && (
                        <button onClick={() => setCancelId(s.id)} className="text-muted hover:text-red-600" title="Cancelar">
                          <Ban size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {items.length > 0 && (
              <tfoot className="border-t-2 border-border font-semibold">
                <tr>
                  <td className="p-3" colSpan={6}>
                    Suma ({total} venta{total === 1 ? '' : 's'})
                  </td>
                  <td className="p-3 text-right text-lg">{money(sumTotal ?? '0')}</td>
                  <td className="p-3" colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
          {items.length === 0 && <p className="py-8 text-center text-muted">Sin ventas</p>}
        </CardContent>
      </Card>

      {hasNextPage && (
        <Button variant="outline" className="self-center" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
          {isFetchingNextPage ? 'Cargando…' : `Cargar más (${items.length}/${total})`}
        </Button>
      )}

      {/* Ver recibo */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={`Recibo #${viewing?.receiptNumber ?? ''}`}>
        {viewing && (
          <div className="flex flex-col gap-4">
            <div className="max-h-[60vh] overflow-y-auto rounded border border-border">
              <Receipt sale={viewing} business={business} />
            </div>
            <Button className="no-print" onClick={printReceipt}>
              <Printer size={18} /> Imprimir
            </Button>
          </div>
        )}
      </Modal>

      {/* Cancelar */}
      <Modal open={!!cancelId} onClose={() => setCancelId(null)} title="Cancelar venta">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            La venta no se elimina; queda marcada como cancelada y se registra en auditoría.
          </p>
          <label className="text-sm text-muted">Motivo (obligatorio)</label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. producto devuelto" />
          {cancel.isError && <p className="text-sm text-red-600">No se pudo cancelar</p>}
          <Button variant="secondary" disabled={reason.length < 3 || cancel.isPending} onClick={() => cancel.mutate()}>
            Confirmar cancelación
          </Button>
        </div>
      </Modal>
    </div>
  );
}
