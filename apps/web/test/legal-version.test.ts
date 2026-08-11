import { describe, expect, it } from 'vitest';
import { TERMS_VERSION } from '@ventafacil/shared';
import { PRIVACIDAD, TERMINOS, ULTIMA_ACTUALIZACION } from '@/features/legal/textos';

/**
 * La versión de los términos y la fecha que se enseña son dos cosas distintas.
 *
 * `TERMS_VERSION` se guarda junto a la aceptación de cada negocio y tiene que distinguir
 * DOS cambios del mismo día —el 11 de agosto de 2026 hubo dos: por la mañana salió el
 * fiado y por la tarde se declararon las fotos—, así que admite un sufijo de edición. Lo
 * que se enseña al pie de los términos es sólo la fecha: «Última actualización:
 * 2026-08-11.2» parece un error de la página.
 */
describe('la versión de los términos', () => {
  it('la fecha que se enseña es una fecha, sin el sufijo de edición', () => {
    expect(ULTIMA_ACTUALIZACION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('y es la misma que la de la versión guardada', () => {
    // Si alguien cambia una y olvida la otra, la página diría una fecha y la base
    // guardaría otra: dos respuestas distintas a «qué aceptó este negocio».
    expect(TERMS_VERSION.startsWith(ULTIMA_ACTUALIZACION)).toBe(true);
  });

  it('el sufijo, si lo hay, sólo puede ser un número de edición', () => {
    const resto = TERMS_VERSION.slice(10);
    expect(resto === '' || /^\.\d+$/.test(resto)).toBe(true);
  });
});

/**
 * Las fotos de producto se guardan FUERA de la base y se sirven sin sesión. Las dos cosas
 * son declaraciones que el texto tiene que hacer, y las dos se olvidaron al conectarlas:
 * el `TERMS_VERSION` subió ese mismo día sin que nadie tocara la privacidad.
 *
 * Esto no puede comprobar que la redacción sea correcta —para eso está leerla—, pero sí
 * que la categoría siga nombrada el día que alguien reescriba estas secciones.
 */
describe('lo que la privacidad tiene que declarar', () => {
  const texto = (secciones: typeof PRIVACIDAD) =>
    secciones
      .flatMap((s) => s.parrafos)
      .join(' ')
      .toLowerCase();

  it('dice que se guardan las fotos', () => {
    expect(texto(PRIVACIDAD)).toContain('fotos de producto');
  });

  it('dice que a las fotos se llega sin iniciar sesión', () => {
    // Es la excepción al «los negocios están aislados» de la sección de quién puede verlos.
    expect(texto(PRIVACIDAD)).toMatch(/no pide iniciar sesión|sin iniciar sesión/);
  });

  it('los términos avisan de que la copia no trae las imágenes', () => {
    expect(texto(TERMINOS)).toMatch(/fotos de producto van por su dirección/);
  });
});
