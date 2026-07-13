import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { api, ApiError } from '@/lib/api';
import type { AppUserRow, Location } from '@/lib/types';

export function UsersPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', username: '', password: '', role: 'seller', locationId: '' });

  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => api.get<AppUserRow[]>('/users') });
  const { data: locations } = useQuery({ queryKey: ['locations'], queryFn: () => api.get<Location[]>('/locations') });

  const create = useMutation({
    mutationFn: () =>
      api.post('/users', {
        name: form.name,
        username: form.username,
        password: form.password,
        role: form.role,
        locationId: form.locationId || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setOpen(false);
      setForm({ name: '', username: '', password: '', role: 'seller', locationId: '' });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Error al crear'),
  });

  const locName = (id: string | null) => locations?.find((l) => l.id === id)?.name ?? '—';

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Usuarios</h1>
        <Button onClick={() => { setError(null); setOpen(true); }}>
          <Plus size={18} /> Nuevo
        </Button>
      </div>

      <Card className="hidden md:block">
        <CardContent className="p-0">
          <table className="ds-table w-full">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                <th className="p-3">Nombre</th>
                <th className="p-3">Usuario</th>
                <th className="p-3">Rol</th>
                <th className="p-3">Ubicación</th>
                <th className="p-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {users?.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="p-3 font-medium">{u.name}</td>
                  <td className="p-3 font-mono text-muted">{u.username}</td>
                  <td className="p-3">{u.role === 'admin' ? 'Administrador' : 'Vendedor'}</td>
                  <td className="p-3 text-muted">{locName(u.locationId)}</td>
                  <td className="p-3">
                    <Badge tone={u.isActive ? 'success' : 'neutral'}>{u.isActive ? 'Activo' : 'Inactivo'}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Móvil: tarjetas apiladas en vez de tabla. */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {users?.map((u) => (
          <div key={u.id} className="rounded-[14px] border border-border bg-surface p-[15px] shadow-card">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[14px] font-semibold">{u.name}</span>
              <Badge tone={u.isActive ? 'success' : 'neutral'}>{u.isActive ? 'Activo' : 'Inactivo'}</Badge>
            </div>
            <div className="mt-1 text-[12px] leading-[1.5] text-muted">
              <span className="font-mono">{u.username}</span> · {u.role === 'admin' ? 'Administrador' : 'Vendedor'}
              <br />
              {locName(u.locationId)}
            </div>
          </div>
        ))}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Nuevo usuario">
        <div className="flex flex-col gap-3">
          <label className="text-sm text-muted">Nombre</label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <label className="text-sm text-muted">Usuario</label>
          <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <label className="text-sm text-muted">Contraseña</label>
          <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <label className="text-sm text-muted">Rol</label>
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="seller">Vendedor</option>
            <option value="admin">Administrador</option>
          </Select>
          <label className="text-sm text-muted">Ubicación (opcional)</label>
          <Select value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
            <option value="">Sin asignar</option>
            {locations?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button
            disabled={form.name.length < 1 || form.username.length < 3 || form.password.length < 6 || create.isPending}
            onClick={() => create.mutate()}
          >
            Guardar
          </Button>
        </div>
      </Modal>
    </div>
  );
}
