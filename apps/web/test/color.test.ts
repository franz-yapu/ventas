import { describe, expect, it } from 'vitest';
import { contraste, luminancia, oscurecer, textoSobre } from '../src/lib/color';

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
