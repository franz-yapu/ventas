import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

// `filter`: variante compacta para filtros de lista (filterStyle del prototipo:
// h42, radio 10, 13px, borde #e6e4de, texto #5c5c56).
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  filter?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, filter, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-11 w-full rounded-theme border border-border bg-surface px-3 text-base text-fg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        filter && 'h-[42px] rounded-theme-sm border-border text-[13px] text-fg/80',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';
