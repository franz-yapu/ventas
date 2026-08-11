import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Ningún control se viste con el borde DECORATIVO.
 *
 * ## El agujero que tapa
 *
 * `--color-border` y `--color-field` hacen dos trabajos distintos y por eso se separaron:
 * el primero es el filete entre dos filas o el canto de una tarjeta —a 1.19:1 cumple lo
 * suyo, que es sugerir sin gritar— y el segundo es el contorno de algo que SE TOCA, al que
 * la norma le pide 3:1 porque un campo cuyo borde no se ve no parece un campo, parece un
 * hueco.
 *
 * Había dos tests que lo vigilaban… sobre `Input`, `Select` y `Button`. Y el QA visual
 * encontró **seis controles que no pasan por ninguno de los tres**: el `<input type=color>`
 * de Configuración, los presets de tema, los métodos de pago del POS, «Salir», las
 * tarjetas de producto y el `−/+` del carrito. Todos con el borde decorativo, y los dos
 * tests en verde, porque miraban los componentes y no las pantallas.
 *
 * Ese es el patrón que se repite en este proyecto: **lo que se comprueba a través de un
 * componente no dice nada del elemento suelto que alguien escribió a mano**, y el elemento
 * suelto es justo el que nadie se acordó de vestir.
 *
 * ## Cómo
 *
 * Se recorre el JSX de verdad con el analizador de TypeScript —no con una expresión
 * regular sobre el texto, que no sabe a qué etiqueta pertenece cada clase— y se mira, en
 * cada elemento interactivo, todos los trozos de texto de su `className`: literales,
 * plantillas y las dos ramas de un ternario, que es donde se escondían cuatro de los seis
 * (el borde del estado NO seleccionado).
 *
 * ## Lo que NO cubre, y conviene saberlo
 *
 * Un `<div>` que sólo envuelve controles —el marco del `−/+` del carrito, el del selector
 * de modo— no se detecta salvo que lleve `onClick`. Se arreglaron a mano; si mañana
 * aparece otro, este test no lo verá. Cubrir eso pediría decidir por semántica y no por
 * etiqueta, y acabaría en una lista de excepciones que nadie mantiene.
 */

const RAIZ = join(process.cwd(), 'src');

/** Lo que se toca. `a` queda fuera: un enlace se distingue por el color del texto. */
const INTERACTIVOS = new Set(['button', 'input', 'select', 'textarea']);

const DECORATIVO = 'border-border';

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return archivos(p);
    return e.name.endsWith('.tsx') ? [p] : [];
  });
}

interface Hallazgo {
  archivo: string;
  linea: number;
  etiqueta: string;
  clase: string;
}

function revisar(ruta: string): Hallazgo[] {
  const texto = readFileSync(ruta, 'utf8');
  const fuente = ts.createSourceFile(ruta, texto, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  const hallazgos: Hallazgo[] = [];

  function mirarElemento(apertura: ts.JsxOpeningLikeElement) {
    const etiqueta = apertura.tagName.getText(fuente);
    const props = apertura.attributes.properties;

    const esInteractivo =
      INTERACTIVOS.has(etiqueta) ||
      // Un `<div>` con `onClick` es un control aunque no lo parezca por la etiqueta.
      props.some((p) => ts.isJsxAttribute(p) && p.name.getText(fuente) === 'onClick');
    if (!esInteractivo) return;

    for (const p of props) {
      if (!ts.isJsxAttribute(p) || p.name.getText(fuente) !== 'className') continue;
      /*
        Todos los trozos de texto de la expresión, no sólo el literal de fuera. Cuatro de
        los seis fallos vivían dentro de un ternario —`activo ? '…' : 'border-border …'`—,
        o sea que el borde malo era el del estado NO seleccionado. Mirar únicamente el
        primer literal los habría dado por buenos.
      */
      const trozos: string[] = [];
      const recoger = (n: ts.Node) => {
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) trozos.push(n.text);
        else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n))
          trozos.push(n.text);
        n.forEachChild(recoger);
      };
      if (p.initializer) recoger(p.initializer);

      for (const t of trozos) {
        if (!new RegExp(`(^|\\s)${DECORATIVO}(\\s|$)`).test(t)) continue;
        const { line } = fuente.getLineAndCharacterOfPosition(apertura.getStart(fuente));
        hallazgos.push({
          archivo: ruta.slice(RAIZ.length + 1),
          linea: line + 1,
          etiqueta,
          clase: t.trim().slice(0, 80),
        });
      }
    }
  }

  const recorrer = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) mirarElemento(n);
    n.forEachChild(recorrer);
  };
  recorrer(fuente);
  return hallazgos;
}

describe('el borde de lo que se toca', () => {
  const todos = archivos(RAIZ);

  it('se encontraron pantallas que revisar', () => {
    // El seguro de siempre: si la ruta cambiara, todo lo de abajo pasaría por vacío.
    expect(todos.length).toBeGreaterThan(20);
  });

  it('ningún control usa el borde decorativo, que se queda en 1.19:1', () => {
    const hallazgos = todos.flatMap(revisar);
    const dicho = hallazgos.map((h) => `${h.archivo}:${h.linea}  <${h.etiqueta}>  «${h.clase}»`);
    expect(
      dicho,
      'Un control con `border-border` se queda en 1.19:1 y no parece un control. ' +
        'Usa `border-field` (3.32:1). Si de verdad es decoración, no debería estar en ' +
        'un elemento que se toca.',
    ).toEqual([]);
  });
});
