import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

// Chip de estado (coincide con el prototipo VentaFácil POS).
// Colores calcados del prototipo (chipStyle): pill redondeada, peso 700.
const TONES = {
  success: 'bg-success-bg text-success',
  danger: 'bg-danger-bg text-danger',
  warning: 'bg-warning-bg text-warning',
  info: 'bg-info-bg text-info',
  neutral: 'bg-track text-muted',
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11px] font-bold',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
