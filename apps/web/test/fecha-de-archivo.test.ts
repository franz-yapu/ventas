import { describe, expect, it } from 'vitest';
import { dateTime, fechaDeArchivo } from '@/lib/format';

/**
 * La fecha del nombre de un informe.
 *
 * Estos papeles se archivan, así que el nombre del archivo y lo que el papel dice por
 * dentro tienen que hablar del mismo día. Iban por caminos distintos: el nombre con
 * `toISOString()` —UTC— y todo lo impreso en la zona del negocio (UTC−4). Un informe
 * generado a las 21:00 del 11 de agosto se guardaba como `ventas-2026-08-12.pdf` con una
 * hoja que decía «Generado … 11/8/26, 9:00 p. m.»: la carpeta y el papel discrepando sobre
 * cuándo se hizo, que es justo lo que un archivo tiene que resolver.
 */
describe('la fecha para el nombre de un archivo', () => {
  /*
    Las cuatro horas de después de medianoche UTC son las que separan las dos zonas: en
    Bolivia todavía es el día anterior. Es exactamente la franja de una tienda que cierra
    tarde y saca el informe del día al terminar.
  */
  it('usa el día del NEGOCIO, no el de UTC', () => {
    expect(fechaDeArchivo(new Date('2026-08-12T01:00:00Z'))).toBe('2026-08-11');
    expect(fechaDeArchivo(new Date('2026-08-12T03:59:59Z'))).toBe('2026-08-11');
  });

  it('a partir de las 04:00 UTC ya es el día siguiente aquí también', () => {
    expect(fechaDeArchivo(new Date('2026-08-12T04:00:00Z'))).toBe('2026-08-12');
  });

  it('el año y el mes cambian con el día, no con UTC', () => {
    expect(fechaDeArchivo(new Date('2027-01-01T02:00:00Z'))).toBe('2026-12-31');
  });

  it('siempre AAAA-MM-DD con ceros: un nombre de archivo tiene que ordenarse solo', () => {
    expect(fechaDeArchivo(new Date('2026-03-05T15:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fechaDeArchivo(new Date('2026-03-05T15:00:00Z'))).toBe('2026-03-05');
  });

  /*
    Y que las dos mitades no se separen: el nombre y lo que se imprime en la cabecera del
    informe tienen que decir el mismo día.
  */
  it('coincide con el día que imprime el papel', () => {
    const cuando = new Date('2026-08-12T01:00:00Z');
    const [, , dia] = fechaDeArchivo(cuando).split('-') as [string, string, string];
    expect(dateTime(cuando.toISOString())).toContain(String(Number(dia)));
  });
});
