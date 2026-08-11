import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  // Sin foco propio: lo pone la regla global de `index.css`. El `focus-visible:outline-none`
  // que había aquí es una utilidad y le ganaba por cascada, así que Cobrar y Cerrar caja se
  // quedaban con un anillo de 1.82:1 mientras los enlaces del menú llegaban a 5.30:1.
  'inline-flex items-center justify-center gap-2 rounded-theme font-semibold transition-[transform,background-color,opacity] active:scale-[.98] disabled:opacity-70 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-fg font-bold hover:opacity-90',
        secondary: 'bg-secondary text-secondary-fg hover:opacity-90',
        outline: 'border border-field bg-surface text-fg hover:bg-muted/10',
        ghost: 'text-fg hover:bg-muted/10',
        danger: 'border border-danger/30 bg-danger-bg text-danger hover:bg-danger/10',
      },
      size: {
        md: 'h-11 px-[18px] text-sm',
        lg: 'h-12 px-6 text-base',
        xl: 'h-16 px-8 text-xl', // botón COBRAR gigante del POS
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';
