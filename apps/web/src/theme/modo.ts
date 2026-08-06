/**
 * Modo claro / oscuro.
 *
 * La paleta vive en `index.css` bajo `:root[data-modo='oscuro']`; aquí sólo se decide
 * QUÉ atributo lleva el documento y se recuerda la elección.
 *
 * Tres opciones y no dos, a propósito. "Automático" sigue al sistema, que es lo que
 * espera quien ya tiene su teléfono en oscuro; pero un vendedor que atiende de noche
 * con el teléfono en claro quiere el POS oscuro igualmente, y al revés. El modo es una
 * preferencia de la persona, no del aparato.
 *
 * Se guarda en localStorage y NO en el negocio: dos personas del mismo local pueden
 * quererlo distinto, y el mostrador de la mañana no tiene la misma luz que el de la
 * noche. Es la única preferencia de la app que es por dispositivo.
 */

export type Modo = 'claro' | 'oscuro' | 'auto';

const CLAVE = 'vf_modo';

/** Lo que el sistema operativo dice preferir ahora mismo. */
function sistemaPrefiereOscuro(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function leerModo(): Modo {
  const v = localStorage.getItem(CLAVE);
  return v === 'claro' || v === 'oscuro' || v === 'auto' ? v : 'auto';
}

/** ¿Qué se pinta de verdad con este modo, ahora? */
export function esOscuro(modo: Modo): boolean {
  return modo === 'oscuro' || (modo === 'auto' && sistemaPrefiereOscuro());
}

/**
 * Aplica el modo al documento. También mueve `theme-color`, que es la barra del
 * navegador y de la PWA instalada: sin esto, la app abre con una franja clara encima de
 * una pantalla oscura.
 */
export function aplicarModo(modo: Modo): void {
  const oscuro = esOscuro(modo);
  const raiz = document.documentElement;
  if (oscuro) raiz.setAttribute('data-modo', 'oscuro');
  else raiz.removeAttribute('data-modo');

  // Se lee del token ya aplicado en vez de repetir el hexadecimal aquí: si algún día
  // cambia el fondo oscuro, cambia en un solo sitio.
  const fondo = getComputedStyle(raiz).getPropertyValue('--color-bg').trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (fondo && meta) meta.setAttribute('content', fondo);
}

export function guardarModo(modo: Modo): void {
  localStorage.setItem(CLAVE, modo);
  aplicarModo(modo);
}

/**
 * Se suscribe a los cambios del sistema mientras el modo sea "automático".
 *
 * Sin esto, quien tiene el teléfono programado para oscurecerse al anochecer vería la
 * app quedarse en claro hasta recargarla — justo a la hora en que más molesta.
 */
export function seguirAlSistema(modo: () => Modo): () => void {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!mq) return () => undefined;
  const alCambiar = () => {
    if (modo() === 'auto') aplicarModo('auto');
  };
  mq.addEventListener('change', alCambiar);
  return () => mq.removeEventListener('change', alCambiar);
}
