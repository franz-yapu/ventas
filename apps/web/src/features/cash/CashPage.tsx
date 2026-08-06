import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, FileText, Lock, LockOpen } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Page, PageHeader } from '@/components/ui/page';
import { Select } from '@/components/ui/select';
import { useAuth } from '@/features/auth/AuthProvider';
import { api, ApiError } from '@/lib/api';
import { dateTime, money, PAYMENT_LABELS } from '@/lib/format';
import type { CashCurrent, CashHistoryRow } from '@/lib/types';

/**
 * Arqueo de caja: abrir el turno, anotar entradas y salidas de efectivo, y cerrarlo
 * contando lo que hay en el cajón.
 *
 * La pantalla enseña el desglose ENTERO de cómo se llega al esperado, no sólo el
 * número final. Un cajero que no entiende de dónde sale la cifra no puede discutirla,
 * y un descuadre que no se puede discutir se ignora.
 */
export function CashPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [abriendo, setAbriendo] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [movimiento, setMovimiento] = useState(false);

  const { data: caja, isLoading } = useQuery({
    queryKey: ['cash-current'],
    queryFn: () => api.get<CashCurrent | null>('/cash/current'),
    // El esperado cambia con cada venta: se refresca solo mientras la pantalla está
    // abierta, para que no muestre un número viejo justo cuando se va a contar.
    refetchInterval: 30_000,
  });

  const { data: historial } = useQuery({
    queryKey: ['cash-history'],
    queryFn: () => api.get<CashHistoryRow[]>('/cash/registers?limit=20'),
  });

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['cash-current'] });
    qc.invalidateQueries({ queryKey: ['cash-history'] });
  };

  return (
    <Page>
      <PageHeader
        titulo="Caja"
        descripcion="Apertura, movimientos y arqueo del turno. El descuadre se calcula contra lo que se cobró en efectivo."
        acciones={
          user?.role === 'admin' && (
            <Link to="/caja/z">
              <Button variant="outline">
                <FileText size={16} /> Lectura Z
              </Button>
            </Link>
          )
        }
      />

      {isLoading && <div className="text-muted">Cargando…</div>}

      {!isLoading && !caja && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/15 text-muted">
              <Lock size={22} />
            </div>
            <div>
              <div className="font-semibold">No hay una caja abierta</div>
              <p className="mt-1 text-sm text-muted">
                Ábrela con el efectivo que hay ahora en el cajón para empezar el turno.
              </p>
            </div>
            <Button onClick={() => setAbriendo(true)}>
              <LockOpen size={16} /> Abrir caja
            </Button>
          </CardContent>
        </Card>
      )}

      {caja && (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-medium">Turno abierto</h2>
                  <p className="text-[13px] text-muted">Desde {dateTime(caja.register.openedAt)}</p>
                </div>
                <Badge tone="success">Abierta</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Linea etiqueta="Apertura" valor={caja.breakdown.openingAmount} />
              <Linea etiqueta="Ventas en efectivo" valor={caja.breakdown.cashSales} suma />
              <Linea etiqueta="Abonos en efectivo" valor={caja.breakdown.cashPayments} suma />
              <Linea etiqueta="Ingresos" valor={caja.breakdown.movementsIn} suma />
              <Linea etiqueta="Retiros" valor={caja.breakdown.movementsOut} resta />
              <div className="flex items-baseline justify-between border-t border-border pt-3">
                <span className="font-semibold">Debería haber</span>
                <span className="text-2xl font-bold">{money(caja.breakdown.expected)}</span>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="outline" onClick={() => setMovimiento(true)}>
                  Registrar movimiento
                </Button>
                <Button onClick={() => setCerrando(true)}>
                  <Lock size={16} /> Cerrar caja
                </Button>
              </div>
            </CardContent>
          </Card>

          {caja.breakdown.byPaymentMethod.length > 0 && (
            <Card>
              <CardHeader>
                <h2 className="text-lg font-medium">Ventas del turno</h2>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {caja.breakdown.byPaymentMethod.map((r) => (
                  <div
                    key={r.paymentMethod}
                    className="flex items-baseline justify-between text-sm"
                  >
                    <span>
                      {PAYMENT_LABELS[r.paymentMethod] ?? r.paymentMethod}
                      <span className="ml-2 text-[13px] text-muted">
                        {r.count} venta{r.count === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span className="font-semibold">{money(r.total)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {caja.movements.length > 0 && (
            <Card>
              <CardHeader>
                <h2 className="text-lg font-medium">Movimientos</h2>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {caja.movements.map((m) => (
                  <div key={m.id} className="flex items-start justify-between gap-3 text-sm">
                    <div className="flex min-w-0 items-start gap-2">
                      {m.type === 'in' ? (
                        <ArrowDownLeft size={16} className="mt-0.5 shrink-0 text-success" />
                      ) : (
                        <ArrowUpRight size={16} className="mt-0.5 shrink-0 text-danger" />
                      )}
                      <div className="min-w-0">
                        <div className="truncate">{m.reason}</div>
                        <div className="text-[12px] text-muted">{dateTime(m.createdAt)}</div>
                      </div>
                    </div>
                    <span
                      className={
                        m.type === 'in' ? 'font-semibold text-success' : 'font-semibold text-danger'
                      }
                    >
                      {m.type === 'in' ? '+' : '−'} {money(m.amount)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Card>
        <CardHeader>
          {/* El API devuelve los turnos del vendedor y los de la sucursal al admin, así
              que el título dice cuál de las dos cosas se está mirando. */}
          <h2 className="text-lg font-medium">
            {user?.role === 'admin' ? 'Cierres anteriores' : 'Mis cierres anteriores'}
          </h2>
        </CardHeader>
        <CardContent className="p-0">
          {!historial?.length && <div className="p-4 text-muted">Todavía no hay cierres.</div>}
          <ul className="divide-y divide-border">
            {historial?.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    {dateTime(r.openedAt)}
                    {r.closedAt ? ` → ${dateTime(r.closedAt)}` : ' · abierta'}
                  </div>
                  <div className="text-[13px] text-muted">
                    {r.locationName} · abrió {r.openedBy}
                    {r.notes ? ` · ${r.notes}` : ''}
                  </div>
                </div>
                <Diferencia valor={r.difference} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {abriendo && <ModalAbrir onClose={() => setAbriendo(false)} onOk={refrescar} />}
      {cerrando && caja && (
        <ModalCerrar
          esperado={caja.breakdown.expected}
          onClose={() => setCerrando(false)}
          onOk={refrescar}
        />
      )}
      {movimiento && <ModalMovimiento onClose={() => setMovimiento(false)} onOk={refrescar} />}
    </Page>
  );
}

function Linea({
  etiqueta,
  valor,
  suma,
  resta,
}: {
  etiqueta: string;
  valor: string;
  suma?: boolean;
  resta?: boolean;
}) {
  const signo = suma ? '+ ' : resta ? '− ' : '';
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-muted">{etiqueta}</span>
      <span className="font-medium">
        {signo}
        {money(valor)}
      </span>
    </div>
  );
}

/** Verde si sobra, rojo si falta, neutro si cuadra. Cero es la buena noticia. */
function Diferencia({ valor }: { valor: string | null }) {
  if (valor === null) return <Badge tone="info">Abierta</Badge>;
  const n = Number(valor);
  if (n === 0) return <Badge tone="success">Cuadra</Badge>;
  return (
    <Badge tone={n < 0 ? 'danger' : 'warning'}>
      {n < 0 ? 'Faltan' : 'Sobran'} {money(Math.abs(n))}
    </Badge>
  );
}

function ModalAbrir({ onClose, onOk }: { onClose: () => void; onOk: () => void }) {
  const [monto, setMonto] = useState('0.00');
  const [error, setError] = useState<string | null>(null);

  const abrir = useMutation({
    mutationFn: () => api.post('/cash/open', { openingAmount: monto }),
    onSuccess: () => {
      onOk();
      onClose();
    },
    onError: (e: Error) => setError(e instanceof ApiError ? e.message : 'No se pudo abrir'),
  });

  return (
    <Modal open onClose={onClose} title="Abrir caja">
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-[13px] font-semibold">Efectivo en el cajón ahora</label>
          <Input
            type="number"
            step="0.01"
            min="0"
            autoFocus
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
          />
          <p className="mt-1 text-[12px] text-muted">
            Cuenta lo que hay antes de empezar. Si arrancas sin nada, deja 0.
          </p>
        </div>
        {error && <p className="text-[13px] text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button className="flex-1" disabled={abrir.isPending} onClick={() => abrir.mutate()}>
            {abrir.isPending ? 'Abriendo…' : 'Abrir'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ModalCerrar({
  esperado,
  onClose,
  onOk,
}: {
  esperado: string;
  onClose: () => void;
  onOk: () => void;
}) {
  const [contado, setContado] = useState('');
  const [notas, setNotas] = useState('');
  const [error, setError] = useState<string | null>(null);

  // La diferencia se enseña MIENTRAS se teclea, antes de confirmar: es el momento en
  // que la persona todavía puede volver a contar.
  const diferencia = contado === '' ? null : Number(contado) - Number(esperado);

  const cerrar = useMutation({
    mutationFn: () =>
      api.post('/cash/close', {
        countedAmount: Number(contado).toFixed(2),
        notes: notas || undefined,
      }),
    onSuccess: () => {
      onOk();
      onClose();
    },
    onError: (e: Error) => setError(e instanceof ApiError ? e.message : 'No se pudo cerrar'),
  });

  return (
    <Modal open onClose={onClose} title="Cerrar caja">
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between rounded-theme border border-border p-3">
          <span className="text-sm text-muted">Debería haber</span>
          <span className="text-lg font-bold">{money(esperado)}</span>
        </div>

        <div>
          <label className="mb-1 block text-[13px] font-semibold">Cuánto contaste</label>
          <Input
            type="number"
            step="0.01"
            min="0"
            autoFocus
            value={contado}
            onChange={(e) => setContado(e.target.value)}
            placeholder="0.00"
          />
        </div>

        {diferencia !== null && (
          <div
            className={
              diferencia === 0
                ? 'rounded-theme bg-success-bg p-3 text-sm text-success'
                : diferencia < 0
                  ? 'rounded-theme bg-danger-bg p-3 text-sm text-danger'
                  : 'rounded-theme bg-warning-bg p-3 text-sm text-warning'
            }
          >
            {diferencia === 0
              ? 'Cuadra exacto.'
              : diferencia < 0
                ? `Faltan ${money(Math.abs(diferencia))}.`
                : `Sobran ${money(diferencia)}.`}
          </div>
        )}

        {diferencia !== null && diferencia !== 0 && (
          <div>
            <label className="mb-1 block text-[13px] font-semibold">
              ¿Por qué? (queda registrado)
            </label>
            <Input
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Se pagó al proveedor sin anotarlo…"
            />
          </div>
        )}

        {error && <p className="text-[13px] text-danger">{error}</p>}

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            className="flex-1"
            disabled={contado === '' || cerrar.isPending}
            onClick={() => cerrar.mutate()}
          >
            {cerrar.isPending ? 'Cerrando…' : 'Cerrar turno'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ModalMovimiento({ onClose, onOk }: { onClose: () => void; onOk: () => void }) {
  const [tipo, setTipo] = useState<'in' | 'out'>('out');
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const guardar = useMutation({
    mutationFn: () =>
      api.post('/cash/movements', { type: tipo, amount: Number(monto).toFixed(2), reason: motivo }),
    onSuccess: () => {
      onOk();
      onClose();
    },
    onError: (e: Error) => setError(e instanceof ApiError ? e.message : 'No se pudo registrar'),
  });

  return (
    <Modal open onClose={onClose} title="Movimiento de efectivo">
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-[13px] font-semibold">Tipo</label>
          <Select value={tipo} onChange={(e) => setTipo(e.target.value as 'in' | 'out')}>
            <option value="out">Retiro (sale plata del cajón)</option>
            <option value="in">Ingreso (entra plata al cajón)</option>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-semibold">Monto</label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-semibold">Motivo</label>
          <Input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Pago al proveedor de llantas"
          />
          <p className="mt-1 text-[12px] text-muted">
            Sin motivo, al cerrar no se distingue de un faltante.
          </p>
        </div>
        {error && <p className="text-[13px] text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            className="flex-1"
            disabled={!monto || motivo.trim().length < 3 || guardar.isPending}
            onClick={() => guardar.mutate()}
          >
            {guardar.isPending ? 'Guardando…' : 'Registrar'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
