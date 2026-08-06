import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Modo claro / oscuro.
 *
 * Lo que se prueba es la parte con criterio: qué significa "automático" y qué pasa con
 * una preferencia guardada que ya no se entiende. El entorno de estos tests es `node`,
 * así que se montan a mano el `localStorage` y el `matchMedia` mínimos — que es también
 * la forma de comprobar que el código no explota en un navegador que no tenga
 * `matchMedia`, como algunos WebView antiguos de Android.
 */

function montarNavegador({ oscuroDelSistema = false, guardado = null as string | null } = {}) {
  const almacen = new Map<string, string>();
  if (guardado !== null) almacen.set('vf_modo', guardado);

  vi.stubGlobal('localStorage', {
    getItem: (k: string) => almacen.get(k) ?? null,
    setItem: (k: string, v: string) => void almacen.set(k, v),
    removeItem: (k: string) => void almacen.delete(k),
  });

  const atributos = new Map<string, string>();
  vi.stubGlobal('document', {
    documentElement: {
      setAttribute: (k: string, v: string) => void atributos.set(k, v),
      removeAttribute: (k: string) => void atributos.delete(k),
    },
    querySelector: () => null,
  });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));

  const oyentes: Array<() => void> = [];
  vi.stubGlobal('window', {
    matchMedia: (q: string) => ({
      matches: q.includes('dark') && oscuroDelSistema,
      addEventListener: (_: string, f: () => void) => void oyentes.push(f),
      removeEventListener: () => undefined,
    }),
  });

  return { atributos, almacen, oyentes };
}

afterEach(() => vi.unstubAllGlobals());

describe('qué modo se pinta', () => {
  it('"oscuro" es oscuro aunque el sistema esté en claro', async () => {
    montarNavegador({ oscuroDelSistema: false });
    const { esOscuro } = await import('../src/theme/modo');
    expect(esOscuro('oscuro')).toBe(true);
  });

  it('"claro" es claro aunque el sistema esté en oscuro', async () => {
    montarNavegador({ oscuroDelSistema: true });
    const { esOscuro } = await import('../src/theme/modo');
    expect(esOscuro('claro')).toBe(false);
  });

  it('"auto" sigue al sistema, en los dos sentidos', async () => {
    montarNavegador({ oscuroDelSistema: true });
    let mod = await import('../src/theme/modo');
    expect(mod.esOscuro('auto')).toBe(true);

    vi.resetModules();
    montarNavegador({ oscuroDelSistema: false });
    mod = await import('../src/theme/modo');
    expect(mod.esOscuro('auto')).toBe(false);
  });
});

describe('la preferencia guardada', () => {
  it('se recuerda entre sesiones', async () => {
    montarNavegador({ guardado: 'oscuro' });
    const { leerModo } = await import('../src/theme/modo');
    expect(leerModo()).toBe('oscuro');
  });

  it('si está corrupta se cae a "auto" en vez de romper la app', async () => {
    // Puede pasar: una versión anterior guardó otra cosa, o alguien tocó el
    // almacenamiento. Arrancar en automático es lo que menos sorprende.
    for (const basura of ['dark', '', 'null', '{}']) {
      vi.resetModules();
      montarNavegador({ guardado: basura });
      const { leerModo } = await import('../src/theme/modo');
      expect(leerModo(), basura).toBe('auto');
    }
  });

  it('sin nada guardado, arranca en automático', async () => {
    montarNavegador();
    const { leerModo } = await import('../src/theme/modo');
    expect(leerModo()).toBe('auto');
  });
});

describe('aplicar el modo al documento', () => {
  it('en oscuro pone el atributo, en claro lo quita', async () => {
    const { atributos } = montarNavegador({ oscuroDelSistema: false });
    const { aplicarModo } = await import('../src/theme/modo');

    aplicarModo('oscuro');
    expect(atributos.get('data-modo')).toBe('oscuro');

    aplicarModo('claro');
    expect(atributos.has('data-modo')).toBe(false);
  });

  it('guardar aplica y persiste de una vez', async () => {
    const { atributos, almacen } = montarNavegador();
    const { guardarModo } = await import('../src/theme/modo');

    guardarModo('oscuro');
    expect(almacen.get('vf_modo')).toBe('oscuro');
    expect(atributos.get('data-modo')).toBe('oscuro');
  });

  it('un navegador sin matchMedia no revienta: se queda en claro', async () => {
    montarNavegador();
    vi.stubGlobal('window', {});
    const { esOscuro, seguirAlSistema } = await import('../src/theme/modo');
    expect(esOscuro('auto')).toBe(false);
    // Y suscribirse devuelve una baja que tampoco falla al llamarla.
    expect(() => seguirAlSistema(() => 'auto')()).not.toThrow();
  });
});
