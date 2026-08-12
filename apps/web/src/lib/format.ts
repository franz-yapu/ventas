import { CURRENCY_SYMBOL } from '@ventafacil/shared';

export function money(value: string | number, symbol = CURRENCY_SYMBOL): string {
  const n = typeof value === 'string' ? Number(value) : value;
  return `${symbol} ${n.toFixed(2)}`;
}

/**
 * La zona del negocio. Bolivia, UTC−4, sin horario de verano.
 *
 * Estaba escrita dentro de `dateTime` y ya hacía falta en un segundo sitio — que es como
 * empiezan a separarse dos constantes. El día que haya negocios en otra zona, se cambia
 * aquí y cambia en todo lo que se lee y se archiva.
 */
export const TZ = 'America/La_Paz';

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-BO', {
    timeZone: TZ,
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

/**
 * `2026-08-11` para el nombre de un archivo, en la zona del NEGOCIO.
 *
 * Los informes se archivan, así que el nombre del archivo y lo que dice el papel por
 * dentro tienen que coincidir. Con `toISOString()` —que es UTC— no coincidían: un informe
 * generado a las 21:00 del 11 de agosto en Bolivia se guardaba como
 * `ventas-2026-08-12.pdf` mientras la hoja decía «Generado … 11/8/26, 9:00 p. m.». La
 * carpeta y el papel discrepaban sobre qué día se hizo.
 *
 * No sirve `dateTime`, que devuelve `11/8/26`: un nombre de archivo tiene que ordenarse
 * solo, y para eso hace falta AAAA-MM-DD. Se arma con `formatToParts` en vez de con el
 * truco de `toLocaleDateString('en-CA')` porque aquí el formato es el requisito, y dejarlo
 * a merced de las convenciones de un idioma es pedirle a la suerte que no cambien.
 */
export function fechaDeArchivo(cuando: Date): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(cuando);
  const de = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  return `${de('year')}-${de('month')}-${de('day')}`;
}

// Rango de la semana actual (lunes a domingo) en formato YYYY-MM-DD (hora local),
// para usar como valor por defecto de los filtros de rango de fecha.
export function currentWeek(): { from: string; to: string } {
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = new Date();
  const daysSinceMonday = (now.getDay() + 6) % 7; // getDay(): 0=domingo … 6=sábado
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { from: fmt(monday), to: fmt(sunday) };
}

/**
 * Re-exportado de `@ventafacil/shared`: la lista vive en un solo sitio.
 *
 * Estaba escrita aquí, y al añadir la exportación a Excel apareció el segundo sitio que
 * la necesitaba — que es justo como dos listas empiezan a separarse. Se deja el nombre de
 * siempre para no tocar las quince pantallas que ya lo importan de aquí.
 */
export { PAYMENT_LABELS, etiquetaDePago, etiquetaDeEstado } from '@ventafacil/shared';
