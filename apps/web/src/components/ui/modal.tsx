import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Lo que se puede enfocar con el tabulador dentro de la hoja. */
const ENFOCABLES =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

// Hoja/modal calcado del prototipo VentaFácil POS: fondo translúcido con desenfoque,
// hoja #fbfbf9 pegada abajo en móvil (radio superior) y centrada en escritorio.
export function Modal({ open, onClose, title, children, className }: ModalProps) {
  const hoja = useRef<HTMLDivElement>(null);
  /**
   * `onClose` vive en una ref, y esto NO es un detalle de estilo.
   *
   * Quien usa este componente le pasa una flecha en línea —`onClose={() => setX(null)}`—,
   * que es una función NUEVA en cada render. Con `onClose` en las dependencias del efecto
   * de abajo, cada tecla que escribía alguien cambiaba el estado del padre, provocaba un
   * render, cambiaba la identidad de `onClose`, y el efecto se limpiaba y se volvía a
   * montar. Su limpieza devuelve el foco a donde estaba ANTES de abrir y su montaje lo
   * lleva al primer campo, así que el foco salía disparado en cada letra: el campo del
   * motivo de una cancelación se quedaba en la primera y no se podía escribir nada más.
   *
   * Era bloqueante y no era de la pantalla de ventas: le pasaba a CUALQUIER modal con un
   * formulario cuyo estado viva en el padre, que son casi todos.
   *
   * Con la ref, el efecto depende sólo de `open` —que es cuándo tiene que hacer algo— y
   * sigue llamando siempre a la versión más reciente.
   */
  const cerrar = useRef(onClose);
  cerrar.current = onClose;

  /**
   * Escape cierra, y el tabulador se queda DENTRO.
   *
   * `aria-modal="true"` le promete a un lector de pantalla que lo de detrás no existe
   * mientras esto esté abierto, pero es sólo una etiqueta: el tabulador seguía paseándose
   * por la página de abajo, así que quien usa teclado acababa escribiendo en un formulario
   * que no ve. Tres cosas hacen falta y ninguna estaba: llevar el foco a la hoja al abrir,
   * dar la vuelta al llegar al final, y devolver el foco a donde estaba al cerrar.
   */
  useEffect(() => {
    if (!open) return;
    const veniaDe = document.activeElement as HTMLElement | null;

    // Al primer campo si lo hay; si no, a la propia hoja, para que Escape funcione y el
    // lector de pantalla empiece por el título.
    const primero = hoja.current?.querySelector<HTMLElement>(ENFOCABLES);
    (primero ?? hoja.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return cerrar.current();
      if (e.key !== 'Tab' || !hoja.current) return;
      const focos = Array.from(hoja.current.querySelectorAll<HTMLElement>(ENFOCABLES));
      if (focos.length === 0) return;
      const inicio = focos[0]!;
      const fin = focos[focos.length - 1]!;
      // El ciclo se cierra a mano en los dos extremos; en el medio, el navegador ya
      // hace lo correcto.
      if (e.shiftKey && document.activeElement === inicio) {
        e.preventDefault();
        fin.focus();
      } else if (!e.shiftKey && document.activeElement === fin) {
        e.preventDefault();
        inicio.focus();
      }
    };
    document.addEventListener('keydown', onKey);

    // El fondo no se desplaza detrás de la hoja: en móvil, con el teclado abierto, el
    // gesto de bajar movía la página y no el formulario.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      veniaDe?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(10,10,9,0.5)] p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={hoja}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'ds-modal max-h-[92vh] w-full max-w-md overflow-auto bg-surface shadow-[0_20px_50px_-20px_rgba(0,0,0,0.35)]',
          // Radios derivados del que elige el negocio: si sube el radio, la hoja
          // sube con él en vez de quedarse en un 20px que ya no pega con nada.
          'rounded-t-theme-lg animate-[vf-sheet_.22s_ease] sm:rounded-theme-lg',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[17px] font-bold">{title}</h2>
            <button
              onClick={onClose}
              className="flex p-0.5 text-muted hover:text-fg"
              aria-label="Cerrar"
            >
              <X size={20} />
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
