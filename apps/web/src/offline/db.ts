import Dexie, { type EntityTable } from 'dexie';
import type { CreateSaleInput } from '@ventafacil/shared';
import type { Location, Product } from '@/lib/types';

export type PendingStatus = 'pending' | 'error';

export interface PendingSale {
  id: string; // UUID de la venta (clave idempotente)
  payload: CreateSaleInput;
  status: PendingStatus;
  attempts: number;
  lastError?: string;
  createdAt: string;
}

// meta guarda listas auxiliares (ubicaciones) y marcas de tiempo.
export interface MetaRow {
  key: string;
  value: unknown;
}

const db = new Dexie('ventafacil') as Dexie & {
  catalog: EntityTable<Product, 'id'>;
  pendingSales: EntityTable<PendingSale, 'id'>;
  meta: EntityTable<MetaRow, 'key'>;
};

db.version(1).stores({
  catalog: 'id, name, sku, barcode',
  pendingSales: 'id, status, createdAt',
  meta: 'key',
});

export { db };

export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value });
}
export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function getCachedLocations(): Promise<Location[]> {
  return (await getMeta<Location[]>('locations')) ?? [];
}
