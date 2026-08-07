import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-theme font-semibold transition-[transform,background-color,opacity] active:scale-[.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50 disabled:pointer-events-none',
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
