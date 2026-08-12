// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { montar, screen, userEvent, waitFor } from './montar';

/**
 * Que las PANTALLAS pasen a exportar lo mismo que están filtrando.
 *
 * `exportar.test.tsx` prueba el componente: dado un filtro, lo manda y lo escribe. Esto
 * prueba lo otro, que es donde estaba el fallo de verdad — **que alguien se lo pase**. El
 * componente estaba impecable y las tres pantallas le daban `from`, `to` y `locationId` y
 * nada más, así que Ventas filtrada a «Anuladas» bajaba un papel con todas las completadas
 * dentro.
 *
 * Es la misma lección que ya costó tres veces en este proyecto —el fiado, los `DELETE` de
 * sucursales y la pantalla de Clientes—: un test verde sobre una función no prueba que
 * exista una pantalla que la llame. Por eso aquí se monta la pantalla entera, se toca el
 * filtro como lo tocaría una persona y se mira la URL que sale hacia el servidor.
 */

vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

vi.mock('@/lib/pdf', async (original) => {
  const real = await original<typeof import('@/lib/pdf')>();
  return { ...real, construirPdf: vi.fn(async () => new Blob(['%PDF-falso'])) };
});

const USUARIO = {
  sub: 'u1',
  businessId: 'b1',
  locationId: null,
  isCentral: true,
  role: 'admin' as const,
  name: 'Ana Pérez',
};
vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ user: USUARIO }) }));
vi.mock('@/theme/ThemeProvider', () => ({
  useMarca: () => ({ name: 'Llantería Central', logoUrl: null }),
  useBusiness: () => ({ name: 'Llantería Central', productSchema: [] }),
}));

const { api } = await import('@/lib/api');
const { construirPdf, lineaDeFiltros } = await import('@/lib/pdf');
const { SalesPage } = await import('@/features/sales/SalesPage');
const { AuditPage } = await import('@/features/audit/AuditPage');
const { ProductsPage } = await import('@/features/products/ProductsPage');

const VACIO = { items: [], total: 0, page: 1, limit: 30 };
const USUARIOS = [{ id: 'u-9', name: 'Ana Pérez', role: 'admin', isActive: true }];
const UBICACIONES = [{ id: 'loc-1', name: 'Central', isCentral: true }];

/**
 * Lo que responde el servidor simulado, por ruta.
 *
 * `/locations` y `/users` devuelven un ARRAY pelado y las listas paginadas un objeto con
 * `items`: contestar lo mismo a todo revienta la pantalla con "locations?.map is not a
 * function", que no se parece en nada a lo que este test quiere comprobar.
 */
function responder(seccion: string, filas: Array<Record<string, unknown>>) {
  return async (url: string) => {
    if (url.startsWith('/export/')) return { seccion, filas };
    if (url.startsWith('/locations')) return UBICACIONES;
    if (url.startsWith('/users')) return USUARIOS;
    return VACIO;
  };
}

function conQuery(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return montar(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/** La URL con la que la pantalla pidió las filas a exportar. */
function urlDeExportacion(): string {
  const llamada = vi
    .mocked(api.get)
    .mock.calls.map((c) => String(c[0]))
    .find((u) => u.startsWith('/export/'));
  expect(llamada, 'la pantalla no llegó a pedir la exportación').toBeTruthy();
  return llamada!;
}

/** Lo que quedaría impreso bajo el título del informe. */
function lineaImpresa(): string {
  return lineaDeFiltros(vi.mocked(construirPdf).mock.calls[0]![0]);
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(construirPdf).mockClear();
  // El PDF se descarga de verdad al final; jsdom no implementa ninguna de las dos.
  URL.createObjectURL = vi.fn(() => 'blob:falso');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

describe('Ventas', () => {
  it('el filtro de estado viaja al servidor y sale impreso en el papel', async () => {
    vi.mocked(api.get).mockImplementation(responder('ventas', [{ Recibo: 'R-1' }]) as never);
    conQuery(<SalesPage />);

    await userEvent.selectOptions(
      await screen.findByDisplayValue('Todos los estados'),
      'cancelled',
    );
    await userEvent.click(screen.getByRole('button', { name: /PDF/ }));
    await waitFor(() => expect(construirPdf).toHaveBeenCalled());

    expect(urlDeExportacion()).toContain('status=cancelled');
    expect(lineaImpresa()).toContain('Anulada');
  });

  it('sin filtro de estado no se inventa ninguno', async () => {
    vi.mocked(api.get).mockImplementation(responder('ventas', [{ Recibo: 'R-1' }]) as never);
    conQuery(<SalesPage />);

    await userEvent.click(await screen.findByRole('button', { name: /PDF/ }));
    await waitFor(() => expect(construirPdf).toHaveBeenCalled());

    expect(urlDeExportacion()).not.toContain('status=');
    expect(lineaImpresa()).not.toContain('Anulada');
  });
});

describe('Registro de actividad', () => {
  it('la acción y la persona viajan, y el papel dice el NOMBRE, no el uuid', async () => {
    vi.mocked(api.get).mockImplementation(responder('actividad', [{ Quién: 'Ana' }]) as never);
    conQuery(<AuditPage />);

    await userEvent.selectOptions(await screen.findByDisplayValue('Toda acción'), 'price_change');
    await userEvent.selectOptions(await screen.findByDisplayValue('Todo usuario'), 'u-9');
    await userEvent.click(screen.getByRole('button', { name: /PDF/ }));
    await waitFor(() => expect(construirPdf).toHaveBeenCalled());

    const url = urlDeExportacion();
    expect(url).toContain('action=price_change');
    expect(url).toContain('userId=u-9');

    const linea = lineaImpresa();
    expect(linea).toContain('Cambio de precio');
    expect(linea).toContain('por Ana Pérez');
    expect(linea, 'el uuid se coló en el papel').not.toContain('u-9');
  });
});

describe('Productos', () => {
  it('lo que se tecleó en el buscador viaja y se escribe', async () => {
    vi.mocked(api.get).mockImplementation(
      responder('productos', [{ Producto: 'Filtro de aceite' }]) as never,
    );
    conQuery(<ProductsPage />);

    await userEvent.type(await screen.findByPlaceholderText(/Buscar por nombre/), 'filtro');
    await userEvent.click(screen.getByRole('button', { name: /PDF/ }));
    await waitFor(() => expect(construirPdf).toHaveBeenCalled());

    expect(urlDeExportacion()).toContain('search=filtro');
    expect(lineaImpresa()).toBe('búsqueda "filtro"');
  });
});
