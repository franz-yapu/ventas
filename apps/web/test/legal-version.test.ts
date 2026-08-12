import { describe, expect, it } from 'vitest';
import { debeAceptarTerminos, TERMS_VERSION, TERMS_VERSION_MATERIAL } from '@ventafacil/shared';
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
 * A quién hay que avisarle de que los términos cambiaron.
 *
 * `TERMS_VERSION` se guardaba al registrarse y ahí moría: no se comparaba con nada, así
 * que un negocio que ya opera no se enteraba nunca. Y los términos prometen por escrito
 * que «si el cambio es importante, te avisaremos con antelación razonable; seguir usando
 * el servicio después implica aceptarlas» — una cláusula que se apoya en un aviso que no
 * existía.
 *
 * Se compara contra el último cambio MATERIAL y no contra la versión actual, porque el
 * texto promete aviso sólo para lo importante y `TERMS_VERSION` sube hasta por una tilde.
 */
describe('cuándo hay que volver a aceptar los términos', () => {
  it('quien aceptó la versión material vigente no ve nada', () => {
    expect(debeAceptarTerminos(TERMS_VERSION_MATERIAL)).toBe(false);
  });

  it('quien aceptó una versión anterior, sí', () => {
    expect(debeAceptarTerminos('2026-08-01')).toBe(true);
    expect(debeAceptarTerminos('2025-12-31.4')).toBe(true);
  });

  it('un negocio sin aceptación registrada también: no consta que aceptara nada', () => {
    expect(debeAceptarTerminos(null)).toBe(true);
    expect(debeAceptarTerminos(undefined)).toBe(true);
    expect(debeAceptarTerminos('')).toBe(true);
  });

  /*
    Una edición POSTERIOR y no material no molesta a nadie: es el caso de corregir una
    coma, que sube `TERMS_VERSION` pero no `TERMS_VERSION_MATERIAL`.
  */
  it('una edición posterior a la material no vuelve a preguntar', () => {
    expect(debeAceptarTerminos('2099-01-01')).toBe(false);
  });

  /*
    El orden es por fecha y luego por NÚMERO de edición. Comparando como texto,
    '2026-08-11.10' saldría ANTES que '2026-08-11.2' —porque '1' < '2'— y a quien aceptó
    la décima edición del día se le pediría aceptar otra vez la segunda.
  */
  it('la edición 10 es posterior a la 2, no anterior', () => {
    expect(debeAceptarTerminos('2026-08-11.10')).toBe(false);
    expect(debeAceptarTerminos('2026-08-11.1')).toBe(true);
    expect(debeAceptarTerminos('2026-08-11')).toBe(true);
  });

  it('la versión material nunca puede ser posterior a la actual', () => {
    // Si alguien sube la material y olvida la de verdad, el aviso saldría pidiendo
    // aceptar un texto que todavía no existe — y no se podría cerrar nunca.
    expect(debeAceptarTerminos(TERMS_VERSION)).toBe(false);
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
