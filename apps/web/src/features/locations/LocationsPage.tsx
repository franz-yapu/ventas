import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/api';
import type { Location } from '@/lib/types';

export function LocationsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');

  const { data } = useQuery({ queryKey: ['locations'], queryFn: () => api.get<Location[]>('/locations') });

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
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Ubicaciones</h1>
        <Button onClick={() => setOpen(true)}>
          <Plus size={18} /> Nueva
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
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
                    <Badge tone={l.isActive ? 'success' : 'neutral'}>{l.isActive ? 'Activa' : 'Inactiva'}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

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
    </div>
  );
}
