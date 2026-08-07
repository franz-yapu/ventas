import { AlertTriangle, Clock } from 'lucide-react';
import { useSubscription } from '@/features/subscription/SubscriptionProvider';

/**
 * Aviso fino sobre el contenido: prueba en curso o pago pendiente.
 *
 * En morosidad NO se corta el servicio (el POS sigue vendiendo), así que este banner
 * es todo lo que hay para que el negocio se entere antes de llegar a la suspensión.
 */
export function SubscriptionBanner() {
  const { sub } = useSubscription();
  if (!sub || sub.blocked) return null;

  if (sub.status === 'past_due') {
    return (
      <div className="no-print flex items-center gap-2 border-b border-border bg-danger-bg px-4 py-2 text-[13px] text-danger">
        <AlertTriangle size={15} className="shrink-0" />
        <span>Tu pago está pendiente. Regulariza para que no se suspenda el servicio.</span>
      </div>
    );
  }

  if (sub.status === 'trial' && sub.trialDaysLeft !== null) {
    const dias = sub.trialDaysLeft;
    return (
      <div className="no-print flex items-center gap-2 border-b border-border bg-warning-bg px-4 py-2 text-[13px] text-warning">
        <Clock size={15} className="shrink-0" />
        <span>
          {dias <= 1 ? 'Tu prueba gratis termina hoy.' : `Te quedan ${dias} días de prueba gratis.`}{' '}
          Plan {sub.plan?.name}.
        </span>
      </div>
    );
  }

  return null;
}
