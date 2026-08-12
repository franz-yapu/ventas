import { Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { useSubscription } from '@/features/subscription/SubscriptionProvider';

/**
 * Lo que se pinta donde iba algo que el plan del negocio no incluye.
 *
 * Existe porque la alternativa era peor y estaba pasando: la pantalla de Reportes pedía
 * los gráficos, el API respondía 402 —son de un plan superior—, y los widgets iban con
 * `{dash && …}`, así que **no se pintaba nada y nadie lo decía**. El dueño de un plan
 * Básico veía media pantalla y no tenía forma de saber si le faltaba algo, si estaba
 * roto, o si es que no había datos.
 *
 * Los dos silencios que se juntaban eran deliberados por separado, y ése es el detalle
 * que lo hacía difícil de ver: el `{dash && …}` evita reventar mientras carga, y el
 * manejador global calla los 402 a propósito para no llenar de errores la pantalla de
 * quien está bloqueado. Cada uno tenía razón; juntos dejaban un hueco mudo.
 *
 * No se nombra el plan que sí lo incluye. Habría que buscarlo en `/plans` y acertar, y
 * el día que cambien los nombres o el reparto de funciones, este texto mentiría —que es
 * exactamente la clase de promesa desactualizada que ya ha costado cara aquí—. Se dice
 * lo que se sabe seguro, y el enlace lleva a la pantalla que tiene la respuesta al día.
 */
export function FuncionDeOtroPlan({ que }: { que: string }) {
  const { sub } = useSubscription();
  const plan = sub?.plan?.name;

  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted/10 text-muted">
          <Lock size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">{que} no entra en tu plan</p>
          <p className="mt-0.5 text-[13px] leading-[1.5] text-muted">
            {plan ? `Tu plan es ${plan}.` : ''} Mira qué incluye cada uno y cambia cuando quieras;
            lo que ya usas sigue igual.
          </p>
        </div>
        <Link
          to="/suscripcion"
          className="shrink-0 rounded-theme border border-field px-3 py-2 text-[13px] font-semibold hover:bg-fg/[0.05]"
        >
          Ver los planes
        </Link>
      </CardContent>
    </Card>
  );
}
