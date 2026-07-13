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
        'h-11 w-full rounded-theme border border-border bg-surface px-3 text-base text-fg',
        'placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        filter && 'h-[42px] rounded-[10px] border-[#e6e4de] text-[13px] text-[#5c5c56]',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
