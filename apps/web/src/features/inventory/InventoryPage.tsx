import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Boxes, History, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Exportar } from '@/components/Exportar';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { EmptyState, Page, PageHeader, SkeletonRows } from '@/components/ui/page';
import { Select } from '@/components/ui/select';
import { useAuth } from '@/features/auth/AuthProvider';
import { HistoryModal } from '@/features/inventory/HistoryModal';
import { api, ApiError } from '@/lib/api';
import type { InventoryRow, Location } from '@/lib/types';

export function InventoryPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [transferOpen, setTransferOpen] = useState(false);
  const [adjust, setAdjust] = useState<InventoryRow | null>(null);
  const [history, setHistory] = useState<{ productId: string; name: string } | null>(null);
  /**
   * Arranca en la SUYA, y desde ahí puede mirar las demás.
   *
   * El inventario es lo único que se ve de todas las sucursales (ver `inventory.ts`): sin
   * eso, un vendedor tenía que decirle "no hay" a un cliente cuando en la central había
   * dos. Pero el orden importa — quien abre esta pantalla nueve de cada diez veces quiere
   * saber qué tiene ENCIMA, no qué tiene el vecino. Por eso empieza en la propia y mirar
   * otra es un gesto deliberado.
   */
  const [locationId, setLocationId] = useState(user?.locationId ?? '');

  // Todos ven la lista de sucursales: es la que permite mirar el stock de las demás.
  const { data: locations } = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<Location[]>('/locations'),
  });
  const { data: rows, isLoading } = useQuery({
    queryKey: ['inventory', locationId],
    queryFn: () =>
      api.get<InventoryRow[]>(`/inventory${locationId ? `?locationId=${locationId}` : ''}`),
  });
  const canTransfer = rows?.some((r) => r.canAdjust) ?? false;
  // Cuántos están en o por debajo del mínimo. Es el dato por el que se abre esta
  // pantalla, así que va en el encabezado y no escondido entre las filas.
  const bajos = rows?.filter((r) => r.minStock != null && r.quantity <= r.minStock).length ?? 0;
  /*
    En negativo = se vendió más de lo que había registrado.

    Se puede vender sin existencias a propósito (ver `PosPage`), así que esto no es un
    error del sistema sino una tarea pendiente para el dueño: mercadería que entró y
    nadie dio de alta. Va en el encabezado y por delante de los mínimos porque es lo
    único que hace que el inventario esté diciendo algo falso.
  */
  const negativos = rows?.filter((r) => r.quantity < 0).length ?? 0;

  return (
    <Page>
      <PageHeader
        titulo="Inventario"
        descripcion={
          negativos > 0
            ? `${negativos} ${negativos === 1 ? 'producto está' : 'productos están'} en negativo: se vendió más de lo registrado. Ajústalo para que las cuentas cuadren.`
            : bajos > 0
              ? `${bajos} ${bajos === 1 ? 'producto está' : 'productos están'} en su mínimo o por debajo.`
              : 'Stock por producto y sucursal. Nada por debajo del mínimo.'
        }
        acciones={
          <>
            <Exportar seccion="inventario" filtros={{ locationId }} />
            {canTransfer && (
              <Button variant="secondary" onClick={() => setTransferOpen(true)}>
                <ArrowLeftRight size={18} /> Transferir
              </Button>
            )}
          </>
        }
      />

      {(locations?.length ?? 0) > 1 && (
        <Select
          filter
          className="max-w-xs"
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          aria-label="Sucursal"
        >
          {/* La propia primero, marcada, para que se sepa de dónde se está mirando. */}
          {user?.locationId && (
            <option value={user.locationId}>
              {locations?.find((l) => l.id === user.locationId)?.name ?? 'Mi sucursal'} (la tuya)
            </option>
          )}
          <option value="">Todas las ubicaciones</option>
          {locations
            ?.filter((l) => l.id !== user?.locationId)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        </Select>
      )}

      {isLoading && (
        <Card>
          <CardContent className="p-0">
            <SkeletonRows filas={6} />
          </CardContent>
        </Card>
      )}

      {!isLoading && rows?.length === 0 && (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icono={Boxes}
              titulo="No hay stock que mostrar"
              descripcion="El inventario aparece cuando hay productos dados de alta. Créalos primero en Productos y aquí verás sus existencias por sucursal."
            />
          </CardContent>
        </Card>
      )}

      <Card className={rows?.length ? 'hidden md:block' : 'hidden'}>
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
                // Negativo antes que bajo: los dos se pintan en rojo, pero el negativo
                // lleva además el signo, que es lo que dice cuánto hay que ajustar.
                const negativo = r.quantity < 0;
                const low = negativo || (r.minStock != null && r.quantity <= r.minStock);
                // Fondo de aviso por token: el rosa quemado se veía como un parche
                // blanco en modo oscuro.
                return (
                  <tr key={r.id} className={low ? 'bg-danger-bg' : undefined}>
                    <td className="p-3">
                      <span className="font-medium">{r.productName}</span>{' '}
                      <span className="font-mono text-xs text-muted">{r.sku}</span>
                    </td>
                    <td className="p-3 text-muted">{r.locationName}</td>
                    <td
                      className="p-3 text-right font-bold"
                      style={{ color: low ? 'var(--color-danger)' : 'var(--color-fg)' }}
                    >
                      {r.quantity}
                    </td>
                    <td className="p-3 text-right text-muted">{r.minStock ?? '—'}</td>
                    <td className="p-3">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() =>
                            setHistory({ productId: r.productId, name: r.productName })
                          }
                          className="text-muted hover:text-primary"
                          title="Historial"
                        >
                          <History size={16} />
                        </button>
                        {r.canAdjust && (
                          <button
                            onClick={() => setAdjust(r)}
                            className="text-muted hover:text-primary"
                            title="Ajustar"
                          >
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
          {rows && rows.length === 0 && (
            <p className="py-8 text-center text-muted">Sin inventario</p>
          )}
        </CardContent>
      </Card>

      {/* Móvil: tarjetas apiladas; fila baja resaltada en rojo como en el prototipo. */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {rows?.map((r) => {
          const low = r.quantity < 0 || (r.minStock != null && r.quantity <= r.minStock);
          return (
            <div
              key={r.id}
              className="rounded-[14px] border border-border p-[15px] shadow-card"
              style={{ background: low ? 'var(--color-danger-bg)' : 'var(--color-surface)' }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <span className="text-[14px] font-semibold">{r.productName}</span>{' '}
                  <span className="font-mono text-xs text-muted">{r.sku}</span>
                </div>
                <span
                  className="shrink-0 text-[22px] font-extrabold tracking-[-0.02em]"
                  style={{ color: low ? 'var(--color-danger)' : 'var(--color-fg)' }}
                >
                  {r.quantity}
                </span>
              </div>
              <div className="mt-1 text-[12px] leading-[1.5] text-muted">
                {r.locationName} · Mínimo {r.minStock ?? '—'}
              </div>
              <div className="mt-3.5 flex gap-2">
                <button
                  onClick={() => setHistory({ productId: r.productId, name: r.productName })}
                  className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[11px] border border-border bg-surface text-[13px] font-semibold"
                >
                  <History size={16} /> Historial
                </button>
                {r.canAdjust && (
                  <button
                    onClick={() => setAdjust(r)}
                    className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[11px] border border-border bg-surface text-[13px] font-semibold"
                  >
                    <SlidersHorizontal size={16} /> Ajustar
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {rows && rows.length === 0 && <p className="py-8 text-center text-muted">Sin inventario</p>}
      </div>

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
        <HistoryModal
          productId={history.productId}
          title={`Historial · ${history.name}`}
          onClose={() => setHistory(null)}
        />
      )}
    </Page>
  );
}

function AdjustModal({
  row,
  onClose,
  onDone,
}: {
  row: InventoryRow;
  onClose: () => void;
  onDone: () => void;
}) {
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
            <Input
              inputMode="numeric"
              value={min}
              placeholder="—"
              onChange={(e) => setMin(e.target.value)}
            />
          </div>
        </div>
        <label className="text-sm text-muted">Motivo (obligatorio)</label>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ej. conteo físico, merma, ingreso"
          autoFocus
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button
          disabled={reason.trim().length < 3 || save.isPending}
          onClick={() => {
            setError(null);
            save.mutate();
          }}
        >
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
    new Map(
      rows.map((r) => [r.locationId, { id: r.locationId, name: r.locationName } as Location]),
    ).values(),
  );
  const toLocs: Location[] = Array.from(
    new Map(
      allRows.map((r) => [r.locationId, { id: r.locationId, name: r.locationName } as Location]),
    ).values(),
  );
  const products = Array.from(
    new Map(rows.map((r) => [r.productId, { id: r.productId, name: r.productName }])).values(),
  );

  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [fromLocationId, setFrom] = useState(fromLocs[0]?.id ?? '');
  const [toLocationId, setTo] = useState(toLocs.find((l) => l.id !== fromLocs[0]?.id)?.id ?? '');
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState<string | null>(null);

  const stockAt = (loc: string) =>
    allRows.find((r) => r.productId === productId && r.locationId === loc)?.quantity ?? 0;

  const transfer = useMutation({
    mutationFn: () =>
      api.post('/inventory/transfer', {
        productId,
        fromLocationId,
        toLocationId,
        quantity: Number(quantity),
      }),
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
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button
          disabled={transfer.isPending || Number(quantity) < 1 || fromLocationId === toLocationId}
          onClick={() => {
            setError(null);
            transfer.mutate();
          }}
        >
          Transferir
        </Button>
      </div>
    </Modal>
  );
}
