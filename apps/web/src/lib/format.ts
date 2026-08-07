import { CURRENCY_SYMBOL } from '@ventafacil/shared';

export function money(value: string | number, symbol = CURRENCY_SYMBOL): string {
  const n = typeof value === 'string' ? Number(value) : value;
  return `${symbol} ${n.toFixed(2)}`;
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-BO', {
    timeZone: 'America/La_Paz',
    dateStyle: 'short',
    timeStyle: 'short',
  });
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
export { PAYMENT_LABELS, etiquetaDePago } from '@ventafacil/shared';
