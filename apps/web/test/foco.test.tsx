// @vitest-environment jsdom
import postcss, { type Rule } from 'postcss';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import tailwindcss from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';
import { montar, screen } from './montar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

/**
 * El anillo de foco: que nada lo apague en los controles que más se pulsan.
 *
 * ## La historia, porque es la que justifica el método
 *
 * Había un test que comprobaba que la clase `focus-visible:ring` estuviera puesta en el
 * botón. Estaba. Y **el anillo no se veía**: la regla global vive en `@layer components`
 * y los tres componentes traían una utilidad que la apagaba, y las utilidades ganan por
 * cascada. Resultado medido: Cobrar, Excel, Nuevo, Cerrar caja, el buscador y los selects
 * en **1.82:1 en claro y 1.48:1 en oscuro**, mientras los enlaces del menú —lo decorativo—
 * llegaban a 5.30:1. El foco se veía justo donde menos importaba, con el test en verde.
 *
 * Medido después en un Chromium de verdad, el diagnóstico era aún más crudo de lo que
 * decía el informe: el `outline` de esos controles salía `rgba(0, 0, 0, 0)` —transparente
 * del todo—, y lo único que quedaba era el anillo al 40 %. El enlace del menú, que nunca
 * llevó la utilidad, sí recibía el color entero.
 *
 * La lección: **una clase presente no es un estilo aplicado.** Lo que decide es la
 * cascada, y para verla hay que mirar el CSS COMPILADO, no el `className`.
 *
 * ## Qué hace este test, y qué no
 *
 * Compila el Tailwind de verdad sobre `index.css` (~0,4 s) y luego, para cada clase que
 * el componente pone REALMENTE en su elemento, busca si alguna regla `:focus-visible`
 * apaga el contorno. Es la pregunta exacta que nadie estaba haciendo.
 *
 * No es un navegador: no resuelve la cascada entera ni mide píxeles. Un test así pediría
 * meter Playwright en el repo y bajar un Chromium en cada CI, y todavía no se ha decidido.
 * Lo que sí cubre es la regresión concreta que ocurrió —volver a poner una utilidad que
 * apague el foco— y esa es la que se repite.
 *
 * El COLOR del anillo no se mide aquí: `color.test.ts` ya comprueba que
 * `--color-primary-ink` llega a 4.5:1 en los seis temas y en los dos modos, y 4.5 cubre de
 * sobra el 3:1 que se le pide a un contorno.
 */

/*
  `process.cwd()` y no `import.meta.url`: en el entorno jsdom la URL del módulo no es un
  `file://`, y `fileURLToPath` revienta. Vitest corre con la raíz en `apps/web`, que es de
  donde cuelgan las dos rutas de abajo; el `existsSync` es el seguro por si algún día deja
  de ser así, para que falle diciéndolo en vez de compilar un CSS vacío.
*/
const RAIZ = process.cwd();
const CSS = join(RAIZ, 'src/index.css');
const CONFIG = join(RAIZ, 'tailwind.config.ts');

let reglas: Rule[] = [];

beforeAll(async () => {
  expect(existsSync(CSS), `no se encontró ${CSS}; ¿cambió la raíz de vitest?`).toBe(true);
  const css = readFileSync(CSS, 'utf8');
  const compilado = await postcss([tailwindcss(CONFIG)]).process(css, { from: CSS });
  compilado.root.walkRules((r) => reglas.push(r));
  // Seguro contra el fallo silencioso: si la compilación devolviera nada, todo lo de
  // abajo pasaría por vacío en vez de fallar. Es el mismo seguro que tiene `paleta.test`.
  expect(reglas.length).toBeGreaterThan(100);
});

/** ¿Esta declaración deja el contorno invisible? */
function apaga(prop: string, valor: string): boolean {
  const v = valor.trim();
  if (prop === 'outline') return /\bnone\b|\btransparent\b|(^|\s)0(px)?(\s|$)/.test(v);
  if (prop === 'outline-style') return v === 'none';
  if (prop === 'outline-width') return /^0(px|em|rem)?$/.test(v);
  if (prop === 'outline-color') return v === 'transparent';
  return false;
}

/** Las reglas `:focus-visible` que apagan el contorno y que aplicarían a estas clases. */
function loQueApagaElFoco(clases: string[]): string[] {
  const culpables: string[] = [];
  for (const regla of reglas) {
    if (!regla.selector.includes(':focus-visible')) continue;
    /*
      Sólo las reglas de CLASE, y sólo si la clase está de verdad en el elemento.

      Esto no es un detalle: Tailwind genera la utilidad `focus-visible:outline-none` en
      cuanto encuentra ese texto en CUALQUIER archivo escaneado —incluidos los comentarios
      que explican por qué se quitó—. Buscar la regla suelta en el CSS daría un falso
      positivo perpetuo. Lo que importa es si la lleva puesta el elemento.
    */
    const clase = regla.selector.match(/^\.((?:[\w-]|\\.)+):focus-visible$/)?.[1];
    if (!clase) continue;
    const limpia = clase.replace(/\\/g, '');
    if (!clases.includes(limpia)) continue;

    regla.walkDecls((d) => {
      if (apaga(d.prop, d.value)) culpables.push(`${regla.selector} { ${d.prop}: ${d.value} }`);
    });
  }
  return culpables;
}

describe('nada apaga el foco en los controles que se pulsan', () => {
  it.each([
    ['el botón de cobrar', () => montar(<Button>Cobrar</Button>), () => screen.getByRole('button')],
    [
      'el buscador',
      () => montar(<Input placeholder="Buscar" />),
      () => screen.getByPlaceholderText('Buscar'),
    ],
    [
      'el desplegable de sucursal',
      () =>
        montar(
          <Select aria-label="sucursal">
            <option>Principal</option>
          </Select>,
        ),
      () => screen.getByLabelText('sucursal'),
    ],
  ])('%s', (_nombre, render, buscar) => {
    render();
    const clases = buscar().className.split(/\s+/).filter(Boolean);
    expect(clases.length).toBeGreaterThan(3);
    expect(loQueApagaElFoco(clases)).toEqual([]);
  });
});

describe('la regla global de foco cubre lo que hay que cubrir', () => {
  function reglaGlobal() {
    return reglas.find(
      (r) => r.selector.includes('button:focus-visible') && r.selector.includes('a:focus-visible'),
    );
  }

  it.each(['a', 'button', 'input', 'select', 'textarea', '[tabindex]', 'summary'])(
    'alcanza a %s',
    (elemento) => {
      const r = reglaGlobal();
      expect(r, 'no se encontró la regla global de foco').toBeTruthy();
      expect(r!.selector).toContain(`${elemento}:focus-visible`);
    },
  );

  it('pinta un contorno visible y con el color legible sobre la superficie', () => {
    const r = reglaGlobal()!;
    const outline = r.nodes.find((n) => n.type === 'decl' && n.prop === 'outline') as
      { value: string } | undefined;

    expect(outline, 'la regla global no declara `outline`').toBeTruthy();
    expect(apaga('outline', outline!.value)).toBe(false);
    /*
      `--color-primary-ink`, no `--color-primary`: el color de marca no cambia en oscuro,
      y con el tema Grafito el anillo caía a 1.53:1 — literalmente invisible. La variante
      «ink» es la que `lib/color.ts` recalcula contra la superficie.
    */
    expect(outline!.value).toContain('var(--color-primary-ink)');
  });
});
