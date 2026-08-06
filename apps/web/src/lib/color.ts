/**
 * Color de marca: qué texto va encima, y variantes del propio color.
 *
 * Existe porque el texto sobre los colores del negocio estaba FIJO: blanco sobre el
 * primario y gris oscuro sobre el secundario. Mientras los colores por defecto fueran
 * un azul medio y un ámbar, colaba. En cuanto el dueño elige un amarillo claro o un
 * azul marino —y puede, es su marca— el texto encima desaparece. Aquí se decide mirando
 * el color, no adivinando.
 */

/** #rgb, #rrggbb o cualquier cosa -> [r,g,b] 0-255. Devuelve null si no se entiende. */
function aRgb(hex: string): [number, number, number] | null {
  const h = hex.trim().replace('#', '');
  const completo =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  if (!/^[0-9a-fA-F]{6}$/.test(completo)) return null;
  return [
    parseInt(completo.slice(0, 2), 16),
    parseInt(completo.slice(2, 4), 16),
    parseInt(completo.slice(4, 6), 16),
  ];
}

/**
 * Luminancia relativa (WCAG 2.1). No es el promedio de los canales: el ojo humano ve el
 * verde mucho más claro que el azul, y por eso cada canal pesa distinto. Con el promedio,
 * un azul intenso saldría "claro" y le pondríamos texto negro encima, que no se lee.
 */
export function luminancia(hex: string): number {
  const rgb = aRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Cuánto contrastan dos colores (WCAG): de 1 (idénticos) a 21 (negro sobre blanco). */
export function contraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  const [claro, oscuro] = la > lb ? [la, lb] : [lb, la];
  return (claro! + 0.05) / (oscuro! + 0.05);
}

/** El tono de texto oscuro de la app. Negro puro sobre un color saturado vibra. */
const TEXTO_OSCURO = '#17171a';

/**
 * Blanco o casi negro, el que se lea mejor encima de este color.
 *
 * Se comparan los DOS contrastes y gana el mayor, en vez de partir la luminancia por la
 * mitad. Un umbral en 0.5 parece razonable y se equivoca justo con los colores de
 * acento: el ámbar por defecto (#f59e0b) tiene luminancia 0.44 —"oscuro"— y le tocaría
 * texto blanco, que sobre ese naranja contrasta 2.1 y no se lee. El texto oscuro
 * contrasta 8.3. La cuenta lo dice; el umbral, no.
 */
export function textoSobre(hex: string): string {
  return contraste(hex, TEXTO_OSCURO) >= contraste(hex, '#ffffff') ? TEXTO_OSCURO : '#ffffff';
}

/**
 * El mismo color, más oscuro. Para el estado "pulsado" y para el borde de un relleno
 * claro, donde el color a secas no se despega del fondo.
 */
export function oscurecer(hex: string, factor = 0.78): string {
  const rgb = aRgb(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb.map((v) => Math.max(0, Math.round(v * factor)));
  return `#${[r, g, b].map((v) => v!.toString(16).padStart(2, '0')).join('')}`;
}

/** Dos colores mezclados, `t` de 0 (todo `a`) a 1 (todo `b`). */
function mezclar(a: string, b: string, t: number): string {
  const ra = aRgb(a);
  const rb = aRgb(b);
  if (!ra || !rb) return a;
  const c = ra.map((v, i) => Math.round(v + (rb[i]! - v) * t));
  return `#${c.map((v) => v!.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * El color de marca ajustado hasta que se LEA sobre este fondo.
 *
 * El primario y el secundario no cambian en modo oscuro, y es lo correcto: la marca del
 * negocio es su marca a cualquier hora. Pero esa regla vale para RELLENOS —un botón, una
 * pastilla—, donde el color es el protagonista y el texto encima ya se calcula. Como
 * TEXTO sobre la superficie oscura no se sostiene: de los seis temas que ofrece
 * Configuración, cinco quedaban por debajo del mínimo legible (entre 3.2 y 3.4) y Grafito
 * se iba a 1.53, o sea invisible. Afecta a los enlaces, al ítem activo del menú y a los
 * importes marcados.
 *
 * Así que el relleno conserva el color exacto del negocio y el texto se acerca a la
 * superficie lo justo para cruzar el 4.5:1. Se sube de veinte en veinte partes y se para
 * en cuanto llega: mover un tono lo mínimo es lo que hace que siga pareciendo su color.
 */
export function legibleSobre(hex: string, fondo: string, minimo = 4.5): string {
  if (!aRgb(hex) || !aRgb(fondo)) return hex;
  if (contraste(hex, fondo) >= minimo) return hex;
  // Un fondo oscuro pide aclarar el color; uno claro, oscurecerlo.
  const destino = luminancia(fondo) < 0.5 ? '#ffffff' : TEXTO_OSCURO;
  for (let paso = 1; paso <= 20; paso++) {
    const candidato = mezclar(hex, destino, paso / 20);
    if (contraste(candidato, fondo) >= minimo) return candidato;
  }
  // Ni mezclándolo del todo llega: se devuelve el extremo, que es lo más legible que hay.
  return destino;
}

/**
 * Recalcula el color de marca para texto a partir de la superficie que hay AHORA.
 *
 * Depende de dos cosas que cambian por separado —la marca del negocio y el modo de
 * pantalla—, así que lo llaman las dos: `aplicarColorDeMarca` y `aplicarModo`. Se lee la
 * superficie del documento en vez de recibirla por parámetro para que nadie tenga que
 * acordarse de cuál toca en cada modo.
 */
export function aplicarMarcaLegible(): void {
  const raiz = document.documentElement;
  const cs = getComputedStyle(raiz);
  const primario = cs.getPropertyValue('--color-primary').trim();
  const superficie = cs.getPropertyValue('--color-surface').trim();
  if (!primario || !superficie) return;
  raiz.style.setProperty('--color-primary-ink', legibleSobre(primario, superficie));
}

/**
 * Fija en el documento un color de marca junto con el texto que va encima.
 *
 * Un único sitio donde se escriben estas variables: lo usan el ThemeProvider (al cargar
 * la marca) y la pantalla de Configuración (para la vista previa en vivo). Si cada uno
 * lo hiciera por su cuenta, la vista previa acabaría mintiendo respecto a lo guardado.
 */
export function aplicarColorDeMarca(nombre: 'primary' | 'secondary', hex: string): void {
  const root = document.documentElement.style;
  root.setProperty(`--color-${nombre}`, hex);
  root.setProperty(`--color-${nombre}-fg`, textoSobre(hex));
  if (nombre === 'primary') {
    root.setProperty('--color-primary-700', oscurecer(hex));
    aplicarMarcaLegible();
  }
}
