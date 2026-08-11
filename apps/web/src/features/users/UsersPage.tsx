import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { EliminarModal } from '@/components/EliminarModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { EmptyState, Page, PageHeader, SkeletonRows } from '@/components/ui/page';
import { Select } from '@/components/ui/select';
import { api, ApiError } from '@/lib/api';
import type { AppUserRow, Location } from '@/lib/types';

interface Credentials {
  username: string;
  password: string;
}

export function UsersPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<AppUserRow | 'new' | null>(null);
  // Cuando el admin asigna/cambia una contraseña, se muestra este modal para que
  // la copie y se la envíe al usuario.
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [borrando, setBorrando] = useState<AppUserRow | null>(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<AppUserRow[]>('/users'),
  });
  const { data: locations } = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<Location[]>('/locations'),
  });

  const locName = (id: string | null) => locations?.find((l) => l.id === id)?.name ?? '—';

  return (
    <Page>
      <PageHeader
        titulo="Usuarios"
        descripcion="Quién puede entrar y con qué permisos. Un vendedor sólo ve su sucursal."
        acciones={
          <Button onClick={() => setEditing('new')}>
            <Plus size={18} /> Nuevo
          </Button>
        }
      />

      {isLoading && (
        <Card>
          <CardContent className="p-0">
            <SkeletonRows filas={4} />
          </CardContent>
        </Card>
      )}

      {!isLoading && users?.length === 0 && (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icono={Users}
              titulo="Sólo estás tú"
              descripcion="Da de alta a quien atienda el mostrador. Un vendedor no ve costos ni ganancias, y sólo trabaja sobre el stock de su sucursal."
              accion={
                <Button onClick={() => setEditing('new')}>
                  <Plus size={18} /> Nuevo usuario
                </Button>
              }
            />
          </CardContent>
        </Card>
      )}

      <Card className={users?.length ? 'hidden md:block' : 'hidden'}>
        <CardContent className="p-0">
          <table className="ds-table w-full">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                <th className="p-3">Nombre</th>
                <th className="p-3">Usuario</th>
                <th className="p-3">Rol</th>
                <th className="p-3">Ubicación</th>
                <th className="p-3">Estado</th>
                <th className="p-3"></th>
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
                    <Badge tone={u.isActive ? 'success' : 'neutral'}>
                      {u.isActive ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </td>
                  <td className="p-3">
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => setEditing(u)}
                        className="text-muted hover:text-primary"
                        title="Editar"
                        aria-label={`Editar ${u.name}`}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => setBorrando(u)}
                        className="text-muted hover:text-danger"
                        title="Eliminar"
                        aria-label={`Eliminar ${u.name}`}
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
        {users?.map((u) => (
          <div
            key={u.id}
            className="rounded-[14px] border border-border bg-surface p-[15px] shadow-card"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[14px] font-semibold">{u.name}</span>
              <Badge tone={u.isActive ? 'success' : 'neutral'}>
                {u.isActive ? 'Activo' : 'Inactivo'}
              </Badge>
            </div>
            <div className="mt-1 text-[12px] leading-[1.5] text-muted">
              <span className="font-mono">{u.username}</span> ·{' '}
              {u.role === 'admin' ? 'Administrador' : 'Vendedor'}
              <br />
              {locName(u.locationId)}
            </div>
            <div className="mt-3.5 flex gap-2">
              <button
                onClick={() => setEditing(u)}
                className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[11px] border border-field bg-surface text-[13px] font-semibold"
              >
                <Pencil size={16} /> Editar
              </button>
              <button
                onClick={() => setBorrando(u)}
                aria-label={`Eliminar ${u.name}`}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] border border-danger/30 bg-danger-bg text-danger"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <UserForm
          user={editing === 'new' ? null : editing}
          locations={locations ?? []}
          onClose={() => setEditing(null)}
          onSaved={(creds) => {
            qc.invalidateQueries({ queryKey: ['users'] });
            setEditing(null);
            if (creds) setCredentials(creds);
          }}
        />
      )}

      {credentials && <CredentialsModal creds={credentials} onClose={() => setCredentials(null)} />}

      {borrando && (
        <EliminarModal
          que={`a ${borrando.name}`}
          advertencia="Si nunca vendió ni movió caja, se elimina y no se puede deshacer. Si tiene historial, se desactivará en su lugar: deja de entrar, y lo que hizo se conserva con su nombre."
          onEliminar={async () => {
            const r = await api.del<{ eliminado: boolean; mensaje: string; colgando?: string[] }>(
              `/users/${borrando.id}`,
            );
            return r;
          }}
          onCambio={() => qc.invalidateQueries({ queryKey: ['users'] })}
          onCerrar={() => setBorrando(null)}
        />
      )}
    </Page>
  );
}

function UserForm({
  user,
  locations,
  onClose,
  onSaved,
}: {
  user: AppUserRow | null;
  locations: Location[];
  onClose: () => void;
  onSaved: (creds: Credentials | null) => void;
}) {
  const isNew = !user;
  const [form, setForm] = useState({
    name: user?.name ?? '',
    username: user?.username ?? '',
    password: '',
    role: user?.role ?? 'seller',
    locationId: user?.locationId ?? '',
    isActive: user?.isActive ?? true,
  });
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      if (isNew) {
        return api.post('/users', {
          name: form.name,
          username: form.username,
          password: form.password,
          role: form.role,
          locationId: form.locationId || null,
        });
      }
      const patch: Record<string, unknown> = {
        name: form.name,
        role: form.role,
        locationId: form.locationId || null,
        isActive: form.isActive,
      };
      if (form.password) patch.password = form.password;
      return api.patch(`/users/${user!.id}`, patch);
    },
    // Si se asignó una contraseña, la devolvemos para mostrar el modal de "copiar y enviar".
    onSuccess: () =>
      onSaved(form.password ? { username: form.username, password: form.password } : null),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Error al guardar'),
  });

  const passwordInvalid = form.password.length > 0 && form.password.length < 6;
  const canSave =
    form.name.length >= 1 &&
    // Un vendedor sin sucursal queda con la app vacía y muda; el API también lo rechaza.
    (form.role !== 'seller' || !!form.locationId) &&
    (isNew ? form.username.length >= 3 && form.password.length >= 6 : !passwordInvalid) &&
    !save.isPending;

  return (
    <Modal open onClose={onClose} title={isNew ? 'Nuevo usuario' : `Editar · ${user!.name}`}>
      <div className="flex flex-col gap-3">
        <label className="text-sm text-muted">Nombre</label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />

        <label className="text-sm text-muted">Usuario</label>
        <Input
          value={form.username}
          disabled={!isNew}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
        />
        {!isNew && (
          <p className="-mt-2 text-xs text-muted">El nombre de usuario no se puede cambiar.</p>
        )}

        <label className="text-sm text-muted">
          {isNew ? 'Contraseña' : 'Nueva contraseña (opcional)'}
        </label>
        <Input
          type="text"
          autoComplete="new-password"
          placeholder={isNew ? 'Mín. 6 caracteres' : 'Dejar en blanco para no cambiarla'}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        {passwordInvalid && <p className="-mt-2 text-xs text-danger">Mínimo 6 caracteres.</p>}
        {!isNew && (
          <p className="-mt-1 text-xs text-muted">
            Si la cambias, se te mostrará para que la copies y se la envíes al usuario.
          </p>
        )}

        <label className="text-sm text-muted">Rol</label>
        <Select
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'seller' })}
        >
          <option value="seller">Vendedor</option>
          <option value="admin">Administrador</option>
        </Select>

        {/* Para un vendedor la ubicación NO es opcional: sin ella no puede vender ni
            ver nada, y la app se le queda vacía sin decirle por qué. */}
        <label className="text-sm text-muted">
          Ubicación{form.role === 'seller' ? '' : ' (opcional)'}
        </label>
        <Select
          value={form.locationId ?? ''}
          onChange={(e) => setForm({ ...form, locationId: e.target.value })}
        >
          <option value="">{form.role === 'seller' ? 'Elige una sucursal' : 'Sin asignar'}</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
        {form.role === 'seller' && !form.locationId && (
          <p className="-mt-1 text-xs text-warning">
            Un vendedor necesita una sucursal: sin ella no podría vender ni ver nada.
          </p>
        )}

        {!isNew && (
          <label className="mt-1 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            Usuario activo
          </label>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
        <Button
          disabled={!canSave}
          onClick={() => {
            setError(null);
            save.mutate();
          }}
        >
          Guardar
        </Button>
      </div>
    </Modal>
  );
}

function CredentialsModal({ creds, onClose }: { creds: Credentials; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(creds.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Contraseña asignada">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          Copia esta contraseña y envíala al usuario{' '}
          <span className="font-semibold text-fg">{creds.username}</span>. Podrá iniciar sesión con
          ella y luego cambiarla desde <span className="font-semibold text-fg">Mi perfil</span>.
        </p>
        <div className="flex items-center gap-2 rounded-theme border border-border bg-muted/10 p-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted">Usuario</div>
            <div className="truncate font-mono text-sm">{creds.username}</div>
            <div className="mt-2 text-xs text-muted">Contraseña</div>
            <div className="truncate font-mono text-base font-semibold">{creds.password}</div>
          </div>
          <Button variant="outline" onClick={copy} className="shrink-0">
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? 'Copiado' : 'Copiar'}
          </Button>
        </div>
        <p className="text-xs text-muted">
          Esta contraseña no se volverá a mostrar. Si la pierdes, asígnale una nueva.
        </p>
        <Button onClick={onClose}>Listo</Button>
      </div>
    </Modal>
  );
}
