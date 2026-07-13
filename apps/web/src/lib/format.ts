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

export const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  qr: 'QR',
  transfer: 'Transferencia',
  credit: 'Fiado',
};
