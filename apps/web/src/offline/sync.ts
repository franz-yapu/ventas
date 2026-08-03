import type { CreateSaleInput } from '@ventafacil/shared';
import { api } from '@/lib/api';
import { db, setMeta, type PendingSale } from './db';

interface SyncItemResult {
  id: string;
  status: 'ok' | 'duplicated' | 'error';
  receiptNumber?: number;
  error?: string;
}

/** Espera base del primer reintento. */
const BASE_DELAY_MS = 15_000;
/** Techo de la espera: una venta atascada reintenta como mucho cada 30 min. */
const MAX_DELAY_MS = 30 * 60_000;
/** Tras estos intentos la venta se marca 'failed' y deja de reintentarse sola. */
const MAX_ATTEMPTS = 10;
/** Cada cuánto despierta el worker a mirar si hay ventas vencidas. */
const TICK_MS = 30_000;

/**
 * Backoff exponencial con jitter (estrategia "equal jitter").
 *
 * La mitad de la espera es fija y la otra mitad aleatoria. El jitter es la parte
 * importante: sin él, todos los clientes que fallaron a la vez —justo lo que pasa
 * cuando se cae el API— vuelven a intentar en el mismo instante y lo tumban otra vez
 * al revivir (efecto manada). Con jitter, los reintentos se reparten en el tiempo.
 *
 * attempts: 0 → ~7-15 s · 1 → ~15-30 s · 2 → ~30-60 s · 5 → ~4-8 min · 7+ → ~15-30 min
 */
export function backoffDelay(attempts: number, rand: () => number = Math.random): number {
  const exp = Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempts), MAX_DELAY_MS);
  return Math.round(exp / 2 + rand() * (exp / 2));
}

function nextAttemptFrom(attempts: number, now: number = Date.now()): string {
  return new Date(now + backoffDelay(attempts)).toISOString();
}

/** Encola una venta para subir cuando haya conexión. Se guarda de inmediato. */
export async function enqueueSale(payload: CreateSaleInput): Promise<void> {
  const now = new Date().toISOString();
  const row: PendingSale = {
    id: payload.id,
    payload,
    status: 'pending',
    attempts: 0,
    createdAt: now,
    nextAttemptAt: now, // primera subida: sin espera.
  };
  await db.pendingSales.put(row);
}

/** Ventas que ya cumplieron su espera y no están descartadas. Más antiguas primero. */
export async function dueSales(now: Date = new Date()): Promise<PendingSale[]> {
  const rows = await db.pendingSales
    .where('nextAttemptAt')
    .belowOrEqual(now.toISOString())
    .toArray();
  return rows
    .filter((r) => r.status !== 'failed')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

let syncing = false;

/**
 * Sube las ventas pendientes VENCIDAS (las más antiguas primero).
 * Idempotente por UUID: 'ok' y 'duplicated' cuentan como subidas -> se borran de la cola.
 */
export async function syncPending(): Promise<{ synced: number; failed: number }> {
  if (syncing || !navigator.onLine) return { synced: 0, failed: 0 };
  syncing = true;
  try {
    const pending = await dueSales();
    if (pending.length === 0) return { synced: 0, failed: 0 };

    const sales = pending.map((p) => p.payload);
    let results: SyncItemResult[];
    try {
      const res = await api.post<{ results: SyncItemResult[] }>('/sales/sync', { sales });
      results = res.results;
    } catch {
      // Falla de red/servidor: reprograma cada venta con backoff en vez de reintentar
      // en el próximo tick. Así un API caído no recibe una ráfaga cada 30 s por cliente.
      await db.transaction('rw', db.pendingSales, async () => {
        for (const p of pending) {
          const attempts = p.attempts + 1;
          await db.pendingSales.update(p.id, {
            attempts,
            status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
            nextAttemptAt: nextAttemptFrom(attempts),
          });
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
          const attempts = (p?.attempts ?? 0) + 1;
          await db.pendingSales.update(r.id, {
            // Agotados los intentos deja de reintentarse solo: la venta queda visible
            // para que alguien decida, en lugar de girar en la cola para siempre.
            status: attempts >= MAX_ATTEMPTS ? 'failed' : 'error',
            attempts,
            lastError: r.error,
            nextAttemptAt: nextAttemptFrom(attempts),
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

/** Reintenta ya las ventas descartadas (acción manual desde la UI). */
export async function retryFailed(): Promise<number> {
  const now = new Date().toISOString();
  const failed = await db.pendingSales.where('status').equals('failed').toArray();
  await db.transaction('rw', db.pendingSales, async () => {
    for (const f of failed) {
      await db.pendingSales.update(f.id, { status: 'pending', attempts: 0, nextAttemptAt: now });
    }
  });
  return failed.length;
}

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;

/** Arranca el worker: al volver online y cada 30 s. El backoff decide qué se envía. */
export function startSyncWorker() {
  if (started) return;
  started = true;
  const kick = () => void syncPending();
  window.addEventListener('online', kick);
  // Ping periódico: cubre casos donde el evento 'online' no dispara.
  timer = setInterval(kick, TICK_MS);
  kick();
}

export function stopSyncWorker() {
  if (timer) clearInterval(timer);
  started = false;
}
