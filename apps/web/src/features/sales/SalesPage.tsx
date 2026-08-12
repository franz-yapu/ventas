import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Printer, Receipt as ReceiptIcon } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Exportar } from '@/components/Exportar';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { useAuth } from '@/features/auth/AuthProvider';
import { Receipt } from '@/features/sales/Receipt';
import { api } from '@/lib/api';
import { currentWeek, dateTime, etiquetaDeEstado, money, PAYMENT_LABELS } from '@/lib/format';
import { SALE_STATUS_LABELS } from '@ventafacil/shared';
import { printReceipt } from '@/lib/print';
import type { Location, SaleDetail, SaleRow } from '@/lib/types';
import { useInfiniteList } from '@/lib/useInfinite';
import { EmptyState, Page, PageHeader, SkeletonRows } from '@/components/ui/page';
import { useBusiness } from '@/theme/ThemeProvider';

export function SalesPage() {
  const { user } = useAuth();
  const business = useBusiness();
  const qc = useQueryClient();
  // Sólo la central ve varias ubicaciones; una sucursal siempre ve la suya.
  // Cualquier usuario (admin o vendedor) puede anular ventas de su ubicación,
  // y sólo ve ventas que puede anular, así que el botón se muestra a todos.
  const isCentral = !!user?.isCentral;
  const [locationId, setLocationId] = useState('');
  const [status, setStatus] = useState('');
  // Por defecto, la semana actual (lunes a domingo).
  const [from, setFrom] = useState(() => currentWeek().from);
  const [to, setTo] = useState(() => currentWeek().to);
  const [viewing, setViewing] = useState<SaleDetail | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  /**
   * Si al anular se devolvió el efectivo al cliente.
   *
   * Va sin marcar a propósito. Es una AFIRMACIÓN de quien anula —el servidor registra un
   * retiro de caja a su nombre—, y marcarla por defecto convertiría en automático justo lo
   * que tiene que ser deliberado: el sistema no puede saber si el billete volvió al
   * cliente, sólo quién dice que sí.
   */
  const [devolvio, setDevolvio] = useState(false);

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
  const { items, total, sumTotal, hasNextPage, fetchNextPage, isFetchingNextPage, isLoading } =
    useInfiniteList<SaleRow>(['sales', locationId, status, from, to], `/sales?${query.toString()}`);

  async function openReceipt(id: string) {
    setViewing(await api.get<SaleDetail>(`/sales/${id}`));
  }

  const ventaAAnular = items.find((s) => s.id === cancelId) ?? null;

  const cancel = useMutation({
    mutationFn: () =>
      api.post<{ retiroRegistrado?: boolean; avisoCaja?: string | null }>(
        `/sales/${cancelId}/cancel`,
        { reason, devolvioEfectivo: devolvio },
      ),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      // La caja cambió: su desglose y el arqueo tienen que releerse, o el cajero seguiría
      // viendo el esperado de antes de la devolución.
      qc.invalidateQueries({ queryKey: ['cash'] });
      setAvisoCaja(r?.avisoCaja ?? null);
      setCancelId(null);
      setReason('');
      setDevolvio(false);
    },
  });
  /** Lo que el servidor no pudo hacer con la caja, para decirlo en pantalla. */
  const [avisoCaja, setAvisoCaja] = useState<string | null>(null);

  return (
    <Page>
      <PageHeader
        titulo="Ventas"
        descripcion="Historial de recibos. Anular una venta devuelve su stock y queda registrado."
        acciones={
          <Exportar
            seccion="ventas"
            // `status` también: filtrar a «Anuladas» y bajarse un papel con todas las
            // completadas dentro es un informe que miente, y de los que se firman.
            filtros={{ from, to, locationId, status }}
            // El PDF se firma: tiene que decir de qué sucursal es, no su identificador.
            alcance={locations?.find((l) => l.id === locationId)?.name}
          />
        }
      />

      {/*
        Lo que la anulación NO pudo hacer con la caja.

        Pasa cuando se anula algo de un turno ya cerrado y no hay ninguno abierto: la venta
        queda anulada igual —eso no se bloquea— pero el retiro no tiene dónde registrarse.
        Callarlo dejaría al cajero creyendo que la caja ya está cuadrada.
      */}
      {avisoCaja && (
        <div className="flex items-start gap-2 rounded-theme bg-warning-bg px-3.5 py-2.5 text-[13px] text-warning">
          <span className="flex-1">{avisoCaja}</span>
          <button onClick={() => setAvisoCaja(null)} className="font-bold underline">
            Entendido
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {isCentral && (
          <Select
            filter
            className="max-w-xs"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">Todas las ubicaciones</option>
            {locations?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        )}
        <Select
          filter
          className="max-w-xs"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Todos los estados</option>
          {/* Los rótulos salen de `@ventafacil/shared`, que es lo que sale también en el
              Excel, en el PDF y en la línea de filtros del informe. Escritos aquí a mano
              decían «Canceladas» mientras el papel decía «Anulada»: el mismo estado con
              dos nombres, y nadie lo nota hasta comparar la pantalla con el papel. */}
          <option value="completed">{SALE_STATUS_LABELS.completed}</option>
          <option value="cancelled">{SALE_STATUS_LABELS.cancelled}</option>
        </Select>
        <div className="flex items-center gap-1">
          <label className="flex shrink-0 items-center gap-2 text-sm text-muted">
            Desde
            <Input
              type="date"
              filter
              className="max-w-[10rem]"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="flex shrink-0 items-center gap-2 text-sm text-muted">
            Hasta
            <Input
              type="date"
              filter
              className="max-w-[10rem]"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
      </div>

      {isLoading && (
        <Card>
          <CardContent className="p-0">
            <SkeletonRows filas={6} />
          </CardContent>
        </Card>
      )}

      {!isLoading && items.length === 0 && (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icono={ReceiptIcon}
              titulo="Ninguna venta en este rango"
              descripcion="Cambia las fechas o la sucursal. Las ventas aparecen aquí en cuanto se cobran, incluso las que se hicieron sin conexión y se sincronizaron después."
            />
          </CardContent>
        </Card>
      )}

      <Card className={items.length ? 'hidden md:block' : 'hidden'}>
        <CardContent className="overflow-x-auto p-0">
          <table className="ds-table w-full">
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
                      {etiquetaDeEstado(s.status)}
                    </Badge>
                  </td>
                  <td className="p-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openReceipt(s.id)}
                        className="text-muted hover:text-primary"
                        title="Ver recibo"
                      >
                        <Printer size={16} />
                      </button>
                      {s.status === 'completed' && (
                        <button
                          onClick={() => setCancelId(s.id)}
                          className="text-muted hover:text-danger"
                          title="Anular"
                        >
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
                    Suma de completadas ({total} venta{total === 1 ? '' : 's'} en la lista)
                  </td>
                  <td className="p-3 text-right text-lg">{money(sumTotal ?? '0')}</td>
                  <td className="p-3" colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      </Card>

      {/* Móvil: tarjetas apiladas en vez de tabla con scroll (calcado del prototipo). */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {items.map((s) => (
          <div
            key={s.id}
            className="rounded-[14px] border border-border bg-surface p-[15px] shadow-card"
          >
            <div className="mb-2.5 flex items-center justify-between">
              <span className="font-mono text-[13px] font-semibold">#{s.receiptNumber}</span>
              <Badge tone={s.status === 'cancelled' ? 'neutral' : 'success'}>
                {etiquetaDeEstado(s.status)}
              </Badge>
            </div>
            <div className="flex items-baseline justify-between">
              <div className="text-[12px] leading-[1.5] text-muted">
                {dateTime(s.clientCreatedAt)} · {s.sellerName}
                <br />
                {s.locationName} · {PAYMENT_LABELS[s.paymentMethod]}
              </div>
              <div className="text-[22px] font-extrabold tracking-[-0.02em]">{money(s.total)}</div>
            </div>
            <div className="mt-3.5 flex gap-2">
              <button
                onClick={() => openReceipt(s.id)}
                className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[11px] border border-field bg-surface text-[13px] font-semibold"
              >
                <Printer size={16} /> Recibo
              </button>
              {s.status === 'completed' && (
                <button
                  onClick={() => setCancelId(s.id)}
                  className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[11px] border border-danger/40 bg-surface text-[13px] font-semibold text-danger"
                >
                  <Ban size={16} /> Anular
                </button>
              )}
            </div>
          </div>
        ))}
        {items.length > 0 && (
          <div className="p-2.5 text-center text-[15px] font-extrabold">
            Completadas: {money(sumTotal ?? '0')} · {total} venta{total === 1 ? '' : 's'} en la
            lista
          </div>
        )}
      </div>

      {hasNextPage && (
        <Button
          variant="outline"
          className="self-center"
          disabled={isFetchingNextPage}
          onClick={() => fetchNextPage()}
        >
          {isFetchingNextPage ? 'Cargando…' : `Cargar más (${items.length}/${total})`}
        </Button>
      )}

      {/* Ver recibo */}
      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={`Recibo #${viewing?.receiptNumber ?? ''}`}
      >
        {viewing && (
          <div className="flex flex-col gap-4">
            <div className="max-h-[60vh] overflow-y-auto rounded border border-border">
              <Receipt sale={viewing} business={business} />
            </div>
            <Button variant="secondary" className="no-print" onClick={printReceipt}>
              <Printer size={18} /> Imprimir
            </Button>
          </div>
        )}
      </Modal>

      {/* Anular */}
      <Modal open={!!cancelId} onClose={() => setCancelId(null)} title="Anular venta">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            La venta no se elimina; queda marcada como anulada y se registra en auditoría.
          </p>
          <label className="text-sm text-muted">Motivo (obligatorio)</label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej. producto devuelto"
          />

          {/*
            La devolución del efectivo, en el mismo gesto.

            Antes anular no tocaba la caja y aparecía un aviso pidiendo ir a registrar un
            retiro a mano: el esperado seguía contando ese dinero «porque entró al cajón».
            Era correcto y era confuso. Ahora se pregunta aquí, y si se dice que sí el
            servidor registra el retiro con el nombre de quien anula y el número de la
            venta.

            Sólo para las ventas en efectivo: devolver una tarjeta es cosa del banco, y en
            el cajón no hay ningún billete que sacar.
          */}
          {ventaAAnular?.paymentMethod === 'cash' && (
            <label className="flex items-start gap-2 rounded-theme bg-bg p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={devolvio}
                onChange={(e) => setDevolvio(e.target.checked)}
              />
              <span>
                Le devolví {money(ventaAAnular.total)} en efectivo al cliente
                <span className="block text-[12px] text-muted">
                  Se registrará como retiro de caja, para que el turno cuadre.
                </span>
              </span>
            </label>
          )}
          {cancel.isError && <p className="text-sm text-danger">No se pudo anular</p>}
          {/* Rojo de peligro, no el acento de la marca: anular una venta devuelve
              stock y no se deshace. Que llevara el color del negocio invitaba a
              pulsarlo. */}
          <Button
            variant="danger"
            disabled={reason.length < 3 || cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            Confirmar anulación
          </Button>
        </div>
      </Modal>
    </Page>
  );
}
