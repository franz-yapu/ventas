import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { EmptyState, Page, PageHeader, SkeletonRows } from '@/components/ui/page';
import { api } from '@/lib/api';
import type { Location } from '@/lib/types';

export function LocationsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');

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
              </tr>
            </thead>
            <tbody>
              {data?.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="p-3 font-medium">{l.name}</td>
                  <td className="p-3 text-muted">{l.address ?? '—'}</td>
                  <td className="p-3">
                    <Badge tone={l.isActive ? 'success' : 'neutral'}>
                      {l.isActive ? 'Activa' : 'Inactiva'}
                    </Badge>
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
              <span className="text-[14px] font-semibold">{l.name}</span>
              <Badge tone={l.isActive ? 'success' : 'neutral'}>
                {l.isActive ? 'Activa' : 'Inactiva'}
              </Badge>
            </div>
            <div className="mt-1 text-[12px] leading-[1.5] text-muted">{l.address ?? '—'}</div>
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
    </Page>
  );
}
