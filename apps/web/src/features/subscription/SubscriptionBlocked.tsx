import { blockedMessage, type EffectiveStatus } from '@ventafacil/shared';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import type { PlanInfo } from '@/features/subscription/SubscriptionProvider';
import { api } from '@/lib/api';
import { useBusiness } from '@/theme/ThemeProvider';

/**
 * Lo que ve un negocio cuyo plan ya no le deja operar: prueba vencida, suspendido o
 * cancelado.
 *
 * Sustituye a la app entera en vez de dejar que cada pantalla falle con un error. Con
 * el POS a medias, la persona en caja no entendería por qué no puede cobrar.
 */
export function SubscriptionBlocked({ status }: { status: EffectiveStatus }) {
  const { logout } = useAuth();
  const business = useBusiness();

  const { data: planes } = useQuery({
    queryKey: ['plans'],
    queryFn: () => api.get<PlanInfo[]>('/plans'),
    staleTime: 60 * 60_000,
  });

  return (
    <div className="flex min-h-full items-center justify-center bg-bg p-6">
      <div className="w-full max-w-2xl rounded-theme border border-border bg-surface p-6 md:p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger">
            <Lock size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-[-0.02em]">
              {business?.name ?? 'VentaFácil'}
            </h1>
            <p className="mt-1 text-sm text-muted">{blockedMessage(status)}</p>
          </div>
        </div>

        {planes && planes.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.09em] text-muted">
              Planes disponibles
            </div>
            <ul className="space-y-2">
              {planes.map((p) => (
                <li
                  key={p.code}
                  className="flex items-baseline justify-between gap-4 rounded-theme border border-border p-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{p.name}</div>
                    <div className="text-[13px] text-muted">{p.description}</div>
                  </div>
                  <div className="shrink-0 text-sm font-bold">
                    {p.currency} {p.priceMonthly}
                    <span className="font-normal text-muted"> /mes</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-6 text-[13px] text-muted">
          Contáctanos para reactivar tu cuenta. Tus datos siguen guardados: al reactivar,
          encontrarás todo tal como lo dejaste.
        </p>

        <button
          onClick={logout}
          className="mt-4 rounded-theme border border-border px-4 py-2 text-[13px] font-semibold text-muted hover:bg-muted/10"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
