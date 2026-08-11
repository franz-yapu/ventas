import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { EliminarModal } from '@/components/EliminarModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { EmptyState, Page, PageHeader, SkeletonRows } from '@/components/ui/page';
import { api, ApiError } from '@/lib/api';
import type { Location } from '@/lib/types';

export function LocationsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [borrando, setBorrando] = useState<Location | null>(null);
  const [avisoPrincipal, setAvisoPrincipal] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<Location[]>('/locations'),
  });

  const create = useMutation({
    mutationFn: () => api.post('/locations', { name, address }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations'] });
      setOpen(false);
      setName('');
      setAddress('');
    },
  });

  /**
   * Mover el cargo de sucursal principal.
   *
   * Está aquí porque sin ello el borrado tiene una salida cerrada: la principal no se
   * puede eliminar, y el 409 dice «nombra principal a otra antes» — una instrucción que
   * hasta hoy **no se podía cumplir desde ninguna pantalla**, aunque el API tuviera la
   * ruta desde hace semanas. Un mensaje de error que manda a hacer algo imposible es
   * peor que no explicar nada.
   *
   * Ojo: cambiar el cargo **echa a quien estuviera dentro** en la sucursal vieja o en la
   * nueva, porque su alcance cambió. El servidor lo dice en su respuesta y se enseña.
   */
  const hacerPrincipal = useMutation({
    mutationFn: (id: string) => api.patch<{ mensaje: string }>(`/locations/${id}/principal`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['locations'] });
      setAvisoPrincipal(r.mensaje);
    },
    onError: (e) =>
      setAvisoPrincipal(e instanceof ApiError ? e.message : 'No se pudo cambiar la principal.'),
  });

  return (
    <Page>
      <PageHeader
        titulo="Ubicaciones"
        descripcion="Las sucursales del negocio. La central ve y administra todas; cada sucursal, sólo la suya."
        acciones={
          <Button onClick={() => setOpen(true)}>
            <Plus size={18} /> Nueva
          </Button>
        }
      />

      {isLoading && (
        <Card>
          <CardContent className="p-0">
            <SkeletonRows filas={3} />
          </CardContent>
        </Card>
      )}

      {!isLoading && data?.length === 0 && (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icono={MapPin}
              titulo="Aún no hay ubicaciones"
              descripcion="Todo negocio necesita al menos una. La primera se crea sola al darte de alta, así que si no ves ninguna, algo salió mal en el registro."
              accion={
                <Button onClick={() => setOpen(true)}>
                  <Plus size={18} /> Nueva ubicación
                </Button>
              }
            />
          </CardContent>
        </Card>
      )}

      <Card className={data?.length ? 'hidden md:block' : 'hidden'}>
        <CardContent className="p-0">
          <table className="ds-table w-full">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                <th className="p-3">Nombre</th>
                <th className="p-3">Dirección</th>
                <th className="p-3">Estado</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {data?.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="p-3 font-medium">
                    <span className="flex items-center gap-2">
                      {l.name}
                      {l.isCentral && <Badge tone="neutral">Principal</Badge>}
                    </span>
                  </td>
                  <td className="p-3 text-muted">{l.address ?? '—'}</td>
                  <td className="p-3">
                    <Badge tone={l.isActive ? 'success' : 'neutral'}>
                      {l.isActive ? 'Activa' : 'Inactiva'}
                    </Badge>
                  </td>
                  <td className="p-3">
                    <div className="flex justify-end gap-3">
                      {/* La principal no ofrece ninguna de las dos: no se elimina, y
                          hacerla principal otra vez no significa nada. */}
                      {!l.isCentral && (
                        <>
                          <button
                            onClick={() => hacerPrincipal.mutate(l.id)}
                            disabled={hacerPrincipal.isPending}
                            className="text-muted hover:text-primary"
                            title="Hacer principal"
                            aria-label={`Hacer principal ${l.name}`}
                          >
                            <Star size={16} />
                          </button>
                          <button
                            onClick={() => setBorrando(l)}
                            className="text-muted hover:text-danger"
                            title="Eliminar"
                            aria-label={`Eliminar ${l.name}`}
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
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
        {data?.map((l) => (
          <div
            key={l.id}
            className="rounded-[14px] border border-border bg-surface p-[15px] shadow-card"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[14px] font-semibold">
                {l.name}
                {l.isCentral && <Badge tone="neutral">Principal</Badge>}
              </span>
              <Badge tone={l.isActive ? 'success' : 'neutral'}>
                {l.isActive ? 'Activa' : 'Inactiva'}
              </Badge>
            </div>
            <div className="mt-1 text-[12px] leading-[1.5] text-muted">{l.address ?? '—'}</div>
            {!l.isCentral && (
              <div className="mt-3.5 flex gap-2">
                <button
                  onClick={() => hacerPrincipal.mutate(l.id)}
                  disabled={hacerPrincipal.isPending}
                  className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[11px] border border-border bg-surface text-[13px] font-semibold"
                >
                  <Star size={16} /> Hacer principal
                </button>
                <button
                  onClick={() => setBorrando(l)}
                  aria-label={`Eliminar ${l.name}`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] border border-danger/30 bg-danger-bg text-danger"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Nueva ubicación">
        <div className="flex flex-col gap-3">
          <label className="text-sm text-muted">Nombre</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
          <label className="text-sm text-muted">Dirección</label>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          <Button disabled={name.length < 1 || create.isPending} onClick={() => create.mutate()}>
            Guardar
          </Button>
        </div>
      </Modal>

      {borrando && (
        <EliminarModal
          que={`la sucursal «${borrando.name}»`}
          advertencia="Si nunca vendió ni tuvo caja ni stock, se elimina y no se puede deshacer. Si tiene historial, se desactivará en su lugar y te diremos qué tiene."
          onEliminar={async () => {
            const r = await api.del<{ eliminada: boolean; mensaje: string; colgando?: string[] }>(
              `/locations/${borrando.id}`,
            );
            return { eliminado: r.eliminada, mensaje: r.mensaje, colgando: r.colgando };
          }}
          onCambio={() => qc.invalidateQueries({ queryKey: ['locations'] })}
          onCerrar={() => setBorrando(null)}
        />
      )}

      {/* Sale del cambio de principal, y sirve para las dos caras: cuando funciona avisa
          de a quién echó, y cuando no, dice por qué. Las dos cosas hay que leerlas. */}
      {avisoPrincipal && (
        <Modal open onClose={() => setAvisoPrincipal(null)} title="Sucursal principal">
          <div className="flex flex-col gap-4">
            <p className="text-[13px] leading-[1.5]">{avisoPrincipal}</p>
            <Button onClick={() => setAvisoPrincipal(null)}>Entendido</Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}
