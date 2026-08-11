import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Phone, Plus, Search, Trash2, UserRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EliminarModal } from '@/components/EliminarModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { EmptyState, Page, PageHeader, SkeletonRows } from '@/components/ui/page';
import { api, ApiError } from '@/lib/api';
import { dateTime, etiquetaDeEstado, money } from '@/lib/format';
import type { Customer, CustomerDetail } from '@/lib/types';

/**
 * Clientes: a quién se le vendió, y qué le vendimos.
 *
 * Esta pantalla no existía. El API tenía `/customers` desde la fase 6, el POS venía
 * llenando `sale.customer_id` en cada venta con comprador… y **no había ninguna ruta en la
 * web que leyera nada de eso**. El mismo agujero que dejó los `DELETE` de sucursales y
 * usuarios sin interfaz: función terminada por dentro, inalcanzable por fuera.
 *
 * Nació para el fiado y el fiado se quitó, así que lo que queda —y lo que justifica la
 * pantalla— es el historial: cuando alguien vuelve seis meses después con una llanta en la
 * mano, la pregunta es «¿qué le vendimos y cuándo?», y hasta hoy el dato estaba guardado
 * sin forma de mirarlo.
 *
 * ## Dónde vive, y por qué no está en la barra de abajo
 *
 * Va bajo Administración y no en el menú operativo. La barra inferior del móvil ya llega a
 * seis columnas para un administrador, y una séptima rompe lo único que la hace usable:
 * que cada destino esté siempre en el mismo sitio. Además el vendedor ya tiene lo que
 * necesita —dar de alta a un comprador— en la propia pantalla de cobro.
 */
export function CustomersPage() {
  const qc = useQueryClient();
  const [busqueda, setBusqueda] = useState('');
  const [editando, setEditando] = useState<Customer | 'nuevo' | null>(null);
  const [borrando, setBorrando] = useState<Customer | null>(null);
  const [viendo, setViendo] = useState<Customer | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get<Customer[]>('/customers'),
  });

  /*
    El filtro es local y no una consulta al servidor: son cientos de filas, no cientos de
    miles, y ya están todas aquí porque el selector del POS necesita la lista entera. Pedir
    otra vez al servidor por cada letra sería más lento y no más correcto.
  */
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return data ?? [];
    return (data ?? []).filter(
      (c) => c.name.toLowerCase().includes(q) || (c.phone ?? '').toLowerCase().includes(q),
    );
  }, [data, busqueda]);

  const refrescar = () => qc.invalidateQueries({ queryKey: ['customers'] });

  return (
    <Page>
      <PageHeader
        titulo="Clientes"
        descripcion="A quién le vendes. El nombre sale en el recibo y en la exportación de ventas; toca uno para ver qué le vendiste."
        acciones={
          <Button onClick={() => setEditando('nuevo')}>
            <Plus size={18} /> Nuevo
          </Button>
        }
      />

      {!!data?.length && (
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o teléfono"
            className="pl-9"
          />
        </div>
      )}

      {isLoading && (
        <Card>
          <CardContent className="p-0">
            <SkeletonRows filas={4} />
          </CardContent>
        </Card>
      )}

      {!isLoading && data?.length === 0 && (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icono={UserRound}
              titulo="Todavía no hay clientes"
              descripcion="No hace falta registrar a nadie para vender. Se dan de alta desde la pantalla de cobro, cuando quieres que el recibo lleve un nombre o poder mirar después qué le vendiste."
              accion={
                <Button onClick={() => setEditando('nuevo')}>
                  <Plus size={18} /> Nuevo cliente
                </Button>
              }
            />
          </CardContent>
        </Card>
      )}

      {!isLoading && !!data?.length && filtrados.length === 0 && (
        <Card>
          <CardContent className="p-0">
            <EmptyState titulo="Ninguno coincide" descripcion={`Nada para «${busqueda}».`} />
          </CardContent>
        </Card>
      )}

      <Card className={filtrados.length ? 'hidden md:block' : 'hidden'}>
        <CardContent className="p-0">
          <table className="ds-table w-full">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                <th className="p-3">Nombre</th>
                <th className="p-3">Teléfono</th>
                <th className="p-3">Compras</th>
                <th className="p-3">Última</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="p-3 font-medium">
                    <button
                      onClick={() => setViendo(c)}
                      className="flex items-center gap-2 text-left hover:text-primary"
                    >
                      {c.name}
                      {!c.isActive && <Badge tone="neutral">Inactivo</Badge>}
                    </button>
                  </td>
                  <td className="p-3 text-muted">{c.phone ?? '—'}</td>
                  <td className="p-3">{c.compras}</td>
                  <td className="p-3 text-muted">
                    {c.ultimaCompra ? dateTime(c.ultimaCompra) : '—'}
                  </td>
                  <td className="p-3">
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => setEditando(c)}
                        className="text-muted hover:text-primary"
                        title="Editar"
                        aria-label={`Editar ${c.name}`}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => setBorrando(c)}
                        className="text-muted hover:text-danger"
                        title="Eliminar"
                        aria-label={`Eliminar ${c.name}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Móvil: tarjetas apiladas en vez de tabla. */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {filtrados.map((c) => (
          <div
            key={c.id}
            className="rounded-[14px] border border-border bg-surface p-[15px] shadow-card"
          >
            <button onClick={() => setViendo(c)} className="w-full text-left">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[14px] font-semibold">
                  {c.name}
                  {!c.isActive && <Badge tone="neutral">Inactivo</Badge>}
                </span>
                <span className="shrink-0 text-[12px] text-muted">
                  {c.compras === 1 ? '1 compra' : `${c.compras} compras`}
                </span>
              </div>
              <div className="mt-1 text-[12px] leading-[1.5] text-muted">
                {c.phone ?? 'Sin teléfono'}
                {c.ultimaCompra && ` · última ${dateTime(c.ultimaCompra)}`}
              </div>
            </button>
            <div className="mt-3.5 flex gap-2">
              <button
                onClick={() => setEditando(c)}
                className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[11px] border border-field bg-surface text-[13px] font-semibold"
              >
                <Pencil size={16} /> Editar
              </button>
              <button
                onClick={() => setBorrando(c)}
                aria-label={`Eliminar ${c.name}`}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] border border-danger/30 bg-danger-bg text-danger"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {editando && (
        <FormularioCliente
          cliente={editando === 'nuevo' ? null : editando}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            refrescar();
            setEditando(null);
          }}
        />
      )}

      {viendo && <DetalleCliente cliente={viendo} onCerrar={() => setViendo(null)} />}

      {borrando && (
        <EliminarModal
          que={`a ${borrando.name}`}
          advertencia="Si nunca te compró, se elimina y no se puede deshacer. Si tiene compras, se desactivará: deja de aparecer al vender, y sus recibos siguen llevando su nombre."
          onEliminar={() =>
            api.del<{ eliminado: boolean; mensaje: string; colgando?: string[] }>(
              `/customers/${borrando.id}`,
            )
          }
          onCambio={refrescar}
          onCerrar={() => setBorrando(null)}
        />
      )}
    </Page>
  );
}

function FormularioCliente({
  cliente,
  onCerrar,
  onGuardado,
}: {
  cliente: Customer | null;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const esNuevo = !cliente;
  const [form, setForm] = useState({
    name: cliente?.name ?? '',
    phone: cliente?.phone ?? '',
    notes: cliente?.notes ?? '',
    isActive: cliente?.isActive ?? true,
  });
  const [error, setError] = useState<string | null>(null);

  const guardar = useMutation({
    mutationFn: () => {
      const cuerpo = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        notes: form.notes.trim() || null,
      };
      if (esNuevo) return api.post('/customers', cuerpo);
      return api.patch(`/customers/${cliente!.id}`, { ...cuerpo, isActive: form.isActive });
    },
    onSuccess: onGuardado,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo guardar'),
  });

  return (
    <Modal open onClose={onCerrar} title={esNuevo ? 'Nuevo cliente' : `Editar · ${cliente!.name}`}>
      <div className="flex flex-col gap-3">
        <label className="text-sm text-muted">Nombre</label>
        <Input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Cómo lo llamas"
        />

        <label className="text-sm text-muted">Teléfono (opcional)</label>
        <Input
          type="tel"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />

        <label className="text-sm text-muted">Nota (opcional)</label>
        <Input
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="Lo que te sirva recordar"
        />

        {/* Sólo al editar: un cliente nuevo nace activo, y ofrecer lo contrario sería
            ofrecer dar de alta a alguien que no aparecerá al vender. */}
        {!esNuevo && (
          <label className="mt-1 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            Aparece al vender
          </label>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
        <Button
          disabled={form.name.trim().length < 1 || guardar.isPending}
          onClick={() => {
            setError(null);
            guardar.mutate();
          }}
        >
          Guardar
        </Button>
      </div>
    </Modal>
  );
}

/** Sus datos y sus compras. Es la razón de ser de la pantalla. */
function DetalleCliente({ cliente, onCerrar }: { cliente: Customer; onCerrar: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['customers', cliente.id],
    queryFn: () => api.get<CustomerDetail>(`/customers/${cliente.id}`),
  });

  return (
    <Modal open onClose={onCerrar} title={cliente.name} className="sm:max-w-lg">
      <div className="flex flex-col gap-4">
        {(data?.phone || data?.notes) && (
          <div className="flex flex-col gap-1 text-[13px]">
            {data.phone && (
              <span className="flex items-center gap-2 text-muted">
                <Phone size={14} /> {data.phone}
              </span>
            )}
            {data.notes && <p className="text-muted">{data.notes}</p>}
          </div>
        )}

        {data && (
          <div className="flex items-baseline justify-between rounded-theme bg-bg p-3">
            <span className="text-[13px] text-muted">
              {data.compras.length === 1 ? '1 compra' : `${data.compras.length} compras`}
            </span>
            <span className="text-[15px] font-bold">{money(data.totalGastado)}</span>
          </div>
        )}

        {isLoading && <SkeletonRows filas={3} />}

        {data && data.compras.length === 0 && (
          <p className="text-[13px] text-muted">
            Todavía no le has vendido nada. Aparecerá aquí en cuanto lo elijas como comprador al
            cobrar.
          </p>
        )}

        {!!data?.compras.length && (
          <ul className="flex flex-col">
            {data.compras.map((v) => (
              <li
                key={v.id}
                className="flex items-baseline justify-between gap-3 border-b border-border py-2.5 last:border-0"
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold">
                    {v.receiptNumber ? `Recibo #${v.receiptNumber}` : 'Sin recibo'}
                    {v.status !== 'completed' && (
                      <span className="ml-2 text-[12px] font-normal text-danger">
                        {etiquetaDeEstado(v.status)}
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-muted">
                    {dateTime(v.clientCreatedAt)}
                    {v.locationName && ` · ${v.locationName}`}
                  </div>
                </div>
                <span
                  className={
                    v.status === 'completed'
                      ? 'shrink-0 text-[13px] font-semibold'
                      : 'shrink-0 text-[13px] font-semibold text-muted line-through'
                  }
                >
                  {money(v.total)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <Button variant="outline" onClick={onCerrar}>
          Cerrar
        </Button>
      </div>
    </Modal>
  );
}
