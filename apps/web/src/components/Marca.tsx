import { useMarca } from '@/theme/ThemeProvider';
import { cn } from '@/lib/utils';

const TAMANOS = {
  sm: { caja: 'h-8 w-8 rounded-[9px]', texto: 'text-[15px]' },
  md: { caja: 'h-11 w-11 rounded-[12px]', texto: 'text-xl' },
  lg: { caja: 'h-16 w-16 rounded-[16px]', texto: 'text-2xl' },
} as const;

/**
 * El distintivo del negocio: su logo si lo subió, y si no la inicial sobre el color
 * primario.
 *
 * Existe como pieza única porque aparece en tres sitios que antes no se parecían: la
 * barra lateral, el login y los correos de vuelta (verificar, restablecer). Cuando el
 * dueño cambia el logo en Configuración, cambia en los tres — que es justo lo que
 * espera quien acaba de subirlo.
 *
 * El logo se guarda como data URI, así que no hay petición de red que esperar: o está
 * en la respuesta de la marca o no está.
 */
export function Marca({
  size = 'md',
  className,
}: {
  size?: keyof typeof TAMANOS;
  className?: string;
}) {
  const marca = useMarca();
  const t = TAMANOS[size];
  const inicial = (marca?.name ?? 'V').trim().charAt(0).toUpperCase();

  if (marca?.logoUrl) {
    return (
      <div
        className={cn(
          t.caja,
          // Fondo blanco y borde: un logo con transparencia o de color claro necesita
          // algo detrás, o desaparece sobre el fondo cálido de la app.
          'flex shrink-0 items-center justify-center overflow-hidden border border-border bg-surface',
          className,
        )}
      >
        <img src={marca.logoUrl} alt={marca.name} className="h-full w-full object-contain p-1" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        t.caja,
        t.texto,
        'flex shrink-0 items-center justify-center font-bold text-primary-fg',
        className,
      )}
      // Degradado de los DOS colores de la marca. Un negocio sin logo tiene aquí lo
      // único que lo distingue, y un cuadro de color plano se parece al de cualquier
      // otro; con el acento de por medio, dos negocios con el mismo azul ya no se ven
      // iguales. El texto encima sale de --color-primary-fg, que se calcula del color.
      style={{
        background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 165%)',
      }}
      aria-hidden
    >
      {inicial}
    </div>
  );
}

/** Nombre visible del negocio, con la caída a la marca del producto. */
export function NombreDeMarca({ className }: { className?: string }) {
  const marca = useMarca();
  return <span className={className}>{marca?.appName ?? marca?.name ?? 'VentaFácil'}</span>;
}
