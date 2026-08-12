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

/**
 * La última versión cuyo cambio fue MATERIAL: afecta a lo que el cliente puede esperar
 * del servicio, no a una coma.
 *
 * Existe porque `TERMS_VERSION` sube con cualquier edición —hasta una tilde corregida— y
 * los términos prometen aviso sólo «si el cambio es importante». Avisar por una
 * corrección de estilo convertiría el aviso en ruido, y un aviso que sale siempre es un
 * aviso que nadie lee: la próxima vez que cambie algo de verdad, se cerraría igual.
 *
 * **Súbela a mano**, y sólo cuando el cambio toque lo que el cliente puede esperar: qué
 * datos se guardan, cuánto duran, quién los ve, qué puede hacer soporte, cómo se cancela o
 * qué se cobra. Cambiarla hace que a TODOS los negocios que aceptaron una versión anterior
 * les salga el aviso.
 */
export const TERMS_VERSION_MATERIAL = '2026-08-11.2';

/** `2026-08-11.2` → `['2026-08-11', 2]`. Sin sufijo, la edición es 0. */
function partesDeVersion(v: string): [string, number] {
  const [fecha, edicion] = v.split('.');
  return [fecha ?? '', Number(edicion ?? 0)];
}

/**
 * ¿Hay que avisar a este negocio de que los términos cambiaron?
 *
 * Compara lo que aceptó contra el último cambio IMPORTANTE, no contra la versión actual.
 *
 * Vive aquí, en compartido, porque la respuesta la necesitan los dos lados: el servidor
 * para registrar la nueva aceptación y la web para decidir si enseña el aviso. Escrita dos
 * veces acabaría respondiendo distinto, y entonces habría un banner que no se puede cerrar
 * o una aceptación que se guarda sin que nadie la haya visto.
 *
 * Sin nada aceptado (`null`) también se avisa: de un negocio así no consta que aceptara
 * ninguna versión, que es exactamente el caso que esto tiene que resolver.
 *
 * La comparación es por fecha y luego por número de edición, y no de texto: `'2026-08-11.10'`
 * es POSTERIOR a `'2026-08-11.2'`, pero como cadenas el orden sale al revés.
 */
export function debeAceptarTerminos(aceptada: string | null | undefined): boolean {
  if (!aceptada) return true;
  const [fechaA, edicionA] = partesDeVersion(aceptada);
  const [fechaM, edicionM] = partesDeVersion(TERMS_VERSION_MATERIAL);
  if (fechaA !== fechaM) return fechaA < fechaM;
  return edicionA < edicionM;
}

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
