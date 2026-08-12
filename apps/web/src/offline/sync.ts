import type { CreateSaleInput } from '@ventafacil/shared';
import { api, tokens } from '@/lib/api';
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

/**
 * Encola una venta para subir cuando haya conexión. Se guarda de inmediato.
 *
 * `owner` sella quién la cobró: la cola sobrevive al cierre de sesión, y sin el sello
 * las ventas de Ana se subían con el token del siguiente que entrara.
 */
export async function enqueueSale(
  payload: CreateSaleInput,
  owner?: { userId: string; businessId: string },
): Promise<void> {
  const now = new Date().toISOString();
  const row: PendingSale = {
    id: payload.id,
    payload,
    status: 'pending',
    attempts: 0,
    createdAt: now,
    nextAttemptAt: now, // primera subida: sin espera.
    ownerUserId: owner?.userId,
    ownerBusinessId: owner?.businessId,
  };
  await db.pendingSales.put(row);
}

/**
 * Ventas encoladas por OTRA persona (o de otro negocio) que siguen en este dispositivo.
 *
 * No se suben ni se borran: subirlas las grabaría a nombre de quien esté ahora, y
 * borrarlas destruiría ventas ya cobradas. Se enseñan para que quien corresponda entre
 * y las suba.
 */
export async function ventasDeOtraSesion(sesion: {
  userId: string;
  businessId: string;
}): Promise<PendingSale[]> {
  const rows = await db.pendingSales.toArray();
  return rows.filter((r) => esDeOtro(r, sesion));
}

/**
 * De quién es la sesión abierta, leída del access token.
 *
 * Se lee del token y no del contexto de React porque el worker de sincronización corre
 * en un temporizador, fuera del árbol de componentes, y tiene que saber a nombre de
 * quién va a subir lo que suba. No se verifica la firma: aquí sólo se usa para decidir
 * qué NO enviar, y la comprobación de verdad la hace el servidor.
 */
export function sesionActual(): { userId: string; businessId: string } | null {
  const token = tokens.access;
  if (!token) return null;
  try {
    const [, cuerpo] = token.split('.');
    if (!cuerpo) return null;
    const json = atob(cuerpo.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(json) as { sub?: string; businessId?: string };
    if (!claims.sub || !claims.businessId) return null;
    return { userId: claims.sub, businessId: claims.businessId };
  } catch {
    return null;
  }
}

function esDeOtro(r: PendingSale, sesion: { userId: string; businessId: string } | null): boolean {
  // Sin sesión no se juzga a nadie; y las anteriores a la v3 no llevan sello.
  if (!sesion || !r.ownerUserId) return false;
  return r.ownerUserId !== sesion.userId || r.ownerBusinessId !== sesion.businessId;
}

/**
 * Ventas que ya cumplieron su espera, no están descartadas y son de ESTA sesión.
 * Más antiguas primero.
 */
export async function dueSales(
  now: Date = new Date(),
  sesion: { userId: string; businessId: string } | null = sesionActual(),
): Promise<PendingSale[]> {
  const rows = await db.pendingSales
    .where('nextAttemptAt')
    .belowOrEqual(now.toISOString())
    .toArray();
  return rows
    .filter((r) => r.status !== 'failed' && !esDeOtro(r, sesion))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

let syncing = false;

/**
 * Sube las ventas pendientes VENCIDAS (las más antiguas primero).
 * Idempotente por UUID: 'ok' y 'duplicated' cuentan como subidas -> se borran de la cola.
 */
export async function syncPending(): Promise<{ synced: number; failed: number }> {
  /*
    Ya no se mira `navigator.onLine`, y es el arreglo de un fallo que dejaba ventas sin
    subir indefinidamente.

    Ese indicador da falsos negativos justo donde vive este producto: un equipo en el wifi
    de la tienda SIN salida a Internet se declara «offline» aunque el servidor esté en la
    misma red. Con la comprobación aquí, la cola no enviaba nada —ni al cobrar, ni en el
    ping de cada 30 s— y las ventas se acumulaban con un «se sincroniza luego» que no
    llegaba nunca.

    Intentarlo cuando de verdad no hay red no cuesta nada: la petición falla, el backoff
    reprograma cada venta, y desde que el cliente tiene tiempo límite ese fallo es rápido.
    El candado `syncing` sí se queda: evita que dos ciclos se pisen.
  */
  if (syncing) return { synced: 0, failed: 0 };
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
