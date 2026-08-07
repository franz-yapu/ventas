import Dexie, { type EntityTable } from 'dexie';
import type { CreateSaleInput } from '@ventafacil/shared';
import type { Location, Product } from '@/lib/types';

// 'pending'  -> en cola, se reintenta solo.
// 'error'    -> el último intento falló; sigue reintentándose con backoff.
// 'failed'   -> agotó MAX_ATTEMPTS; ya NO se reintenta solo, requiere acción del usuario.
export type PendingStatus = 'pending' | 'error' | 'failed';

export interface PendingSale {
  id: string; // UUID de la venta (clave idempotente)
  payload: CreateSaleInput;
  status: PendingStatus;
  attempts: number;
  lastError?: string;
  createdAt: string;
  /**
   * Momento (ISO) a partir del cual se puede volver a intentar. El worker sólo envía
   * las ventas cuya espera ya venció: sin esto, un API caído recibe un reintento de
   * cada cliente cada 30 s indefinidamente.
   */
  nextAttemptAt: string;
  /**
   * Quién cobró esta venta, y en qué negocio.
   *
   * La cola vive en IndexedDB y sobrevive al cierre de sesión. Sin este sello, las
   * ventas pendientes de Ana se subían con el token del SIGUIENTE que entrara: en el
   * mismo local quedaban a nombre de Beto —el servidor toma el vendedor del token, no
   * del payload—, y en otro local el API las rechazaba por alcance, diez reintentos y
   * a `failed`: una venta cobrada que no llega nunca.
   *
   * Opcional porque las que ya estaban en cola antes de la v3 no lo tienen; ésas se
   * suben como siempre (ver la migración).
   */
  ownerUserId?: string;
  ownerBusinessId?: string;
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

// v2: backoff por venta. Se indexa nextAttemptAt para pedir sólo las que ya vencieron.
db.version(2)
  .stores({
    catalog: 'id, name, sku, barcode',
    pendingSales: 'id, status, createdAt, nextAttemptAt',
    meta: 'key',
  })
  .upgrade(async (tx) => {
    // Las ventas que ya estaban en cola se pueden reintentar de inmediato.
    const now = new Date().toISOString();
    await tx
      .table<PendingSale>('pendingSales')
      .toCollection()
      .modify((row) => {
        row.nextAttemptAt ??= now;
      });
  });

/*
  v3: cada venta pendiente recuerda quién la cobró.

  No se toca lo que ya estaba en cola: sin sello se sube como hasta ahora. Marcarlas
  como ajenas dejaría ventas cobradas sin subir en el dispositivo de alguien, que es
  exactamente el daño que se quiere evitar. El sello empieza a valer para las nuevas.
*/
db.version(3).stores({
  catalog: 'id, name, sku, barcode',
  pendingSales: 'id, status, createdAt, nextAttemptAt, ownerUserId',
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
