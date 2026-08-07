import type { CreateSaleInput } from '@ventafacil/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setOnline } from './setup';

// El cliente HTTP se sustituye: aquí se prueba la COLA, no la red.
const post = vi.fn();
// `tokens` también: la cola lee de ahí de quién es la sesión, para no subir con el
// token de uno lo que cobró otro.
let accessToken = '';
vi.mock('@/lib/api', () => ({
  api: { post: (...args: unknown[]) => post(...args) },
  tokens: {
    get access() {
      return accessToken;
    },
  },
}));

/** Access token de mentira: sólo se lee su carga, nunca se verifica la firma. */
function tokenDe(userId: string, businessId: string): string {
  const cuerpo = btoa(JSON.stringify({ sub: userId, businessId }));
  return `cabecera.${cuerpo}.firma`;
}

const ANA = { userId: 'ana', businessId: 'negocio-1' };
const BETO = { userId: 'beto', businessId: 'negocio-1' };

const { db } = await import('@/offline/db');
const {
  backoffDelay,
  dueSales,
  enqueueSale,
  retryFailed,
  syncPending,
  sesionActual,
  ventasDeOtraSesion,
} = await import('@/offline/sync');

function sale(id: string): CreateSaleInput {
  return {
    id,
    locationId: '11111111-1111-4111-8111-111111111111',
    status: 'completed',
    subtotal: '100.00',
    discount: '0',
    total: '100.00',
    paymentMethod: 'cash',
    clientCreatedAt: new Date().toISOString(),
    items: [
      {
        productId: '22222222-2222-4222-8222-222222222222',
        productNameSnapshot: 'Llanta',
        unitPriceSnapshot: '100.00',
        quantity: 1,
        lineTotal: '100.00',
      },
    ],
  } as CreateSaleInput;
}

const UUID_A = '33333333-3333-4333-8333-333333333333';
const UUID_B = '44444444-4444-4444-8444-444444444444';

beforeEach(async () => {
  post.mockReset();
  setOnline(true);
  accessToken = '';
  await db.pendingSales.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('backoffDelay', () => {
  it('crece exponencialmente con los intentos', () => {
    const sinJitter = (n: number) => backoffDelay(n, () => 0);
    expect(sinJitter(0)).toBeLessThan(sinJitter(1));
    expect(sinJitter(1)).toBeLessThan(sinJitter(2));
    expect(sinJitter(2)).toBeLessThan(sinJitter(5));
  });

  it('tiene un techo: no crece indefinidamente', () => {
    expect(backoffDelay(50, () => 1)).toBe(30 * 60_000);
    expect(backoffDelay(999, () => 1)).toBe(30 * 60_000);
  });

  it('aplica jitter: dos clientes no reintentan en el mismo instante', () => {
    // Es la propiedad que evita el efecto manada tras una caída del API.
    const valores = new Set(Array.from({ length: 50 }, () => backoffDelay(5)));
    expect(valores.size).toBeGreaterThan(1);
  });

  it('el jitter nunca produce una espera menor a la mitad ni mayor al total', () => {
    for (let intento = 0; intento < 8; intento++) {
      const min = backoffDelay(intento, () => 0);
      const max = backoffDelay(intento, () => 1);
      for (let i = 0; i < 20; i++) {
        const d = backoffDelay(intento);
        expect(d).toBeGreaterThanOrEqual(min);
        expect(d).toBeLessThanOrEqual(max);
      }
    }
  });
});

describe('cola de ventas', () => {
  it('una venta sincronizada sale de la cola', async () => {
    await enqueueSale(sale(UUID_A));
    post.mockResolvedValue({ results: [{ id: UUID_A, status: 'ok', receiptNumber: 1 }] });

    const r = await syncPending();
    expect(r.synced).toBe(1);
    expect(await db.pendingSales.count()).toBe(0);
  });

  it('un duplicado cuenta como subida: no se pierde ni se reenvía para siempre', async () => {
    await enqueueSale(sale(UUID_A));
    post.mockResolvedValue({ results: [{ id: UUID_A, status: 'duplicated', receiptNumber: 7 }] });

    await syncPending();
    expect(await db.pendingSales.count()).toBe(0);
  });

  it('sin conexión no se envía nada y la venta se conserva', async () => {
    setOnline(false);
    await enqueueSale(sale(UUID_A));

    const r = await syncPending();
    expect(post).not.toHaveBeenCalled();
    expect(r.synced).toBe(0);
    expect(await db.pendingSales.count()).toBe(1);
  });

  it('encolar la misma venta dos veces no la duplica (idempotencia por UUID)', async () => {
    await enqueueSale(sale(UUID_A));
    await enqueueSale(sale(UUID_A));
    expect(await db.pendingSales.count()).toBe(1);
  });
});

describe('backoff ante caída del API', () => {
  it('tras un fallo de red la venta queda con espera futura', async () => {
    await enqueueSale(sale(UUID_A));
    post.mockRejectedValue(new Error('ECONNREFUSED'));

    await syncPending();

    const row = await db.pendingSales.get(UUID_A);
    expect(row?.attempts).toBe(1);
    expect(new Date(row!.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('NO reintenta antes de que venza la espera (el bug que se corrigió)', async () => {
    await enqueueSale(sale(UUID_A));
    post.mockRejectedValue(new Error('ECONNREFUSED'));

    await syncPending();
    expect(post).toHaveBeenCalledTimes(1);

    // Antes, cada tick de 30 s reenviaba igual: N clientes martillando un API caído.
    await syncPending();
    await syncPending();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('vuelve a intentar una vez vencida la espera', async () => {
    await enqueueSale(sale(UUID_A));
    post.mockRejectedValue(new Error('ECONNREFUSED'));
    await syncPending();

    // Adelanta el reloj más allá de la espera programada.
    const row = await db.pendingSales.get(UUID_A);
    const despues = new Date(new Date(row!.nextAttemptAt).getTime() + 1000);
    expect(await dueSales(despues)).toHaveLength(1);
  });

  it('la espera se alarga con cada fallo consecutivo', async () => {
    await enqueueSale(sale(UUID_A));
    post.mockRejectedValue(new Error('caído'));

    const esperas: number[] = [];
    for (let i = 0; i < 4; i++) {
      const antes = Date.now();
      await syncPending();
      const row = await db.pendingSales.get(UUID_A);
      esperas.push(new Date(row!.nextAttemptAt).getTime() - antes);
      // Vence la espera a mano para forzar el siguiente intento.
      await db.pendingSales.update(UUID_A, { nextAttemptAt: new Date(0).toISOString() });
    }
    // Con jitter no siempre crece intento a intento, pero el último debe superar al primero.
    expect(esperas.at(-1)!).toBeGreaterThan(esperas[0]!);
  });

  it('tras agotar los intentos deja de reintentarse solo y queda visible', async () => {
    await enqueueSale(sale(UUID_A));
    post.mockRejectedValue(new Error('caído'));

    for (let i = 0; i < 12; i++) {
      await db.pendingSales.update(UUID_A, { nextAttemptAt: new Date(0).toISOString() });
      await syncPending();
    }

    const row = await db.pendingSales.get(UUID_A);
    expect(row?.status).toBe('failed');
    // Ya no entra en las vencidas, por más que pase el tiempo.
    expect(await dueSales(new Date(Date.now() + 86_400_000))).toHaveLength(0);
    // Pero la venta NO se perdió.
    expect(await db.pendingSales.count()).toBe(1);
  });

  it('retryFailed vuelve a poner en cola las descartadas', async () => {
    await enqueueSale(sale(UUID_A));
    await db.pendingSales.update(UUID_A, { status: 'failed', attempts: 99 });

    expect(await retryFailed()).toBe(1);
    const row = await db.pendingSales.get(UUID_A);
    expect(row?.status).toBe('pending');
    expect(await dueSales()).toHaveLength(1);
  });

  it('una venta en espera no bloquea a otra que ya vencía', async () => {
    await enqueueSale(sale(UUID_A));
    post.mockRejectedValue(new Error('caído'));
    await syncPending(); // A queda en espera

    post.mockReset();
    post.mockResolvedValue({ results: [{ id: UUID_B, status: 'ok', receiptNumber: 2 }] });
    await enqueueSale(sale(UUID_B)); // B es nueva: se envía ya

    const r = await syncPending();
    expect(r.synced).toBe(1);
    expect(await db.pendingSales.get(UUID_B)).toBeUndefined();
    expect(await db.pendingSales.get(UUID_A)).toBeDefined();
  });
});

describe('la cola no cambia de dueño al cambiar de sesión', () => {
  /**
   * La cola vive en IndexedDB y sobrevive al cierre de sesión. Sin dueño, las ventas
   * pendientes de Ana se subían con el token del siguiente que entrara: en el mismo
   * local quedaban a nombre de Beto —el servidor toma el vendedor del token, no del
   * payload—, y en otro local el API las rechazaba por alcance, diez reintentos y a
   * `failed`: una venta cobrada que no llega nunca.
   */
  it('las ventas de Ana no se suben con la sesión de Beto', async () => {
    accessToken = tokenDe(ANA.userId, ANA.businessId);
    await enqueueSale(sale(UUID_A), ANA);

    // Ana cierra sesión y entra Beto en la misma caja.
    accessToken = tokenDe(BETO.userId, BETO.businessId);
    const res = await syncPending();

    expect(post).not.toHaveBeenCalled();
    expect(res.synced).toBe(0);
    // Y siguen ahí: borrarlas destruiría una venta ya cobrada.
    expect(await db.pendingSales.count()).toBe(1);
  });

  it('cuando vuelve Ana, se suben', async () => {
    accessToken = tokenDe(ANA.userId, ANA.businessId);
    await enqueueSale(sale(UUID_A), ANA);
    accessToken = tokenDe(BETO.userId, BETO.businessId);
    await syncPending();

    accessToken = tokenDe(ANA.userId, ANA.businessId);
    post.mockResolvedValue({ results: [{ id: UUID_A, status: 'ok', receiptNumber: 1 }] });
    const res = await syncPending();

    expect(res.synced).toBe(1);
    expect(await db.pendingSales.count()).toBe(0);
  });

  it('tampoco cruzan de negocio', async () => {
    accessToken = tokenDe(ANA.userId, ANA.businessId);
    await enqueueSale(sale(UUID_A), ANA);
    // El mismo usuario, otro negocio: no debería pasar, pero si pasa no se sube.
    accessToken = tokenDe(ANA.userId, 'negocio-2');
    await syncPending();
    expect(post).not.toHaveBeenCalled();
  });

  it('se pueden contar para avisar en pantalla', async () => {
    accessToken = tokenDe(ANA.userId, ANA.businessId);
    await enqueueSale(sale(UUID_A), ANA);
    await enqueueSale(sale(UUID_B), ANA);

    const ajenas = await ventasDeOtraSesion(BETO);
    expect(ajenas).toHaveLength(2);
    expect(await ventasDeOtraSesion(ANA)).toHaveLength(0);
  });

  it('lo encolado ANTES de que existiera el sello se sigue subiendo', async () => {
    /*
      Las ventas que ya estaban en la cola no llevan dueño. Marcarlas como ajenas
      dejaría ventas cobradas atrapadas en el dispositivo de alguien, que es justo el
      daño que se quiere evitar. El sello vale para las nuevas.
    */
    await enqueueSale(sale(UUID_A)); // sin dueño, como antes de la v3
    accessToken = tokenDe(BETO.userId, BETO.businessId);
    post.mockResolvedValue({ results: [{ id: UUID_A, status: 'ok', receiptNumber: 9 }] });

    expect((await syncPending()).synced).toBe(1);
  });

  it('sin sesión abierta no se juzga a nadie', async () => {
    // Al arrancar la app antes de entrar: `dueSales` no debe esconder nada.
    await enqueueSale(sale(UUID_A), ANA);
    accessToken = '';
    expect(sesionActual()).toBeNull();
    expect(await dueSales()).toHaveLength(1);
  });
});
