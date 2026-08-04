import type { EffectiveStatus, LimitKey, PlanFeature } from '@ventafacil/shared';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { api } from '@/lib/api';

export interface PlanInfo {
  code: string;
  name: string;
  description: string;
  priceMonthly: string;
  currency: string;
  maxLocations: number | null;
  maxUsers: number | null;
  maxProducts: number | null;
  features: PlanFeature[];
}

export interface SubscriptionInfo {
  /** null = negocio sin suscripción (instalación anterior al SaaS): sin restricciones. */
  plan: PlanInfo | null;
  status: EffectiveStatus | null;
  blocked: boolean;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  currentPeriodEnd: string | null;
  features: PlanFeature[] | null;
  usage: Record<LimitKey, { used: number; limit: number | null }>;
}

interface SubscriptionContextValue {
  sub: SubscriptionInfo | null;
  loading: boolean;
  /** ¿El plan incluye esta función? Mientras se carga, y sin plan, se asume que sí. */
  has: (feature: PlanFeature) => boolean;
}

const SubscriptionContext = createContext<SubscriptionContextValue>({
  sub: null,
  loading: true,
  has: () => true,
});

/**
 * Estado de la suscripción del negocio, para el banner de prueba, la pantalla de
 * bloqueo y qué menús mostrar.
 *
 * Ojo: esto es COMODIDAD, no seguridad. Ocultar un menú no impide llamar al endpoint;
 * quien decide de verdad es el API (`requireFeature` y la puerta de `requireAuth`).
 */
export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['subscription', user?.businessId],
    queryFn: () => api.get<SubscriptionInfo>('/subscription/me'),
    enabled: !!user,
    // Un minuto: es lo mismo que cachea el API, así que refrescar más no aporta.
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const sub = data ?? null;
  const has = (feature: PlanFeature) => {
    if (!sub || !sub.features) return true;
    return sub.features.includes(feature);
  };

  return (
    <SubscriptionContext.Provider value={{ sub, loading: isLoading, has }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  return useContext(SubscriptionContext);
}
