import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { debeAceptarTerminos } from '@ventafacil/shared';
import { useAuth } from '@/features/auth/AuthProvider';
import { api } from '@/lib/api';
import { useBusiness } from '@/theme/ThemeProvider';

/**
 * Aviso de que los términos cambiaron desde que este negocio los aceptó.
 *
 * Existe porque el texto lo promete por escrito: «Podemos cambiar estas condiciones. Si el
 * cambio es importante, te avisaremos con antelación razonable; seguir usando el servicio
 * después implica aceptarlas». Hasta hoy no se avisaba de nada — `TERMS_VERSION` se
 * guardaba al registrarse y no se comparaba con nada—, así que esa cláusula se apoyaba en
 * un aviso que no existía.
 *
 * ## Las tres decisiones que tiene dentro
 *
 * **No bloquea.** Es una franja, no un muro: se puede seguir vendiendo. Es el mismo
 * criterio que ya tomó este producto con los pagos atrasados —«dejar sin caja a un negocio
 * por un pago de unos días es desproporcionado»—, y con más razón por un texto legal.
 *
 * **Sólo por cambios importantes.** Se compara contra `TERMS_VERSION_MATERIAL`, no contra
 * la versión de ahora, que sube hasta por una tilde corregida. Un aviso que sale siempre es
 * un aviso que nadie lee, y entonces no serviría para el cambio que sí importa.
 *
 * **Sólo el admin de la central.** Es quien aceptó al registrarse y quien responde por el
 * negocio, igual que para exportar los datos o cambiar la configuración. Un vendedor no
 * puede comprometer al negocio, y un aviso legal en el mostrador sólo estorba a quien está
 * cobrando.
 *
 * Pulsar «Entendido» guarda QUÉ versión se aceptó y CUÁNDO, y queda en la bitácora: sin
 * eso el aviso sería decorativo y dentro de un año seguiría sin haber forma de saber qué
 * aceptó cada quien, que es justo para lo que existe la constante.
 */
export function AvisoDeTerminos() {
  const { user } = useAuth();
  const business = useBusiness();
  const qc = useQueryClient();

  const aceptar = useMutation({
    mutationFn: () => api.post('/business/terms'),
    // Al refrescar el negocio llega la versión nueva y el aviso desaparece solo: no hace
    // falta un estado local que recuerde que se pulsó.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['business'] }),
  });

  // Mientras el negocio no ha cargado no se enseña nada: un aviso que aparece y se va
  // medio segundo después es peor que uno que tarda un poco en salir.
  if (!business || !user || user.role !== 'admin' || !user.isCentral) return null;
  if (!debeAceptarTerminos(business.termsVersion)) return null;

  return (
    <div className="no-print flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-warning-bg px-4 py-2 text-[13px] text-warning">
      <ScrollText size={15} className="shrink-0" />
      <span>Actualizamos los términos del servicio y la política de privacidad.</span>
      <Link to="/terminos" className="font-bold underline underline-offset-2">
        Leerlos
      </Link>
      <button
        onClick={() => aceptar.mutate()}
        disabled={aceptar.isPending}
        className="font-bold underline underline-offset-2 disabled:opacity-60"
      >
        {aceptar.isPending ? 'Guardando…' : 'Entendido'}
      </button>
      {aceptar.isError && (
        <span className="font-semibold">No se pudo guardar. Inténtalo de nuevo.</span>
      )}
    </div>
  );
}
