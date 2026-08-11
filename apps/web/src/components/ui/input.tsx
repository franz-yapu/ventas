import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

// `filter`: variante compacta para filtros de lista (filterStyle del prototipo:
// h42, radio 10, 13px, borde #e6e4de, texto #5c5c56).
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  filter?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, filter, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-11 w-full rounded-theme border border-field bg-surface px-3 text-base text-fg',
        // Sin foco propio: lo pone la regla global de `index.css`. El `outline-none` que
        // había aquí ganaba por cascada y dejaba el campo con un anillo de 1.82:1.
        'placeholder:text-muted',
        filter && 'h-[42px] rounded-theme-sm border-field text-[13px] text-fg/80',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
