import { useMarca } from '@/theme/ThemeProvider';
import { cn } from '@/lib/utils';

const TAMANOS = {
  sm: { caja: 'h-8 w-8 rounded-theme-sm', texto: 'text-[15px]' },
  md: { caja: 'h-10 w-10 rounded-theme-sm', texto: 'text-base' },
  lg: { caja: 'h-14 w-14 rounded-theme', texto: 'text-xl' },
  xl: { caja: 'h-16 w-16 rounded-theme', texto: 'text-2xl' },
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
  inverso = false,
  className,
}: {
  size?: keyof typeof TAMANOS;
  /**
   * Sobre un fondo del color primario (la banda del login en escritorio). Ahí el
   * distintivo se invierte —caja clara, inicial en primario— porque la versión normal
   * es primario sobre primario: desaparece.
   */
  inverso?: boolean;
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
          // Algo detrás siempre: un logo con transparencia o de color claro desaparece
          // sobre el fondo de la app. Sobre la banda del primario la caja va CLARA y sin
          // borde — con `bg-surface` en modo oscuro salía un cuadro negro pegado al
          // color de marca, que es justo donde peor se ve.
          'flex shrink-0 items-center justify-center overflow-hidden',
          inverso ? 'bg-white' : 'border border-border bg-surface',
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
        'flex shrink-0 items-center justify-center font-bold',
        !inverso && 'text-primary-fg',
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
