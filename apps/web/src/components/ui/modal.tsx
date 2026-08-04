import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

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
  // Escape cierra. Es lo que espera cualquiera que use un teclado, y sin ello la única
  // salida era acertarle a la X o al fondo.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(20,20,18,0.45)] p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'ds-modal max-h-[92vh] w-full max-w-md overflow-auto bg-[#fbfbf9] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.35)]',
          'rounded-t-[20px] animate-[vf-sheet_.22s_ease] sm:rounded-[18px]',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[17px] font-bold">{title}</h2>
            <button onClick={onClose} className="flex p-0.5 text-muted hover:text-fg" aria-label="Cerrar">
              <X size={20} />
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
