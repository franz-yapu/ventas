// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { montar, screen, userEvent, waitFor } from './montar';

/**
 * Lo que no hay, no se puede añadir al carrito.
 *
 * Esta regla estuvo al revés, y el porqué del cambio importa. El razonamiento anterior era:
 * «una tienda que acaba de recibir mercadería sin registrarla se queda sin poder cobrar con
 * el cliente delante, y entonces se cobra por fuera y la venta no se registra en ninguna
 * parte». Era válido mientras el servidor aceptaba la venta y sólo dejaba el stock en rojo.
 *
 * Desde el 12 de agosto de 2026 el servidor la RECHAZA —se encontraron recibos emitidos de
 * mercadería que no salió de ningún sitio—, así que dejar la tarjeta activa ya no permite
 * cobrar: sólo deja montar el carrito entero para chocar contra un 409 al final. La salida
 * para lo recién llegado sigue siendo registrarlo en Inventario.
 *
 * ## Por qué este archivo monta `PosPage` entera
 *
 * Porque al carrito se llega por tres caminos —tocar la tarjeta, escanear un código y
 * pulsar «+»— y la comprobación tiene que estar en los tres. Probando sólo la función
 * quedaría verde con dos puertas abiertas, que es exactamente la clase de hueco que en este
 * proyecto ya ha costado caro.
 */

const productos = [
  {
    id: 'p1',
    sku: 'P0001',
    name: 'Foco LED',
    price: '18.00',
    stock: 5,
    minStock: 2,
    barcode: '111',
  },
  { id: 'p2', sku: 'P0002', name: 'Pila AA', price: '9.50', stock: 0, minStock: 1, barcode: '222' },
  // Sin fila de inventario en esta sucursal: para el servidor es cero, y aquí también.
  {
    id: 'p3',
    sku: 'P0003',
    name: 'Cinta',
    price: '7.00',
    stock: null,
    minStock: null,
    barcode: '333',
  },
];

vi.mock('@/offline/catalog', () => ({
  searchCatalog: vi.fn(async () => productos),
  syncCatalog: vi.fn(async () => undefined),
  findByCode: vi.fn(async (codigo: string) => productos.find((p) => p.barcode === codigo)),
  findByBarcode: vi.fn(async (codigo: string) => productos.find((p) => p.barcode === codigo)),
}));
vi.mock('@/offline/db', () => ({
  getCachedLocations: vi.fn(async () => [{ id: 'loc-1', name: 'Caranavi', isCentral: true }]),
}));
vi.mock('@/offline/sync', () => ({
  enqueueSale: vi.fn(async () => undefined),
  syncPending: vi.fn(async () => ({ synced: 0, failed: 0 })),
  startSyncWorker: vi.fn(),
}));
// `useLiveQuery` es de Dexie; aquí el catálogo ya viene simulado.
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (consulta: () => unknown) => {
    const r = consulta();
    return r instanceof Promise ? productos : r;
  },
}));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return { ...real, api: { ...real.api, get: vi.fn(async () => []), post: vi.fn() } };
});
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      sub: 'u1',
      businessId: 'b1',
      locationId: 'loc-1',
      isCentral: true,
      role: 'admin' as const,
      name: 'Ana',
    },
  }),
}));
vi.mock('@/theme/ThemeProvider', () => ({
  useBusiness: () => ({ maxSellerDiscountPct: 10, productSchema: [] }),
  useMarca: () => ({ name: 'Llantería Central' }),
}));

const { PosPage } = await import('@/features/pos/PosPage');

function conQuery(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return montar(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/**
 * La tarjeta de un producto en la REJILLA.
 *
 * Se toma la primera coincidencia a propósito: en cuanto el producto entra al carrito su
 * nombre aparece también ahí, y `getByText` falla con «found multiple elements».
 */
const tarjeta = (nombre: string) =>
  screen.getAllByText(nombre)[0]!.closest('button') as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('la rejilla de Vender', () => {
  it('deja tocar lo que hay', async () => {
    conQuery(<PosPage />);
    await waitFor(() => expect(tarjeta('Foco LED')).toBeTruthy());
    expect(tarjeta('Foco LED').disabled).toBe(false);
  });

  it('no deja tocar lo que está en cero', async () => {
    conQuery(<PosPage />);
    await waitFor(() => expect(tarjeta('Pila AA')).toBeTruthy());
    expect(tarjeta('Pila AA').disabled, 'se puede añadir algo que no hay').toBe(true);
  });

  it('ni lo que no tiene existencias en esta sucursal', async () => {
    // `stock: null` es «aquí no hay ninguna», no «no se controla»: el servidor lo trata
    // igual, y antes esta tarjeta llegaba a mostrar «Disp. null».
    conQuery(<PosPage />);
    await waitFor(() => expect(tarjeta('Cinta')).toBeTruthy());
    expect(tarjeta('Cinta').disabled).toBe(true);
    expect(screen.queryByText(/Disp\. null/)).toBeNull();
  });

  it('lo dice en la tarjeta, no sólo la apaga', async () => {
    conQuery(<PosPage />);
    await waitFor(() => expect(screen.getAllByText('Sin stock').length).toBeGreaterThan(0));
  });
});

describe('las otras dos puertas al carrito', () => {
  /*
    Escanear un código de barras no pasa por la tarjeta: llega directo. Sin esta
    comprobación, el producto agotado entraba igual y la venta chocaba al cobrar.
  */
  it('escanear un producto agotado no lo mete al carrito', async () => {
    conQuery(<PosPage />);
    const buscador = await screen.findByPlaceholderText(/Nombre, SKU o código/i);
    await userEvent.type(buscador, '222{Enter}');

    expect(await screen.findByText(/Sin existencias de Pila AA/)).toBeTruthy();
    expect(screen.getByText(/Carrito vacío/)).toBeTruthy();
  });

  it('y escanear uno que sí hay, sí', async () => {
    conQuery(<PosPage />);
    const buscador = await screen.findByPlaceholderText(/Nombre, SKU o código/i);
    await userEvent.type(buscador, '111{Enter}');

    expect(await screen.findByText(/Agregado: Foco LED/)).toBeTruthy();
  });

  /*
    El tope se mide contra lo que YA está en el carrito, no sólo contra el stock: con 5
    unidades se pueden vender 5, y la quinta deja la tarjeta apagada sola.
  */
  it('la tarjeta se apaga cuando el carrito agota las existencias', async () => {
    conQuery(<PosPage />);
    await waitFor(() => expect(tarjeta('Foco LED')).toBeTruthy());
    for (let i = 0; i < 5; i++) await userEvent.click(tarjeta('Foco LED'));

    await waitFor(() => expect(tarjeta('Foco LED').disabled).toBe(true));
  });

  it('y el «+» del carrito tampoco pasa de ahí', async () => {
    // La otra puerta: con la tarjeta ya apagada, el «+» seguía subiendo la cantidad.
    conQuery(<PosPage />);
    await waitFor(() => expect(tarjeta('Foco LED')).toBeTruthy());
    for (let i = 0; i < 5; i++) await userEvent.click(tarjeta('Foco LED'));

    await userEvent.click(screen.getByLabelText('Añadir una unidad de Foco LED'));
    expect(await screen.findByText(/No quedan más unidades/)).toBeTruthy();
  });
});
