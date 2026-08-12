// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Que ninguna petición pueda quedarse esperando para siempre.
 *
 * Salió de un bug BLOQUEANTE en la caja, encontrado probando en el NAS: se seleccionaban
 * varios productos, se pulsaba Cobrar y el botón se quedaba en «Cobrando…» sin volver
 * nunca. El servidor estaba bien —la misma venta por `/sales/sync` responde 200 y da su
 * número de recibo—, así que el cuelgue era del navegador: `fetch` sin tiempo límite deja
 * la promesa viva indefinidamente si la respuesta no llega, y quien la espera se queda
 * ahí.
 *
 * En una tienda esto no es un detalle: la conexión se cae a media venta, la caja se
 * bloquea, y la única salida es recargar la página —con el carrito dentro—. La venta ya
 * está guardada en la cola local antes de intentar subirla, así que rendirse pronto no
 * pierde nada: se sincroniza después.
 */

const abortos: string[] = [];

beforeEach(() => {
  abortos.length = 0;
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** Un `fetch` que no responde jamás, pero que respeta la señal de aborto. */
function fetchQueNuncaResponde() {
  return vi.fn((_url: string, init?: RequestInit) => {
    return new Promise<Response>((_res, rej) => {
      const señal = init?.signal;
      if (señal) {
        señal.addEventListener('abort', () => {
          abortos.push(String(_url));
          rej(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }
    });
  });
}

describe('el cliente del API', () => {
  it('se rinde en vez de esperar para siempre', async () => {
    vi.stubGlobal('fetch', fetchQueNuncaResponde());
    const { api } = await import('@/lib/api');

    const promesa = api.get('/products').then(
      () => 'resolvió',
      (e) => `falló: ${(e as Error).message}`,
    );
    // Antes del plazo sigue esperando, que es lo correcto: una respuesta lenta no es un
    // fallo. Después, se corta.
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await promesa).toMatch(/falló/);
    expect(abortos.length, 'la petición no se abortó').toBe(1);
  });

  /*
    Y el mensaje tiene que ser el de "no se pudo conectar", no uno técnico: quien lo lee
    está en un mostrador con gente esperando.
  */
  it('el fallo por tiempo se explica en castellano', async () => {
    vi.stubGlobal('fetch', fetchQueNuncaResponde());
    const { api, ApiError } = await import('@/lib/api');

    const promesa = api.get('/products').catch((e) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    const error = await promesa;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(String(error.message).toLowerCase()).toMatch(/conexión|conectar|tardó|tiempo/);
  });

  it('una respuesta que llega a tiempo NO se corta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((res) => {
            setTimeout(
              () =>
                res(
                  new Response(JSON.stringify({ data: { ok: true }, error: null }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                  }),
                ),
              1_000,
            );
          }),
      ),
    );
    const { api } = await import('@/lib/api');

    const promesa = api.get<{ ok: boolean }>('/products');
    await vi.advanceTimersByTimeAsync(2_000);

    expect(await promesa).toEqual({ ok: true });
    expect(abortos, 'se abortó una petición que sí respondió').toHaveLength(0);
  });
});
