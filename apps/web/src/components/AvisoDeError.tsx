import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, X } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { errorActual, limpiarError, suscribirError } from '@/lib/errores';

/**
 * Franja que aparece cuando una consulta falla.
 *
 * Existe para que un fallo del servidor deje de parecer un negocio vacío. Ofrece
 * reintentar porque, en la mayoría de los casos (corte de red, servidor reiniciándose),
 * eso es exactamente lo que arregla el problema.
 */
export function AvisoDeError() {
  const qc = useQueryClient();
  const error = useSyncExternalStore(suscribirError, errorActual, () => null);
  if (!error) return null;

  return (
    <div className="no-print flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-danger-bg px-4 py-2 text-[13px] text-danger">
      <AlertTriangle size={15} className="shrink-0" />
      <span className="min-w-0 flex-1">
        {error.status === 0
          ? 'No se pudo conectar con el servidor. Lo que veas puede estar incompleto.'
          : `No se pudieron cargar los datos: ${error.mensaje}`}
      </span>
      <button
        onClick={() => {
          limpiarError();
          void qc.refetchQueries();
        }}
        className="font-bold underline underline-offset-2"
      >
        Reintentar
      </button>
      <button onClick={limpiarError} aria-label="Cerrar aviso" className="p-0.5">
        <X size={15} />
      </button>
    </div>
  );
}
