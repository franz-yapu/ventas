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
