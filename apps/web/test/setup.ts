// IndexedDB en memoria: Dexie funciona igual que en el navegador, sin navegador.
import 'fake-indexeddb/auto';

// La cola consulta navigator.onLine y escucha eventos de window; en Node no existen.
const listeners = new Map<string, Set<() => void>>();

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

/** Simula perder o recuperar la conexión dentro de un test. */
export function setOnline(value: boolean) {
  (globalThis.navigator as { onLine: boolean }).onLine = value;
}
