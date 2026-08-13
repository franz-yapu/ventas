import { X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { PasoTour } from '@/features/tour/pasos';

/**
 * El recorrido en pantalla: un velo oscuro con un hueco encima de lo que se explica, y
 * un recuadro al lado contándolo.
 *
 * ## Por qué a mano y no con una librería
 *
 * Lo que hace falta cabe en un archivo: medir un elemento, recortar el velo y colocar un
 * recuadro. Una librería de tours traería su propio sistema de estilos y su propio modo
 * oscuro, que es justo lo que este proyecto tiene resuelto con sus tokens.
 *
 * ## Lo que se mide cada poco, y por qué
 *
 * La posición del elemento se vuelve a medir cada 150 ms mientras el paso está en
 * pantalla, en vez de una sola vez al entrar. Suena a fuerza bruta y es lo correcto: la
 * pantalla puede estar todavía cargando su lista, la fuente puede acabar de entrar y
 * mover todo dos píxeles, el teclado del móvil puede abrirse, o la persona puede girar el
 * teléfono. Medir una vez deja el foco señalando un hueco vacío, que es peor que no
 * señalar nada. De paso, un elemento que aparece tarde se «engancha» solo cuando llega.
 */

interface Props {
  paso: PasoTour;
  indice: number;
  total: number;
  onAnterior: () => void;
  onSiguiente: () => void;
  /** Cerrar: saltar, terminar o Escape. Los tres significan lo mismo. */
  onCerrar: () => void;
}

/** Aire entre el elemento resaltado y el borde del hueco. */
const HOLGURA = 8;
/** Aire entre el hueco y el recuadro, y contra los bordes de la pantalla. */
const MARGEN = 12;
const ANCHO_MAX = 360;

function mismaCaja(a: DOMRect | null, b: DOMRect | null): boolean {
  if (!a || !b) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

export function Tour({ paso, indice, total, onAnterior, onSiguiente, onCerrar }: Props) {
  const [caja, setCaja] = useState<DOMRect | null>(null);
  const tarjeta = useRef<HTMLDivElement>(null);
  const [alto, setAlto] = useState(0);
  const primero = indice === 0;
  const ultimo = indice === total - 1;

  // Buscar y seguir al elemento anclado. Sin ancla, el paso va centrado.
  useEffect(() => {
    if (!paso.ancla) {
      setCaja(null);
      return;
    }
    let yaMirado = false;
    const medir = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${paso.ancla}"]`);
      if (!el) {
        setCaja(null);
        return;
      }
      // Sólo la primera vez que aparece: después, desplazar en cada medición pelearía
      // con la persona si decide mover la pantalla ella misma.
      if (!yaMirado) {
        yaMirado = true;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      const r = el.getBoundingClientRect();
      setCaja((previa) => (mismaCaja(previa, r) ? previa : r));
    };
    medir();
    const id = setInterval(medir, 150);
    return () => clearInterval(id);
  }, [paso.ancla, paso.id]);

  useLayoutEffect(() => {
    if (tarjeta.current) setAlto(tarjeta.current.offsetHeight);
  }, [paso.id, caja]);

  // Teclado: avanzar, retroceder y salir sin tocar la pantalla.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
      else if (e.key === 'ArrowRight') onSiguiente();
      else if (e.key === 'ArrowLeft' && !primero) onAnterior();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCerrar, onSiguiente, onAnterior, primero]);

  const vw = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 768 : window.innerHeight;
  const ancho = Math.min(ANCHO_MAX, vw - 2 * MARGEN);

  /*
    Dónde cabe el recuadro: debajo del hueco si hay sitio, arriba si no, y centrado
    cuando no hay nada que señalar. El `alto` sale de medir la propia tarjeta y no de un
    número inventado, porque los textos no miden todos lo mismo y en un teléfono la
    diferencia es la que decide si el botón "Siguiente" queda fuera de la pantalla.
  */
  let estilo: React.CSSProperties;
  if (!caja) {
    estilo = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: ancho };
  } else {
    const debajo = caja.bottom + HOLGURA + MARGEN + alto <= vh;
    const top = debajo
      ? caja.bottom + HOLGURA + MARGEN
      : Math.max(MARGEN, caja.top - HOLGURA - MARGEN - alto);
    const left = Math.min(
      Math.max(MARGEN, caja.left + caja.width / 2 - ancho / 2),
      vw - ancho - MARGEN,
    );
    estilo = { top, left, width: ancho };
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`Tour: ${paso.titulo}`}>
      {/* Tapa la pantalla para que no se pueda tocar nada por debajo mientras el tour
          está abierto: si se pudiera, la persona acabaría en otra pantalla con el
          recuadro señalando un sitio que ya no existe. */}
      <div className="fixed inset-0 z-[60]" onClick={(e) => e.stopPropagation()} />

      {caja ? (
        // El velo es la SOMBRA de este recuadro, no un elemento aparte: así el hueco es
        // exactamente el elemento, sin recortes ni máscaras.
        <div
          data-testid="tour-foco"
          className="pointer-events-none fixed z-[61] rounded-[10px] ring-2 ring-primary"
          style={{
            top: caja.top - HOLGURA,
            left: caja.left - HOLGURA,
            width: caja.width + 2 * HOLGURA,
            height: caja.height + 2 * HOLGURA,
            boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)',
          }}
        />
      ) : (
        <div className="pointer-events-none fixed inset-0 z-[61] bg-black/55" />
      )}

      <div
        ref={tarjeta}
        data-testid="tour-tarjeta"
        className="fixed z-[62] rounded-theme border border-border bg-surface p-4 shadow-xl"
        style={estilo}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 className="text-[15px] font-bold leading-snug">{paso.titulo}</h2>
          <button
            onClick={onCerrar}
            aria-label="Cerrar el tour"
            className="-mr-1 -mt-1 shrink-0 rounded p-1 text-muted hover:bg-fg/[0.06]"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-[13px] leading-relaxed text-muted">{paso.texto}</p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-muted/70">
            {indice + 1} de {total}
          </span>
          <div className="flex items-center gap-2">
            {!primero && (
              <Button variant="outline" onClick={onAnterior}>
                Atrás
              </Button>
            )}
            <Button onClick={ultimo ? onCerrar : onSiguiente}>
              {ultimo ? 'Listo' : 'Siguiente'}
            </Button>
          </div>
        </div>
        {/*
          En su propia línea y no junto a los otros dos: con los tres apretados, el dedo
          que iba a «Siguiente» acaba apagando el tour para siempre. Y hace lo mismo que
          la X a propósito — quien cierra un tour no quiere verlo mañana otra vez.
        */}
        <button
          onClick={onCerrar}
          className="mt-2 rounded-theme py-1 text-[12px] font-semibold text-muted underline-offset-2 hover:underline"
        >
          No mostrar más
        </button>
      </div>
    </div>
  );
}
