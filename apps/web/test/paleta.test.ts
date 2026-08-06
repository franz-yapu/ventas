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

const CSS = readFileSync(
  fileURLToPath(new URL('../src/index.css', import.meta.url)),
  'utf8',
);

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

describe.each([
  ['clara', CLARO],
  ['oscura', OSCURO],
])('la paleta %s se lee', (_nombre, paleta) => {
  it.each(PAREJAS)('%s sobre %s llega a 4.5:1', (texto, fondo) => {
    const a = paleta[texto];
    const b = paleta[fondo];
    expect(a, `falta --color-${texto}`).toBeTruthy();
    expect(b, `falta --color-${fondo}`).toBeTruthy();
    expect(contraste(a!, b!)).toBeGreaterThanOrEqual(4.5);
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
