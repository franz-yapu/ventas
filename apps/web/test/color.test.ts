import { describe, expect, it } from 'vitest';
import { contraste, legibleSobre, luminancia, oscurecer, textoSobre } from '../src/lib/color';

/**
 * Contraste del texto sobre los colores de marca.
 *
 * Lo que se prueba no es la fórmula sino la promesa: el dueño puede elegir CUALQUIER
 * color y el texto encima se sigue leyendo. Antes el texto era fijo —blanco sobre el
 * primario, gris oscuro sobre el secundario— y un amarillo o un azul marino lo borraban.
 */
describe('texto legible sobre un color de marca', () => {
  it('sobre colores oscuros pone texto blanco', () => {
    for (const c of ['#000000', '#1a1a2e', '#234f9e', '#2f68d8', '#c23b2f', '#3a3a42']) {
      expect(textoSobre(c), c).toBe('#ffffff');
    }
  });

  it('sobre colores claros pone texto oscuro', () => {
    for (const c of ['#ffffff', '#f5d90a', '#f59e0b', '#a7f3d0', '#fde68a']) {
      expect(textoSobre(c), c).toBe('#17171a');
    }
  });

  it('el ámbar por defecto lleva texto oscuro, no blanco', () => {
    // El caso que delató el umbral de luminancia: #f59e0b sale "oscuro" (0.44) pero el
    // blanco encima contrasta 2.1 y el texto oscuro 8.3. Se elige comparando, no
    // partiendo la luminancia por la mitad.
    expect(textoSobre('#f59e0b')).toBe('#17171a');
    expect(contraste('#f59e0b', '#17171a')).toBeGreaterThan(contraste('#f59e0b', '#ffffff'));
  });

  it('el elegido siempre contrasta al menos 4.5:1, el mínimo legible de WCAG AA', () => {
    // Los 12 colores de los presets de Configuración (primario y secundario de cada
    // pareja), más dos extremos. Si alguien añade un preset que no llega a 4.5, este
    // test lo dice antes de que llegue a un cliente.
    const PRESETS = [
      '#2f68d8',
      '#f59e0b',
      '#27794c',
      '#d98324',
      '#6d5ae0',
      '#e0a03a',
      '#e0662f',
      '#2a7194',
      '#c23b2f',
      '#377483',
      '#3a3a42',
      '#c9992e',
    ];
    for (const c of [...PRESETS, '#f5d90a', '#1a1a2e']) {
      expect(contraste(c, textoSobre(c)), c).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('pesa los canales como el ojo, no como un promedio', () => {
    // Mismo valor en los tres canales por separado: el verde se percibe MUCHO más claro
    // que el azul. Con un promedio de canales, ambos darían lo mismo y el azul puro
    // acabaría con texto negro encima, que no se lee.
    expect(luminancia('#00ff00')).toBeGreaterThan(luminancia('#0000ff'));
    expect(textoSobre('#00ff00')).toBe('#17171a');
    expect(textoSobre('#0000ff')).toBe('#ffffff');
  });

  it('acepta la forma corta de tres dígitos', () => {
    expect(textoSobre('#fff')).toBe(textoSobre('#ffffff'));
    expect(textoSobre('#000')).toBe(textoSobre('#000000'));
  });

  it('ante un color que no entiende, no rompe: asume oscuro y pone blanco', () => {
    // Un theme_json viejo o escrito a mano puede traer 'rojo' o una cadena vacía. Es
    // preferible un botón blanco sobre negro que una excepción en el arranque.
    for (const basura of ['', 'rojo', '#12', 'rgb(1,2,3)']) {
      expect(textoSobre(basura), JSON.stringify(basura)).toBe('#ffffff');
    }
  });
});

describe('variante oscura del color', () => {
  it('devuelve el mismo color más oscuro, en hexadecimal válido', () => {
    const oscuro = oscurecer('#2f68d8');
    expect(oscuro).toMatch(/^#[0-9a-f]{6}$/);
    expect(luminancia(oscuro)).toBeLessThan(luminancia('#2f68d8'));
  });

  it('el negro no se puede oscurecer más, y no se rompe intentándolo', () => {
    expect(oscurecer('#000000')).toBe('#000000');
  });

  it('deja pasar sin tocar lo que no es un color', () => {
    expect(oscurecer('no-es-un-color')).toBe('no-es-un-color');
  });
});

/**
 * El color de marca cuando es TEXTO sobre la superficie.
 *
 * La regla "el primario no cambia en oscuro" es correcta para rellenos y falsa para
 * texto: de los seis temas de Configuración, cinco quedaban entre 3.2 y 3.4 sobre el
 * fondo oscuro —por debajo del mínimo legible— y Grafito en 1.53, o sea invisible.
 * Afecta a los enlaces, al ítem activo del menú y a los importes marcados.
 */
describe('el color de marca se lee también como texto', () => {
  /** Superficies reales de `index.css`. */
  const CLARO = '#ffffff';
  const OSCURO = '#1b1b19';

  /** Los seis primarios que ofrece Configuración. */
  const PRIMARIOS = ['#2f68d8', '#27794c', '#6d5ae0', '#e0662f', '#c23b2f', '#3a3a42'];

  it('los seis temas se leen sobre la superficie OSCURA', () => {
    for (const c of PRIMARIOS) {
      expect(contraste(legibleSobre(c, OSCURO), OSCURO), c).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('los seis temas se leen sobre la superficie CLARA', () => {
    for (const c of PRIMARIOS) {
      expect(contraste(legibleSobre(c, CLARO), CLARO), c).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('si ya se lee, no se toca: el color del negocio es el suyo', () => {
    // La propiedad, no una lista: el que ya cumple sale idéntico. (Escrito primero como
    // "en claro los seis ya cumplen", que resultó ser falso — ver el caso de abajo.)
    for (const c of PRIMARIOS) {
      for (const fondo of [CLARO, OSCURO]) {
        if (contraste(c, fondo) >= 4.5) expect(legibleSobre(c, fondo), c).toBe(c);
      }
    }
  });

  it('el naranja tampoco se leía en CLARO, y nadie lo había medido', () => {
    // Hallazgo de paso: los informes daban la paleta clara por buena para el primario,
    // pero #e0662f sobre blanco se queda en 3.6. El ajuste vale para los dos modos, no
    // sólo para el oscuro, precisamente porque se decide midiendo y no por el modo.
    expect(contraste('#e0662f', CLARO)).toBeLessThan(4.5);
    expect(contraste(legibleSobre('#e0662f', CLARO), CLARO)).toBeGreaterThanOrEqual(4.5);
  });

  it('Grafito, que era el caso imposible, acaba legible', () => {
    // 1.53 sobre el fondo oscuro: literalmente no se veía.
    expect(contraste('#3a3a42', OSCURO)).toBeLessThan(2);
    expect(contraste(legibleSobre('#3a3a42', OSCURO), OSCURO)).toBeGreaterThanOrEqual(4.5);
  });

  it('se mueve lo MÍNIMO: para de aclarar en cuanto cruza el umbral', () => {
    // Si se pasara de largo, la marca dejaría de parecerse a sí misma. Se admite un
    // margen por el tamaño del paso, no un color lavado.
    for (const c of PRIMARIOS) {
      expect(contraste(legibleSobre(c, OSCURO), OSCURO), c).toBeLessThan(7);
    }
  });

  it('ante una entrada que no entiende, devuelve lo que le dieron', () => {
    expect(legibleSobre('no-es-un-color', OSCURO)).toBe('no-es-un-color');
    expect(legibleSobre('#2f68d8', 'tampoco')).toBe('#2f68d8');
  });
});
