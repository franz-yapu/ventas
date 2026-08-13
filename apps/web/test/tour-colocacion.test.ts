import { describe, expect, it } from 'vitest';
import { colocarTarjeta, type CajaMedida } from '@/features/tour/Tour';

/**
 * Dónde acaba el recuadro del tour.
 *
 * Esto NO se puede probar montando el componente: jsdom no maqueta, todo mide cero y
 * cualquier cálculo sale bien por casualidad. Por eso la colocación es una función suelta
 * — y por eso este archivo existe. El fallo que busca es el que no se ve en un portátil y
 * arruina el tour en un teléfono: la tarjeta saliéndose por abajo, con el botón de cerrar
 * fuera de la pantalla.
 *
 * El contrato es uno solo y se comprueba en todos los casos: **la tarjeta nunca se sale**.
 */

/** Pantallas reales, de la más apretada a la de escritorio. */
const PANTALLAS = [
  { nombre: 'iPhone SE', vw: 375, vh: 667 },
  { nombre: 'Android típico', vw: 412, vh: 915 },
  { nombre: 'móvil apaisado', vw: 740, vh: 360 },
  { nombre: 'tablet', vw: 768, vh: 1024 },
  { nombre: 'portátil', vw: 1440, vh: 900 },
];

function caja(top: number, left: number, width: number, height: number): CajaMedida {
  return { top, left, width, height, bottom: top + height };
}

/** ¿Cabe entera y a la vista? Es la única pregunta que importa. */
function dentro(
  r: { top: number; left: number; ancho: number },
  alto: number,
  vw: number,
  vh: number,
) {
  return r.left >= 0 && r.left + r.ancho <= vw && r.top >= 0 && r.top + alto <= vh;
}

describe('la tarjeta nunca se sale de la pantalla', () => {
  const altos = [120, 200, 320];
  const sitios = (vw: number, vh: number): (CajaMedida | null)[] => [
    null, // sin nada que señalar
    caja(0, 0, 120, 40), // esquina superior izquierda
    caja(vh - 60, vw - 130, 120, 48), // esquina inferior derecha (el botón «Cobrar»)
    caja(vh / 2 - 20, vw / 2 - 60, 120, 40), // en medio
    caja(4, 0, vw, vh - 8), // un elemento que ocupa casi toda la pantalla
    caja(vh - 8, vw - 20, 200, 60), // asomando por fuera del borde
  ];

  for (const p of PANTALLAS) {
    for (const alto of altos) {
      it(`${p.nombre} (${p.vw}×${p.vh}), tarjeta de ${alto}px`, () => {
        for (const c of sitios(p.vw, p.vh)) {
          const r = colocarTarjeta(c, alto, p.vw, p.vh);
          expect(
            dentro(r, alto, p.vw, p.vh),
            `caja ${JSON.stringify(c)} -> ${JSON.stringify(r)}`,
          ).toBe(true);
        }
      });
    }
  }
});

describe('dónde se coloca cuando sí hay sitio', () => {
  it('debajo del elemento si cabe', () => {
    const r = colocarTarjeta(caja(100, 300, 200, 40), 150, 1440, 900);
    expect(r.top).toBeGreaterThan(140); // por debajo de bottom (140) más la holgura
    expect(r.top).toBeLessThan(200);
  });

  it('encima cuando abajo no cabe', () => {
    // Elemento pegado al pie: es el caso del botón «Cobrar» del POS.
    const r = colocarTarjeta(caja(820, 300, 200, 56), 150, 1440, 900);
    expect(r.top + 150).toBeLessThanOrEqual(820); // termina antes de que empiece el elemento
  });

  it('centrada en el ancho del elemento', () => {
    const r = colocarTarjeta(caja(100, 500, 200, 40), 150, 1440, 900);
    // El centro de la tarjeta coincide con el centro del elemento (600).
    expect(r.left + r.ancho / 2).toBe(600);
  });

  it('sin nada que señalar, centrada en la pantalla', () => {
    const r = colocarTarjeta(null, 200, 1440, 900);
    expect(r.left + r.ancho / 2).toBe(720);
    expect(r.top).toBe(350);
  });
});

describe('el ancho se adapta al teléfono', () => {
  it('no pasa del máximo en pantallas grandes', () => {
    expect(colocarTarjeta(null, 200, 1440, 900).ancho).toBe(360);
  });

  it('en una pantalla estrecha deja aire a los dos lados', () => {
    const r = colocarTarjeta(null, 200, 320, 600);
    expect(r.ancho).toBe(320 - 24);
    expect(r.left).toBe(12);
  });
});

describe('cuando no cabe ni encima ni debajo', () => {
  it('se centra, en vez de quedar clavada al borde de arriba', () => {
    /*
      Móvil apaisado con un elemento que ocupa casi toda la altura. Aquí no hay ningún
      lado bueno, y la pregunta no es si cabe —clavada arriba también cabía— sino si se
      lee como algo colocado o como algo roto. Se centra.

      Este test se escribió antes al revés, comprobando sólo que cupiera, y entonces no
      distinguía una colocación de la otra: pasaba igual con el código viejo. Lo delató
      una mutación.
    */
    const vh = 360;
    const alto = 260;
    const r = colocarTarjeta(caja(20, 10, 700, 320), alto, 740, vh);
    expect(r.top).toBe(Math.max(12, (vh - alto) / 2));
    expect(r.top + alto).toBeLessThanOrEqual(vh);
  });
});
