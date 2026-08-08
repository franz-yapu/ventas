/**
 * La zona horaria en la que opera el negocio.
 *
 * Estaba escrita dentro de `analytics.ts`, y por eso el historial de caja no la usaba: allí
 * el "hasta" se comparaba contra `T23:59:59.999Z`, o sea las 19:59 locales. Filtrar "hasta
 * hoy" perdía todos los turnos abiertos después de las ocho de la tarde — justo los de la
 * noche, que son los que uno revisa a la mañana siguiente.
 *
 * Es una constante y no una columna del negocio porque hoy todos los clientes están en
 * Bolivia. El día que haya uno fuera, esto es el único sitio que hay que mirar.
 */
export const TZ = 'America/La_Paz';

/**
 * El desfase de una zona en una fecha dada, como `-04:00`.
 *
 * Sirve para construir un instante a partir de una fecha SIN hora: `2026-08-09` no es un
 * momento, es un día en algún sitio, y ese sitio es el negocio. Sin esto, `new Date()` lo
 * interpreta en la zona del proceso —el contenedor corre en UTC— y un informe "del 1 al 9"
 * sale corrido cuatro horas: pierde la última tarde y añade la anterior. Sale igual, sólo
 * que mal, que es la peor forma de fallar porque nadie lo revisa.
 *
 * Se calcula con `Intl` para el día concreto, no con un número fijo: Bolivia no cambia de
 * hora, pero el día que haya un negocio donde sí, un `-04:00` escrito a mano fallaría dos
 * veces al año y nadie sabría por qué.
 */
export function desfaseDe(zona: string, fechaISO: string): string {
  const base = new Date(`${fechaISO}T12:00:00Z`);
  /*
    Una fecha imposible (`2026-08-32`, `2026-13-01`) casa el patrón `AAAA-MM-DD` pero da
    un `Invalid Date`, y `Intl.formatToParts` lanza `RangeError` con él. Sin esta guarda,
    `?from=2026-08-32` reventaba con un 500 — y cada 500 escribe "error no controlado" en
    el log Y manda un aviso por correo, así que bastaba un rastreador probando URLs para
    llenar el buzón de operación con avisos de algo que no está roto.

    Se devuelve UTC y quien llama decide qué hacer: aquí la fecha ya no vale, y el valor
    devuelto no se llega a usar.
  */
  if (Number.isNaN(base.getTime())) return '+00:00';
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    timeZoneName: 'longOffset',
  });
  const parte =
    fmt.formatToParts(base).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  // "GMT-04:00" -> "-04:00"; "GMT" (UTC) -> "+00:00"
  const m = /GMT([+-]\d{2}:\d{2})/.exec(parte);
  return m?.[1] ?? '+00:00';
}
