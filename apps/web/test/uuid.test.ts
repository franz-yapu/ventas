// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uuid } from '@/lib/uuid';

/**
 * El identificador de una venta, ahí donde `crypto.randomUUID` no existe.
 *
 * Esto salió de un bug BLOQUEANTE en la instancia de prueba: se pulsaba Cobrar y la venta
 * no se registraba. La causa no estaba en el servidor —la misma venta por API responde 201—
 * sino en la primera línea del cobro: `crypto.randomUUID()`.
 *
 * Esa API sólo existe en **contextos seguros** (HTTPS o localhost). Servida por `http://` a
 * una IP de la red local, `crypto.randomUUID` es `undefined` y llamarla lanza. En
 * producción hay HTTPS, así que ahí nunca se vio: es exactamente el fallo que sólo aparece
 * donde el sistema se usa —una caja conectada a la red de la tienda—.
 *
 * El id es la clave de idempotencia de la venta: lo que impide que un reintento de la cola
 * la registre dos veces. Por eso se comprueba que sean únicos de verdad y no sólo que
 * tengan la forma correcta.
 */

const FORMA_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uuid', () => {
  it('tiene la forma de un UUID v4', () => {
    expect(uuid()).toMatch(FORMA_V4);
  });

  /*
    El caso que motivó todo: un navegador servido por http a una IP. `randomUUID` no está,
    pero `getRandomValues` sí — y con eso basta.
  */
  it('funciona sin `crypto.randomUUID`, que es como corre en la red local', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    });
    expect(globalThis.crypto.randomUUID).toBeUndefined();
    expect(uuid()).toMatch(FORMA_V4);
  });

  it('y hasta sin `crypto` en absoluto', () => {
    // No sirve para nada criptográfico, pero para una clave de idempotencia local es
    // preferible a no poder cobrar.
    vi.stubGlobal('crypto', undefined);
    expect(uuid()).toMatch(FORMA_V4);
  });

  it('no se repite: es la clave que impide cobrar dos veces la misma venta', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    });
    const vistos = new Set(Array.from({ length: 2000 }, () => uuid()));
    expect(vistos.size).toBe(2000);
  });
});
