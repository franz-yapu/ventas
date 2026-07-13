import type { CreateSaleInput } from '@ventafacil/shared';
import { api } from '@/lib/api';
import { db, setMeta, type PendingSale } from './db';

interface SyncItemResult {
  id: string;
  status: 'ok' | 'duplicated' | 'error';
  receiptNumber?: number;
  error?: string;
}

/** Encola una venta para subir cuando haya conexión. Se guarda de inmediato. */
export async function enqueueSale(payload: CreateSaleInput): Promise<void> {
  const row: PendingSale = {
    id: payload.id,
    payload,
    status: 'pending',
    attempts: 0,
    createdAt: new Date().toISOString(),
  };
  await db.pendingSales.put(row);
}

let syncing = false;

/**
 * Sube las ventas pendientes en orden (las más antiguas primero).
 * Idempotente por UUID: 'ok' y 'duplicated' se consideran subidas -> se eliminan de la cola.
 */
export async function syncPending(): Promise<{ synced: number; failed: number }> {
  if (syncing || !navigator.onLine) return { synced: 0, failed: 0 };
  syncing = true;
  try {
    const pending = await db.pendingSales.orderBy('createdAt').toArray();
    if (pending.length === 0) return { synced: 0, failed: 0 };

    const sales = pending.map((p) => p.payload);
    let results: SyncItemResult[];
    try {
      const res = await api.post<{ results: SyncItemResult[] }>('/sales/sync', { sales });
      results = res.results;
    } catch {
      // Falla de red/servidor: incrementa intentos, quedan pendientes para el próximo ciclo.
      await db.transaction('rw', db.pendingSales, async () => {
        for (const p of pending) {
          await db.pendingSales.update(p.id, { attempts: p.attempts + 1, status: 'pending' });
        }
      });
      return { synced: 0, failed: pending.length };
    }

    let synced = 0;
    let failed = 0;
    await db.transaction('rw', db.pendingSales, async () => {
      for (const r of results) {
        if (r.status === 'ok' || r.status === 'duplicated') {
          await db.pendingSales.delete(r.id);
          synced++;
        } else {
          const p = pending.find((x) => x.id === r.id);
          await db.pendingSales.update(r.id, {
            status: 'error',
            attempts: (p?.attempts ?? 0) + 1,
            lastError: r.error,
          });
          failed++;
        }
      }
    });
    await setMeta('lastSyncAt', new Date().toISOString());
    return { synced, failed };
  } finally {
    syncing = false;
  }
}

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;

/** Arranca el worker: al volver online y cada 30s (ping). Backoff simple por reintentos. */
export function startSyncWorker() {
  if (started) return;
  started = true;
  const kick = () => void syncPending();
  window.addEventListener('online', kick);
  // Ping periódico: cubre casos donde el evento 'online' no dispara.
  timer = setInterval(kick, 30_000);
  kick();
}

export function stopSyncWorker() {
  if (timer) clearInterval(timer);
  started = false;
}
