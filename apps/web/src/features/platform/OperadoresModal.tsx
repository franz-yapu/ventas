import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, ShieldCheck, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { usePlatformAuth } from '@/features/platform/PlatformAuthProvider';
import { platformApi } from '@/lib/api';

interface Operador {
  id: string;
  email: string;
  name: string;
  isOwner: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/**
 * Alta y baja de operadores del panel. Sólo la ve un operador PRINCIPAL.
 *
 * No hay borrar, sólo desactivar: la bitácora de plataforma apunta a estas cuentas, y
 * "quién suspendió a este cliente" tiene que seguir leyéndose dentro de dos años.
 */
export function OperadoresModal({ onClose }: { onClose: () => void }) {
  const { admin } = usePlatformAuth();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  const { data: operadores, isLoading } = useQuery({
    queryKey: ['platform', 'admins'],
    queryFn: () => platformApi.get<Operador[]>('/platform/admins'),
  });

  const editar = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      platformApi.patch(`/platform/admins/${id}`, body),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['platform', 'admins'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal open onClose={onClose} title="Operadores del panel">
      <div className="flex flex-col gap-4">
        {isLoading && <div className="text-muted">Cargando…</div>}

        <ul className="divide-y divide-border">
          {operadores?.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{o.name}</span>
                  {o.isOwner && (
                    <Badge tone="info">
                      <ShieldCheck size={11} /> Principal
                    </Badge>
                  )}
                  {!o.isActive && <Badge tone="neutral">Inactivo</Badge>}
                  {o.id === admin?.sub && <Badge tone="success">Tú</Badge>}
                </div>
                <div className="truncate text-[13px] text-muted">{o.email}</div>
                <div className="text-[12px] text-muted">
                  {o.lastLoginAt
                    ? `Última entrada: ${new Date(o.lastLoginAt).toLocaleString('es-BO')}`
                    : 'Nunca entró'}
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                {o.id !== admin?.sub && (
                  <>
                    <Button
                      variant={o.isActive ? 'danger' : 'outline'}
                      className="h-8 px-2 text-[12px]"
                      disabled={editar.isPending}
                      onClick={() => editar.mutate({ id: o.id, body: { isActive: !o.isActive } })}
                    >
                      {o.isActive ? 'Desactivar' : 'Reactivar'}
                    </Button>
                    <Button
                      variant="outline"
                      className="h-8 px-2 text-[12px]"
                      disabled={editar.isPending}
                      onClick={() => editar.mutate({ id: o.id, body: { isOwner: !o.isOwner } })}
                    >
                      {o.isOwner ? 'Quitar principal' : 'Hacer principal'}
                    </Button>
                    <NuevaClave id={o.id} onError={setError} />
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>

        {error && <p className="text-[13px] text-danger">{error}</p>}

        {creando ? (
          <FormularioAlta
            onListo={() => {
              setCreando(false);
              qc.invalidateQueries({ queryKey: ['platform', 'admins'] });
            }}
            onCancelar={() => setCreando(false)}
          />
        ) : (
          <Button variant="outline" onClick={() => setCreando(true)}>
            <UserPlus size={15} /> Nuevo operador
          </Button>
        )}

        <Button onClick={onClose}>Cerrar</Button>
      </div>
    </Modal>
  );
}

/**
 * Contraseña nueva para OTRO operador. La escribe el principal y se la pasa; no se
 * genera sola porque aquí no hay a quién mandarle un correo: los operadores no tienen
 * flujo de recuperación, por decisión del plan.
 */
function NuevaClave({ id, onError }: { id: string; onError: (m: string) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [clave, setClave] = useState('');
  const [listo, setListo] = useState(false);

  const guardar = useMutation({
    mutationFn: () => platformApi.patch(`/platform/admins/${id}`, { password: clave }),
    onSuccess: () => {
      setListo(true);
      setClave('');
      setAbierto(false);
    },
    onError: (e: Error) => onError(e.message),
  });

  if (!abierto) {
    return (
      <Button variant="outline" className="h-8 px-2 text-[12px]" onClick={() => setAbierto(true)}>
        <KeyRound size={12} /> {listo ? 'Clave cambiada' : 'Nueva clave'}
      </Button>
    );
  }
  return (
    <div className="flex gap-1">
      <Input
        type="password"
        autoComplete="new-password"
        value={clave}
        onChange={(e) => setClave(e.target.value)}
        placeholder="Mínimo 12"
        className="h-8 w-32 text-[12px]"
      />
      <Button
        className="h-8 px-2 text-[12px]"
        disabled={clave.length < 12 || guardar.isPending}
        onClick={() => guardar.mutate()}
      >
        OK
      </Button>
    </div>
  );
}

function FormularioAlta({ onListo, onCancelar }: { onListo: () => void; onCancelar: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isOwner, setIsOwner] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const crear = useMutation({
    mutationFn: () => platformApi.post('/platform/admins', { name, email, password, isOwner }),
    onSuccess: onListo,
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="flex flex-col gap-3 rounded-theme border border-border p-3">
      <div className="text-[13px] font-semibold">Nuevo operador</div>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" />
      <Input
        type="email"
        autoCapitalize="none"
        autoCorrect="off"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="correo@ejemplo.com"
      />
      <Input
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Contraseña (mínimo 12)"
      />
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={isOwner}
          onChange={(e) => setIsOwner(e.target.checked)}
          className="h-4 w-4"
        />
        Principal — podrá crear y desactivar operadores
      </label>
      <p className="text-[12px] text-muted">
        Pásale la contraseña por un canal aparte. Los operadores no tienen recuperación por correo:
        si la pierde, se la cambias tú desde aquí.
      </p>
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button
          className="flex-1"
          disabled={crear.isPending || !name || !email || password.length < 12}
          onClick={() => crear.mutate()}
        >
          {crear.isPending ? 'Creando…' : 'Crear'}
        </Button>
      </div>
    </div>
  );
}
