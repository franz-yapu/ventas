/**
 * Datos legales del servicio.
 *
 * ⚠️ **Los textos de términos y privacidad son un BORRADOR redactado a partir de lo que
 * el sistema hace de verdad, no un documento revisado por un abogado.** Antes de abrir
 * el registro al público conviene que los revise alguien con criterio legal en Bolivia
 * — sobre todo la limitación de responsabilidad y lo relativo a datos personales.
 *
 * Los marcadores `[ENTRE CORCHETES]` de `EMPRESA` son lo que falta por completar. No se
 * inventan: poner una razón social o un NIT que no existe sería peor que dejarlo vacío.
 */

/**
 * Versión de los términos. Se guarda junto a la aceptación de cada negocio, así que
 * **cámbiala cada vez que cambie el texto**: si no, no habrá forma de saber qué aceptó
 * cada quien. Formato de fecha para que el orden sea evidente.
 *
 * El sufijo `.2` es la SEGUNDA edición del 11 de agosto: por la mañana salió el fiado y
 * por la tarde se declararon las fotos de producto. Dos cambios distintos el mismo día
 * colapsarían en la misma etiqueta y dejarían de distinguir qué aceptó quien se registró
 * entre medias, que es justo para lo que existe esta constante. La fecha que se enseña en
 * pantalla sale de aquí recortando el sufijo (`ULTIMA_ACTUALIZACION`), así que quien lee
 * los términos sigue viendo una fecha limpia.
 */
export const TERMS_VERSION = '2026-08-11.2';

export const EMPRESA = {
  /** Nombre comercial del producto. */
  producto: 'VentaFácil',
  /** Razón social que presta el servicio. */
  razonSocial: '[RAZÓN SOCIAL]',
  nit: '[NIT]',
  ciudad: '[CIUDAD]',
  pais: 'Bolivia',
  correoContacto: '[CORREO DE CONTACTO]',
  /** Dónde están alojados los datos (proveedor y país del servidor). */
  hosting: '[PROVEEDOR DE HOSTING, PAÍS]',
} as const;

/** Días que se conservan los datos de un negocio tras cancelar, antes de borrarlos. */
export const DIAS_RETENCION_TRAS_CANCELAR = 60;

/** ¿Quedan marcadores sin completar? Sirve para avisar antes de abrir al público. */
export function faltanDatosLegales(): boolean {
  return Object.values(EMPRESA).some((v) => v.includes('['));
}
