// IndexedDB en memoria: Dexie funciona igual que en el navegador, sin navegador.
import 'fake-indexeddb/auto';

/**
 * Los tests de LÓGICA corren en Node, que no tiene `window` ni `navigator`, así que se
 * apañan con este remedo mínimo: la cola de sincronización consulta `navigator.onLine` y
 * escucha eventos de `window`.
 *
 * Los tests de COMPONENTES declaran `@vitest-environment jsdom` en su cabecera y ahí sí
 * hay un `window` de verdad. Por eso el remedo sólo se instala **si no hay uno ya**:
 * sobrescribir el de jsdom deja a React sin DOM y los fallos que salen de ahí no se
 * parecen en nada a la causa.
 */
const listeners = new Map<string, Set<() => void>>();

if (typeof window === 'undefined') {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    writable: true,
    configurable: true,
  });

  Object.defineProperty(globalThis, 'window', {
    value: {
      addEventListener: (ev: string, fn: () => void) => {
        if (!listeners.has(ev)) listeners.set(ev, new Set());
        listeners.get(ev)!.add(fn);
      },
      removeEventListener: (ev: string, fn: () => void) => listeners.get(ev)?.delete(fn),
      dispatchEvent: (ev: { type: string }) => {
        listeners.get(ev.type)?.forEach((fn) => fn());
        return true;
      },
    },
    writable: true,
    configurable: true,
  });
}

/** Simula perder o recuperar la conexión dentro de un test. */
export function setOnline(value: boolean) {
  Object.defineProperty(globalThis.navigator, 'onLine', {
    value,
    writable: true,
    configurable: true,
  });
}
