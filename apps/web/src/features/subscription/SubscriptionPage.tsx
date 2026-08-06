import { LIMIT_LABELS, limitLabel, type LimitKey } from '@ventafacil/shared';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Page, PageHeader } from '@/components/ui/page';
import type { PlanInfo } from '@/features/subscription/SubscriptionProvider';
import { useSubscription } from '@/features/subscription/SubscriptionProvider';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const ETIQUETA_ESTADO: Record<string, string> = {
  trial: 'En prueba',
  trial_expired: 'Prueba vencida',
  active: 'Activa',
  past_due: 'Pago pendiente',
  suspended: 'Suspendida',
  cancelled: 'Cancelada',
};

/** "3 sucursales" · "Sucursales sin límite". */
function cupo(key: LimitKey, max: number | null): string {
  if (max === null) return `${LIMIT_LABELS[key]} sin límite`;
  return `${max} ${limitLabel(key, max)}`;
}

/** Barra de uso de un cupo. Sin tope, se muestra el número y ya. */
function Cupo({ nombre, used, limit }: { nombre: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  // Se avisa a partir del 80%: llegar al tope en plena carga de productos frustra.
  const apretado = limit !== null && used / limit >= 0.8;

  return (
    <div>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="capitalize">{nombre}</span>
        <span className={cn('font-semibold', apretado && 'text-warning')}>
          {used}
          {limit === null ? ' · sin límite' : ` / ${limit}`}
        </span>
      </div>
      {limit !== null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-track">
          <div
            className={cn('h-full rounded-full', apretado ? 'bg-warning' : 'bg-primary')}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** Qué plan tiene el negocio, cuánto de su cupo lleva usado y qué otros planes hay. */
export function SubscriptionPage() {
  const { sub, loading } = useSubscription();

  const { data: planes } = useQuery({
    queryKey: ['plans'],
    queryFn: () => api.get<PlanInfo[]>('/plans'),
    staleTime: 60 * 60_000,
  });

  if (loading) return <div className="p-6 text-muted">Cargando…</div>;

  return (
    <Page>
      <PageHeader
        titulo="Mi plan"
        descripcion="Tu suscripción y cuánto llevas usado de cada cupo."
      />

      <Card>
        <CardContent className="p-4">
          {sub?.plan ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="text-lg font-bold">{sub.plan.name}</div>
                  <div className="text-[13px] text-muted">{sub.plan.description}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold">
                    {sub.plan.currency} {sub.plan.priceMonthly}
                    <span className="font-normal text-muted"> /mes</span>
                  </div>
                  <div className="text-[13px] text-muted">
                    {ETIQUETA_ESTADO[sub.status ?? ''] ?? sub.status}
                    {sub.status === 'trial' && sub.trialDaysLeft !== null
                      ? ` · ${sub.trialDaysLeft} día(s)`
                      : ''}
                  </div>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {(Object.keys(sub.usage) as LimitKey[]).map((k) => (
                  <Cupo
                    key={k}
                    nombre={LIMIT_LABELS[k]}
                    used={sub.usage[k].used}
                    limit={sub.usage[k].limit}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="text-sm text-muted">
              Este negocio no tiene una suscripción asociada: opera sin límites.
            </div>
          )}
        </CardContent>
      </Card>

      {planes && planes.length > 0 && (
        <>
          <h2 className="mt-2 text-lg font-semibold">Planes disponibles</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {planes.map((p) => {
              const actual = p.code === sub?.plan?.code;
              return (
                <Card key={p.code} className={cn(actual && 'border-primary')}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{p.name}</span>
                      {actual && <Check size={16} className="text-primary" />}
                    </div>
                    <div className="mt-1 text-lg font-bold">
                      {p.currency} {p.priceMonthly}
                      <span className="text-[13px] font-normal text-muted"> /mes</span>
                    </div>
                    <p className="mt-2 text-[13px] text-muted">{p.description}</p>
                    <ul className="mt-3 space-y-1 text-[13px] text-muted">
                      <li>{cupo('locations', p.maxLocations)}</li>
                      <li>{cupo('users', p.maxUsers)}</li>
                      <li>{cupo('products', p.maxProducts)}</li>
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <p className="text-[13px] text-muted">
            Para cambiar de plan, contáctanos. El cobro automático llegará más adelante.
          </p>
        </>
      )}
    </Page>
  );
}
