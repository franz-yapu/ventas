import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contraste } from '../src/lib/color';

/**
 * Las dos paletas, leídas del CSS de verdad.
 *
 * La paleta oscura se comprobó en su día con un script suelto que se ejecutó una vez y no
 * quedó en ninguna parte. La clara nunca se comprobó, y así llevaba meses con el texto
 * apagado en 3.17 sobre el fondo de la app — el color que la interfaz usa a 12 y 13px para
 * cada subtítulo, cada cabecera de tabla y cada rótulo del menú. Un número que nadie mide
 * es un número que se va.
 *
 * Este test no repite los hexadecimales: los saca de `index.css`. Cambiar un token o
 * añadir una pareja nueva pasa por aquí, que es lo único que impide que vuelva a pasar.
 */

const CSS = readFileSync(fileURLToPath(new URL('../src/index.css', import.meta.url)), 'utf8');

/** Las variables de un bloque, quedándonos sólo con las que son un color literal. */
function tokens(selector: string): Record<string, string> {
  const i = CSS.indexOf(selector);
  if (i === -1) throw new Error(`No se encontró el bloque ${selector} en index.css`);
  const bloque = CSS.slice(i, CSS.indexOf('\n}', i));
  const salida: Record<string, string> = {};
  for (const [, nombre, valor] of bloque.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)) {
    salida[nombre!] = valor!;
  }
  return salida;
}

const CLARO = tokens(':root {');
// En oscuro sólo se redefine parte de la paleta; el resto se hereda del bloque claro.
const OSCURO = { ...CLARO, ...tokens(":root[data-modo='oscuro']") };

/**
 * Las parejas que de verdad se dan en pantalla: texto sobre el fondo que le toca.
 *
 * No es el producto cartesiano de la paleta. Un token de fondo nunca se pone sobre otro
 * fondo, y comprobar combinaciones que no existen sólo genera fallos que nadie puede
 * arreglar.
 */
const PAREJAS: Array<[texto: string, fondo: string]> = [
  // El texto normal, sobre las tres superficies donde se apoya.
  ['fg', 'bg'],
  ['fg', 'surface'],
  ['fg', 'table-head'],
  // El apagado: subtítulos, cabeceras de tabla, rótulos del menú. A 12–13px, así que le
  // toca el 4.5 de texto normal y no el 3:1 del texto grande.
  ['muted', 'bg'],
  ['muted', 'surface'],
  ['muted', 'table-head'],
  // Los semánticos, sobre su propio fondo teñido (un chip) y sobre la superficie (un
  // mensaje suelto: "Cambios guardados").
  ['success', 'success-bg'],
  ['danger', 'danger-bg'],
  ['warning', 'warning-bg'],
  ['info', 'info-bg'],
  ['success', 'surface'],
  ['danger', 'surface'],
  ['warning', 'surface'],
  ['info', 'surface'],
  // Superficie INVERTIDA (el toast del POS): el fondo es el color del texto.
  ['success-inv', 'fg'],
  ['warning-inv', 'fg'],
  ['bg', 'fg'],
];

/**
 * El contorno de lo que se puede TOCAR: 3:1, que es lo que se le pide a un componente.
 *
 * Faltaba, y el agujero era exactamente el mismo que ya había dejado `--color-muted` en
 * 3.17 durante meses: el token se afina contra los dos o tres fondos que este archivo
 * mira, y lo que no está en la lista no se mide. El contorno de cada `<input>`, cada
 * `<select>` y cada botón secundario estaba en 1.19:1 en claro y 1.24:1 en oscuro —
 * prácticamente invisible, y con el test en verde.
 *
 * Un campo cuyo contorno no se ve no parece un campo: parece un hueco.
 *
 * Se mide `--color-field` y NO `--color-border`. Son dos trabajos: el segundo es un
 * separador decorativo (el filete entre dos filas, el canto de una tarjeta) y a 1.19
 * cumple el suyo, que es sugerir sin gritar. Exigirle 3:1 dejaría la aplicación llena de
 * cajas negras — arreglar el contraste no puede consistir en empeorar el diseño.
 */
const PAREJAS_BORDE: Array<[borde: string, fondo: string]> = [
  ['field', 'bg'],
  ['field', 'surface'],
  ['field', 'table-head'],
];

/**
 * Fondos teñidos que también reciben texto apagado.
 *
 * `muted` se midió contra `bg`, `surface` y `table-head`, pero no contra éstos, y en los
 * tres se quedaba corto en claro: 4.37 sobre `track`, 4.43 sobre `danger-bg`, 4.49 sobre
 * `info-bg`. Se ven en la inicial del usuario de la barra lateral —presente en TODAS las
 * pantallas con sesión— y en cualquier chip neutro.
 */
const PAREJAS_TEÑIDAS: Array<[texto: string, fondo: string]> = [
  ['muted', 'track'],
  ['muted', 'danger-bg'],
  ['muted', 'info-bg'],
  ['muted', 'success-bg'],
  ['muted', 'warning-bg'],
  ['fg', 'track'],
  ['fg', 'danger-bg'],
  ['fg', 'info-bg'],
];

describe.each([
  ['clara', CLARO],
  ['oscura', OSCURO],
])('la paleta %s se lee', (_nombre, paleta) => {
  it.each([...PAREJAS, ...PAREJAS_TEÑIDAS])('%s sobre %s llega a 4.5:1', (texto, fondo) => {
    const a = paleta[texto];
    const b = paleta[fondo];
    expect(a, `falta --color-${texto}`).toBeTruthy();
    expect(b, `falta --color-${fondo}`).toBeTruthy();
    expect(contraste(a!, b!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(PAREJAS_BORDE)('%s sobre %s llega a 3:1', (borde, fondo) => {
    const a = paleta[borde];
    const b = paleta[fondo];
    expect(a, `falta --color-${borde}`).toBeTruthy();
    expect(b, `falta --color-${fondo}`).toBeTruthy();
    expect(contraste(a!, b!)).toBeGreaterThanOrEqual(3);
  });
});

describe('el CSS se pudo leer', () => {
  it('los dos bloques traen tokens, no un objeto vacío', () => {
    // Si el formato de index.css cambiara y la expresión dejara de encontrar nada, todo
    // lo de arriba pasaría por vacío en vez de fallar. Esto es el seguro.
    expect(Object.keys(CLARO).length).toBeGreaterThan(10);
    expect(Object.keys(tokens(":root[data-modo='oscuro']")).length).toBeGreaterThan(5);
  });
});
