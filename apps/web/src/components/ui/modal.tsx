import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Modal({ open, onClose, title, children, className }: ModalProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <Card
        className={`w-full max-w-md ${className ?? ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="text-lg font-medium">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-fg" aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </Card>
    </div>
  );
}
