import type { EffectiveStatus, SubscriptionStatus } from '@ventafacil/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, Search, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { usePlatformAuth } from '@/features/platform/PlatformAuthProvider';
import type { PlanInfo } from '@/features/subscription/SubscriptionProvider';
import { platformApi } from '@/lib/api';

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
  usage: {
    users: number;
    locations: number;
    products: number;
    sales: number;
    lastSaleAt: string | null;
  };
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
      <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-fg text-bg">
            <ShieldCheck size={18} />
          </div>
          <div>
            <div className="text-[15px] font-bold tracking-[-0.02em]">Plataforma</div>
            <div className="text-[12px] text-muted">{admin?.email}</div>
          </div>
        </div>
        <Button variant="outline" onClick={logout} className="h-9 px-3 text-[13px]">
          <LogOut size={15} /> Salir
        </Button>
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
              hint={`${metrics.porEstado.active ?? 0} activos · ${metrics.porEstado.trial ?? 0} en prueba`}
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
                    <EstadoBadge status={t.status} />
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
            <span className="text-[13px] text-muted">
              {data.business.slug ?? 'sin subdominio'}
            </span>
            <EstadoBadge status={sub?.status ?? null} />
          </div>

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
