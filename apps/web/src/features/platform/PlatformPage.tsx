import type { EffectiveStatus, SubscriptionStatus } from '@ventafacil/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, LogOut, Search, ShieldCheck, UserCog, Users } from 'lucide-react';
import { useState } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { MiCuentaModal } from '@/features/platform/MiCuentaModal';
import { OperadoresModal } from '@/features/platform/OperadoresModal';
import { usePlatformAuth } from '@/features/platform/PlatformAuthProvider';
import type { PlanInfo } from '@/features/subscription/SubscriptionProvider';
import { platformApi } from '@/lib/api';

/** Cuánto falta para el próximo corte. Lo calcula el servidor: manda su reloj. */
interface Vence {
  concepto: 'prueba' | 'periodo';
  fecha: string;
  dias: number;
}

interface TenantRow {
  id: string;
  name: string;
  slug: string | null;
  createdAt: string;
  planCode: string | null;
  planName: string | null;
  priceMonthly: string | null;
  currency: string | null;
  status: EffectiveStatus | null;
  blocked: boolean;
  trialEndsAt: string | null;
  suspendedReason: string | null;
  vence: Vence | null;
}

interface TenantDetail {
  business: { id: string; name: string; slug: string | null; createdAt: string };
  subscription: {
    planCode: string;
    status: EffectiveStatus;
    trialEndsAt: string | null;
    suspendedReason: string | null;
  } | null;
  blocked: boolean;
  vence: Vence | null;
  usage: {
    users: number;
    locations: number;
    products: number;
    sales: number;
    lastSaleAt: string | null;
  };
}

interface TenantUser {
  id: string;
  username: string;
  name: string;
  email: string | null;
  role: 'admin' | 'seller';
  isActive: boolean;
  emailVerifiedAt: string | null;
  locationName: string | null;
}

interface Metrics {
  mrr: string;
  mrrEnRiesgo: string;
  porEstado: Record<string, number>;
  altasDelMes: number;
  bajasDelMes: number;
  totalNegocios: number;
  conSuscripcion: number;
}

const ESTADO: Record<string, { label: string; tone: BadgeTone }> = {
  trial: { label: 'En prueba', tone: 'info' },
  trial_expired: { label: 'Prueba vencida', tone: 'danger' },
  active: { label: 'Activa', tone: 'success' },
  past_due: { label: 'Morosa', tone: 'warning' },
  suspended: { label: 'Suspendida', tone: 'danger' },
  cancelled: { label: 'Cancelada', tone: 'neutral' },
};

function EstadoBadge({ status }: { status: EffectiveStatus | null }) {
  if (!status) return <Badge tone="neutral">Sin suscripción</Badge>;
  const e = ESTADO[status] ?? { label: status, tone: 'neutral' as BadgeTone };
  return <Badge tone={e.tone}>{e.label}</Badge>;
}

/**
 * "Le quedan 3 días" en vez de una fecha que hay que restar mentalmente.
 *
 * El color acompaña a la urgencia porque este texto se lee de reojo en una lista larga:
 * vencido en rojo, una semana o menos en ámbar, el resto en gris.
 */
function cuentaAtras(v: Vence | null): { texto: string; tone: BadgeTone } | null {
  if (!v) return null;
  const que = v.concepto === 'prueba' ? 'Prueba' : 'Periodo';
  if (v.dias < 0) {
    const d = Math.abs(v.dias);
    return { texto: `${que} vencida hace ${d} ${d === 1 ? 'día' : 'días'}`, tone: 'danger' };
  }
  if (v.dias === 0) return { texto: `${que} vence hoy`, tone: 'danger' };
  return {
    texto: `${que}: ${v.dias} ${v.dias === 1 ? 'día' : 'días'}`,
    tone: v.dias <= 7 ? 'warning' : 'neutral',
  };
}

function VenceBadge({ vence }: { vence: Vence | null }) {
  const c = cuentaAtras(vence);
  if (!c) return null;
  return <Badge tone={c.tone}>{c.texto}</Badge>;
}

/**
 * Resumen de estados para el subtítulo. Antes sólo decía activos y en prueba, así que
 * de 24 negocios el subtítulo describía 3: los suspendidos y las bajas desaparecían
 * justo del sitio donde se miran.
 */
function resumenEstados(porEstado: Record<string, number>): string {
  const etiquetas: Array<[string, string]> = [
    ['active', 'activos'],
    ['trial', 'en prueba'],
    ['past_due', 'morosos'],
    ['trial_expired', 'prueba vencida'],
    ['suspended', 'suspendidos'],
    ['cancelled', 'de baja'],
  ];
  const partes = etiquetas
    .filter(([k]) => (porEstado[k] ?? 0) > 0)
    .map(([k, txt]) => `${porEstado[k]} ${txt}`);
  return partes.length ? partes.join(' · ') : 'sin suscripciones';
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted">{label}</div>
        <div className="mt-1 text-2xl font-bold tracking-[-0.02em]">{value}</div>
        {hint && <div className="mt-0.5 text-[13px] text-muted">{hint}</div>}
      </CardContent>
    </Card>
  );
}

/** Panel de plataforma: cartera de clientes, su estado y las acciones sobre ellos. */
export function PlatformPage() {
  const { admin, logout } = usePlatformAuth();
  const qc = useQueryClient();
  const [busqueda, setBusqueda] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);
  const [miCuenta, setMiCuenta] = useState(false);
  const [operadores, setOperadores] = useState(false);

  const { data: metrics } = useQuery({
    queryKey: ['platform', 'metrics'],
    queryFn: () => platformApi.get<Metrics>('/platform/metrics'),
  });

  const { data: tenants, isLoading } = useQuery({
    queryKey: ['platform', 'tenants', busqueda],
    queryFn: () =>
      platformApi.get<TenantRow[]>(
        `/platform/tenants${busqueda ? `?search=${encodeURIComponent(busqueda)}` : ''}`,
      ),
  });

  const { data: planes } = useQuery({
    queryKey: ['plans'],
    queryFn: () => platformApi.get<PlanInfo[]>('/plans'),
    staleTime: 60 * 60_000,
  });

  return (
    <div className="min-h-full bg-bg">
      {/*
        En móvil la cabecera se apila, y no por gusto.

        En una fila, los tres botones más la identidad del operador sumaban 99 px más que
        la pantalla de un teléfono: "Salir" quedaba entero fuera, sin forma de llegar a él
        —era la única pantalla del producto con desborde horizontal—. `flex-wrap` con los
        botones a la derecha resuelve el caso sin cambiar nada en escritorio.
      */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-fg text-bg">
            <ShieldCheck size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-bold tracking-[-0.02em]">Plataforma</div>
            {/* El correo se recorta en vez de empujar: es identificación, no acción. */}
            <div className="truncate text-[12px] text-muted">
              {admin?.email}
              {admin?.isOwner && ' · principal'}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Administrar operadores sólo aparece para quien puede: un botón que
              siempre responde "no tienes permiso" es peor que no estar. */}
          {admin?.isOwner && (
            <Button
              variant="outline"
              onClick={() => setOperadores(true)}
              className="h-9 px-3 text-[13px]"
            >
              <Users size={15} /> Operadores
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => setMiCuenta(true)}
            className="h-9 px-3 text-[13px]"
          >
            <UserCog size={15} /> Mi cuenta
          </Button>
          <Button variant="outline" onClick={logout} className="h-9 px-3 text-[13px]">
            <LogOut size={15} /> Salir
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-4 p-4">
        {metrics && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="MRR" value={`Bs. ${metrics.mrr}`} hint="suscripciones al día" />
            <Tile
              label="En riesgo"
              value={`Bs. ${metrics.mrrEnRiesgo}`}
              hint="morosas, aún operando"
            />
            <Tile
              label="Negocios"
              value={String(metrics.totalNegocios)}
              hint={resumenEstados(metrics.porEstado)}
            />
            <Tile
              label="Este mes"
              value={`+${metrics.altasDelMes} / −${metrics.bajasDelMes}`}
              hint="altas y bajas"
            />
          </div>
        )}

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o subdominio…"
            className="pl-9"
          />
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading && <div className="p-4 text-muted">Cargando…</div>}
            {tenants?.length === 0 && (
              <div className="p-4 text-muted">No hay negocios que coincidan.</div>
            )}
            <ul className="divide-y divide-border">
              {tenants?.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => setAbierto(t.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/[0.06]"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{t.name}</div>
                      <div className="truncate text-[13px] text-muted">
                        {t.slug ?? 'sin subdominio'} · {t.planName ?? 'sin plan'}
                        {t.priceMonthly ? ` · Bs. ${t.priceMonthly}/mes` : ''}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <VenceBadge vence={t.vence} />
                      <EstadoBadge status={t.status} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {abierto && (
        <TenantModal
          id={abierto}
          planes={planes ?? []}
          onClose={() => setAbierto(null)}
          onGuardado={() => {
            qc.invalidateQueries({ queryKey: ['platform'] });
          }}
        />
      )}
      {miCuenta && <MiCuentaModal onClose={() => setMiCuenta(false)} />}
      {operadores && <OperadoresModal onClose={() => setOperadores(false)} />}
    </div>
  );
}

/** Detalle de un negocio con sus acciones: cambiar plan, suspender, reactivar. */
function TenantModal({
  id,
  planes,
  onClose,
  onGuardado,
}: {
  id: string;
  planes: PlanInfo[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['platform', 'tenant', id],
    queryFn: () => platformApi.get<TenantDetail>(`/platform/tenants/${id}`),
  });

  const [plan, setPlan] = useState<string>('');
  const [estado, setEstado] = useState<string>('');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);

  // El estado efectivo `trial_expired` no se puede ELEGIR: se deduce de la fecha.
  // Ofrecerlo en el desplegable dejaría guardar un estado que el servidor no acepta.
  const estadosElegibles: SubscriptionStatus[] = [
    'trial',
    'active',
    'past_due',
    'suspended',
    'cancelled',
  ];

  const guardar = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      platformApi.patch(`/platform/tenants/${id}/subscription`, body),
    onSuccess: () => {
      onGuardado();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const sub = data?.subscription;
  const planActual = plan || sub?.planCode || '';
  const estadoActual = estado || (sub?.status === 'trial_expired' ? 'trial' : sub?.status) || '';

  return (
    <Modal open onClose={onClose} title={data?.business.name ?? 'Negocio'}>
      {isLoading && <div className="text-muted">Cargando…</div>}
      {data && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted">{data.business.slug ?? 'sin subdominio'}</span>
            <div className="flex items-center gap-2">
              <VenceBadge vence={data.vence} />
              <EstadoBadge status={sub?.status ?? null} />
            </div>
          </div>

          {data.vence && (
            <div className="text-[13px] text-muted">
              {data.vence.concepto === 'prueba' ? 'La prueba termina' : 'El periodo termina'} el{' '}
              {new Date(data.vence.fecha).toLocaleDateString('es-BO', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-[13px]">
            <Dato label="Usuarios" valor={data.usage.users} />
            <Dato label="Sucursales" valor={data.usage.locations} />
            <Dato label="Productos" valor={data.usage.products} />
            <Dato label="Ventas" valor={data.usage.sales} />
          </div>
          <div className="text-[13px] text-muted">
            Última venta:{' '}
            {data.usage.lastSaleAt
              ? new Date(data.usage.lastSaleAt).toLocaleDateString('es-BO')
              : 'nunca'}
          </div>

          <DatosDelNegocio
            id={id}
            nombre={data.business.name}
            slug={data.business.slug}
            onGuardado={onGuardado}
          />

          <UsuariosDelNegocio id={id} />

          {sub?.suspendedReason && (
            <div className="rounded-theme bg-danger-bg p-3 text-[13px] text-danger">
              Motivo de la suspensión: {sub.suspendedReason}
            </div>
          )}

          <div>
            <label className="mb-1 block text-[13px] font-semibold">Plan</label>
            <Select value={planActual} onChange={(e) => setPlan(e.target.value)}>
              {/* Sólo cuando no hay plan: si lo hay, el desplegable ya viene con el
                  suyo puesto y una opción "sin cambios" sobra y confunde. */}
              {!sub && <option value="">— elegir plan —</option>}
              {planes.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name} · Bs. {p.priceMonthly}/mes
                </option>
              ))}
              {/* El plan interno no está en /plans, pero un negocio puede tenerlo. */}
              {sub && !planes.some((p) => p.code === sub.planCode) && (
                <option value={sub.planCode}>{sub.planCode} (interno)</option>
              )}
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-[13px] font-semibold">Estado</label>
            <Select value={estadoActual} onChange={(e) => setEstado(e.target.value)}>
              {estadosElegibles.map((s) => (
                <option key={s} value={s}>
                  {ESTADO[s]?.label ?? s}
                </option>
              ))}
            </Select>
          </div>

          {estadoActual === 'suspended' && (
            <div>
              <label className="mb-1 block text-[13px] font-semibold">Motivo</label>
              <Input
                value={motivo || sub?.suspendedReason || ''}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Falta de pago de agosto"
              />
              <p className="mt-1 text-[12px] text-muted">
                Queda en la bitácora de la plataforma. El negocio no lo ve.
              </p>
            </div>
          )}

          {error && <p className="text-[13px] text-danger">{error}</p>}

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              className="flex-1"
              disabled={guardar.isPending}
              onClick={() => {
                setError(null);
                const body: Record<string, unknown> = {};
                if (planActual && planActual !== sub?.planCode) body.planCode = planActual;
                if (estadoActual && estadoActual !== sub?.status) body.status = estadoActual;
                if (estadoActual === 'suspended') {
                  body.suspendedReason = motivo || sub?.suspendedReason || null;
                }
                if (Object.keys(body).length === 0) return onClose();
                guardar.mutate(body);
              }}
            >
              {guardar.isPending ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Dato({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="rounded-theme border border-border p-2">
      <div className="text-[11px] uppercase tracking-[0.06em] text-muted">{label}</div>
      <div className="text-base font-bold">{valor}</div>
    </div>
  );
}

/**
 * Renombrar el negocio y mudarlo de subdominio.
 *
 * Van juntos pero no pesan igual: el nombre es cosmético, el subdominio es la dirección
 * por la que el cliente entra cada mañana. Cambiarlo tumba la anterior en el acto, así
 * que el aviso está al lado del campo y no escondido en una confirmación.
 */
function DatosDelNegocio({
  id,
  nombre,
  slug,
  onGuardado,
}: {
  id: string;
  nombre: string;
  slug: string | null;
  onGuardado: () => void;
}) {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [n, setN] = useState(nombre);
  const [s, setS] = useState(slug ?? '');
  const [error, setError] = useState<string | null>(null);
  const [nuevaUrl, setNuevaUrl] = useState<string | null>(null);

  const guardar = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      platformApi.patch<{ url: string | null }>(`/platform/tenants/${id}`, body),
    onSuccess: (res) => {
      setError(null);
      setNuevaUrl(s !== (slug ?? '') ? res.url : null);
      qc.invalidateQueries({ queryKey: ['platform', 'tenant', id] });
      onGuardado();
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!abierto) {
    return (
      <Button variant="outline" className="h-9 text-[13px]" onClick={() => setAbierto(true)}>
        Editar nombre y subdominio
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-theme border border-border p-3">
      <div>
        <label className="mb-1 block text-[13px] font-semibold">Nombre del negocio</label>
        <Input value={n} onChange={(e) => setN(e.target.value)} />
      </div>
      <div>
        <label className="mb-1 block text-[13px] font-semibold">Subdominio</label>
        <Input value={s} onChange={(e) => setS(e.target.value)} placeholder="mi-negocio" />
        <p className="mt-1 text-[12px] text-warning">
          Si lo cambias, la dirección actual deja de funcionar de inmediato. Avísale al cliente
          antes.
        </p>
      </div>
      {error && <p className="text-[13px] text-danger">{error}</p>}
      {nuevaUrl && <p className="text-[13px] text-success">Nueva dirección: {nuevaUrl}</p>}
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => setAbierto(false)}>
          Cerrar
        </Button>
        <Button
          className="flex-1"
          disabled={guardar.isPending}
          onClick={() => {
            const body: Record<string, unknown> = {};
            if (n !== nombre) body.name = n;
            if (s !== (slug ?? '')) body.slug = s;
            if (!Object.keys(body).length) return setError('No cambiaste nada.');
            guardar.mutate(body);
          }}
        >
          {guardar.isPending ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </div>
  );
}

/**
 * Los usuarios del negocio, con el rescate de acceso.
 *
 * Es la pantalla de la llamada de soporte: "no puedo entrar". Primero se le dice cuál
 * era su usuario — la mitad de las veces el problema es ése — y sólo si hace falta se
 * le genera una contraseña.
 */
function UsuariosDelNegocio({ id }: { id: string }) {
  const [abierto, setAbierto] = useState(false);
  const { data: usuarios, isLoading } = useQuery({
    queryKey: ['platform', 'tenant', id, 'users'],
    queryFn: () => platformApi.get<TenantUser[]>(`/platform/tenants/${id}/users`),
    enabled: abierto,
  });

  if (!abierto) {
    return (
      <Button variant="outline" className="h-9 text-[13px]" onClick={() => setAbierto(true)}>
        <Users size={15} /> Ver usuarios y dar acceso
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-theme border border-border p-3">
      <div className="text-[13px] font-semibold">Usuarios del negocio</div>
      {isLoading && <div className="text-[13px] text-muted">Cargando…</div>}
      <ul className="divide-y divide-border">
        {usuarios?.map((u) => (
          <li key={u.id} className="py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-semibold">{u.username}</span>
                  <Badge tone={u.role === 'admin' ? 'info' : 'neutral'}>
                    {u.role === 'admin' ? 'Admin' : 'Vendedor'}
                  </Badge>
                  {!u.isActive && <Badge tone="danger">Inactivo</Badge>}
                </div>
                <div className="truncate text-[12px] text-muted">
                  {u.name}
                  {u.locationName ? ` · ${u.locationName}` : ''}
                </div>
                <div className="truncate text-[12px] text-muted">
                  {u.email ?? 'sin correo'}
                  {u.email && !u.emailVerifiedAt && ' (sin verificar)'}
                </div>
              </div>
              <RescateAcceso tenantId={id} userId={u.id} />
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-muted">
        Un usuario sin correo verificado no puede recuperar su contraseña solo: es el caso en el que
        hace falta darle una desde aquí.
      </p>
    </div>
  );
}

/**
 * Genera una contraseña temporal y la enseña UNA vez.
 *
 * No se puede volver a consultar: en la base sólo queda el hash, igual que con
 * cualquier otra contraseña. Si se cierra el panel sin copiarla, se genera otra.
 */
function RescateAcceso({ tenantId, userId }: { tenantId: string; userId: string }) {
  const [resultado, setResultado] = useState<{
    tempPassword: string;
    username: string;
    correoEnviado: boolean;
    email: string | null;
  } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generar = useMutation({
    mutationFn: () =>
      platformApi.post<{
        tempPassword: string;
        username: string;
        correoEnviado: boolean;
        email: string | null;
      }>(`/platform/tenants/${tenantId}/users/${userId}/password`),
    onSuccess: (r) => {
      setError(null);
      setResultado(r);
    },
    onError: (e: Error) => setError(e.message),
  });

  if (resultado) {
    return (
      <div className="w-44 shrink-0 rounded-theme bg-success-bg p-2">
        <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-success">
          Contraseña temporal
        </div>
        <div className="mt-1 select-all font-mono text-[13px] font-bold">
          {resultado.tempPassword}
        </div>
        <Button
          variant="ghost"
          className="mt-1 h-7 px-1 text-[11px]"
          onClick={() => {
            navigator.clipboard?.writeText(resultado.tempPassword);
            setCopiado(true);
          }}
        >
          <Copy size={11} /> {copiado ? 'Copiada' : 'Copiar'}
        </Button>
        <p className="mt-1 text-[11px] text-muted">
          {resultado.correoEnviado
            ? `Enviada también a ${resultado.email}.`
            : 'No tiene correo: dísela tú.'}{' '}
          No se puede volver a ver.
        </p>
      </div>
    );
  }

  return (
    <div className="shrink-0 text-right">
      <Button
        variant="outline"
        className="h-8 px-2 text-[12px]"
        disabled={generar.isPending}
        onClick={() => generar.mutate()}
      >
        <KeyRound size={12} /> {generar.isPending ? 'Generando…' : 'Clave temporal'}
      </Button>
      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
    </div>
  );
}
