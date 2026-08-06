import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModo } from '@/theme/ModoProvider';

const MODOS = [
  { valor: 'claro' as const, etiqueta: 'Claro', icono: Sun },
  { valor: 'oscuro' as const, etiqueta: 'Oscuro', icono: Moon },
  { valor: 'auto' as const, etiqueta: 'Automático', icono: Monitor },
];

/**
 * Elegir modo de pantalla.
 *
 * Vivía dentro de Configuración, que es una ruta `adminOnly centralOnly`. O sea que la
 * única preferencia por dispositivo de la app sólo la podía tocar el dueño, cuando el
 * argumento para construirla —está escrito en `theme/modo.ts`— era justamente el
 * contrario: "un vendedor que atiende de noche con el teléfono en claro quiere el POS
 * oscuro igualmente" y "dos personas del mismo local pueden quererlo distinto".
 *
 * Como componente, lo tienen las dos pantallas: Configuración (junto al resto de la
 * apariencia) y Mi perfil, que sí ve todo el mundo.
 */
export function ModoSelector() {
  const { modo, oscuro, cambiar } = useModo();

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm text-muted">Modo de pantalla</label>
      <div className="inline-flex w-fit rounded-theme border border-border p-1">
        {MODOS.map((m) => (
          <button
            key={m.valor}
            type="button"
            onClick={() => cambiar(m.valor)}
            aria-pressed={modo === m.valor}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-theme-sm px-3 py-1.5 text-[13px] font-semibold transition-colors',
              modo === m.valor ? 'bg-primary text-primary-fg' : 'text-muted hover:text-fg',
            )}
          >
            <m.icono size={15} /> {m.etiqueta}
          </button>
        ))}
      </div>
      <p className="text-[12px] text-muted">
        Se guarda en este dispositivo, no en el negocio: la caja de la mañana y la de la noche no
        tienen la misma luz.
        {modo === 'auto' && ` Ahora sigue a tu sistema: ${oscuro ? 'oscuro' : 'claro'}.`}
      </p>
    </div>
  );
}
