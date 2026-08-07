export const ROLES = ['admin', 'seller'] as const;
export type Role = (typeof ROLES)[number];

export const SALE_STATUS = ['completed', 'cancelled'] as const;
export type SaleStatus = (typeof SALE_STATUS)[number];

export const PAYMENT_METHODS = ['cash', 'card', 'qr', 'transfer', 'credit'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const SYNC_STATUS = ['pending', 'synced', 'error'] as const;
export type SyncStatus = (typeof SYNC_STATUS)[number];

export const DEFAULT_TIMEZONE = 'America/La_Paz';
export const DEFAULT_CURRENCY = 'BOB';
export const CURRENCY_SYMBOL = 'Bs.';

export const API_PREFIX = '/api/v1';

/**
 * Cómo se llaman en español las formas de pago y los estados de una venta.
 *
 * Viven aquí y no en la web por lo mismo que los rótulos de la bitácora: en cuanto hay
 * DOS sitios que necesitan traducir un código —una pantalla y una exportación— las dos
 * listas se separan, y la que se queda vieja saca `cash` y `completed` en crudo. Una
 * columna que dice "cash" en un Excel que se le manda al contador no es un detalle.
 *
 * Tipados contra las constantes de arriba: añadir una forma de pago sin ponerle nombre no
 * compila.
 */
export const PAYMENT_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  qr: 'QR',
  transfer: 'Transferencia',
  credit: 'Fiado',
};

export const SALE_STATUS_LABELS: Record<(typeof SALE_STATUS)[number], string> = {
  completed: 'Completada',
  cancelled: 'Anulada',
};

/**
 * El rótulo de una forma de pago, tolerando lo desconocido.
 *
 * El `Record` de arriba está tipado contra la lista para que añadir una forma de pago sin
 * nombre no compile. Pero quien lo consulta suele tener un `string` cualquiera —lo que
 * vino del servidor—, y obligar a cada pantalla a convencer al compilador acabaría en un
 * `as any` puesto con prisa. Esto resuelve las dos cosas: exhaustividad al definir,
 * tolerancia al leer. Si llega un código que no conocemos, se devuelve tal cual: es feo,
 * pero es mejor que una celda vacía.
 */
export function etiquetaDePago(codigo: string): string {
  return PAYMENT_LABELS[codigo as keyof typeof PAYMENT_LABELS] ?? codigo;
}

export function etiquetaDeEstado(codigo: string): string {
  return SALE_STATUS_LABELS[codigo as keyof typeof SALE_STATUS_LABELS] ?? codigo;
}
