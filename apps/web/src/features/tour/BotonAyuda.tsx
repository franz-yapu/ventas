import { HelpCircle } from 'lucide-react';
import { useTour } from '@/features/tour/TourProvider';
import { cn } from '@/lib/utils';

/**
 * «Ayuda»: vuelve a lanzar el recorrido guiado desde el principio.
 *
 * Existe porque el tour deja de salir solo enseguida —dos entradas— y sin una puerta de
 * vuelta eso sería un callejón: quien lo saltó el primer día por prisa se quedaría sin él
 * para siempre, y ésa es justo la persona que después llama preguntando.
 *
 * Va en el pie del menú y en Mi perfil. El pie del menú es donde se mira cuando uno no
 * encuentra algo; Mi perfil es la única de las dos que se alcanza con el dedo en un
 * teléfono, donde no hay barra lateral.
 */
export function BotonAyuda({ className }: { className?: string }) {
  const { iniciarTour } = useTour();
  return (
    <button
      type="button"
      data-tour="perfil-ayuda"
      onClick={iniciarTour}
      className={cn(
        'flex w-full items-center justify-center gap-2 rounded-theme border border-field p-2.5 text-[13px] font-semibold text-muted hover:bg-muted/10',
        className,
      )}
    >
      <HelpCircle size={16} /> Ayuda: ver el recorrido
    </button>
  );
}
