// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, montar, screen, userEvent, waitFor } from './montar';
import { ProductsPage } from '@/features/products/ProductsPage';

/**
 * Guardar un producto son DOS peticiones, y la segunda puede fallar sola.
 *
 * El producto se crea primero porque su foto necesita un identificador que todavía no
 * existe. Eso está bien pensado —al revés, un fallo de red con la foto tirar√≠a también el
 * nombre y el precio—, pero deja una ventana: si la subida falla, el modal sigue abierto
 * con el producto YA creado. Volver a pulsar Guardar hacía un segundo POST, y como el SKU
 * se genera solo cuando se deja vacío no hay ningún 409 que lo detenga: la tienda acababa
 * con dos productos idénticos, dos filas de inventario y las dos contando contra el cupo
 * del plan.
 *
 * Un fallo de red al subir una foto por la conexión de una tienda no es un caso raro: es
 * el caso normal.
 */

vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    api: {
      ...real.api,
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      del: vi.fn(),
      postBinary: vi.fn(),
    },
  };
});

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      sub: 'u1',
      businessId: 'b1',
      locationId: null,
      isCentral: true,
      role: 'admin',
      name: 'Ana',
    },
  }),
}));
vi.mock('@/theme/ThemeProvider', () => ({
  useBusiness: () => ({ currency: 'Bs' }),
  useMarca: () => ({ name: 'Llantería Central' }),
}));

const { api } = await import('@/lib/api');

/** El recorte a 800×800 necesita un canvas de verdad; aquí sólo hace falta que haya foto. */
vi.mock('@/lib/imagen', async (original) => {
  const real = await original<typeof import('@/lib/imagen')>();
  return {
    ...real,
    prepararImagen: vi.fn(async () => ({
      blob: new Blob([new Uint8Array(8)], { type: 'image/webp' }),
      url: 'blob:falsa',
      bytes: 61_000,
      bytesOriginal: 3_800_000,
    })),
  };
});

function conQuery(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return montar(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const PRODUCTO_CREADO = {
  id: 'p-nuevo',
  name: 'Llanta 175/70 R13',
  price: '350.00',
  imageUrl: null,
};

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:falsa');
  URL.revokeObjectURL = vi.fn();
  for (const m of [api.get, api.post, api.patch, api.del, api.postBinary]) vi.mocked(m).mockReset();

  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path.startsWith('/locations')) return [{ id: 'loc-1', name: 'Principal', isCentral: true }];
    return { items: [], total: 0 };
  });
  vi.mocked(api.post).mockResolvedValue(PRODUCTO_CREADO as never);
  vi.mocked(api.patch).mockResolvedValue(PRODUCTO_CREADO as never);
});

/** Abre «Nuevo», pone nombre y precio, y adjunta una foto. */
async function rellenarConFoto() {
  await userEvent.click(await screen.findByRole('button', { name: /Nuevo/ }));

  /*
    El campo se ancla al del SKU, que es el único identificable por su marcador, y se toma
    el siguiente. Contando cajas de texto a ojo se acertaba con el buscador de la pantalla
    en vez de con el nombre, y el producto se guardaba sin nombre sin que el test lo dijera.
  */
  const sku = await screen.findByPlaceholderText('Se genera automáticamente');
  const cajas = screen.getAllByRole('textbox');
  const nombre = cajas[cajas.indexOf(sku as HTMLInputElement) + 1]!;
  await userEvent.type(nombre, 'Llanta 175/70 R13');

  /*
    `fireEvent.change` y no `userEvent.upload`: el `<input type="file">` va con
    `className="hidden"` —se abre desde el botón «Elegir foto»— y userEvent se niega a
    interactuar con lo que no se ve.
  */
  const archivo = new File([new Uint8Array(8)], 'foto.webp', { type: 'image/webp' });
  // `accept="image/*"`: el modal de importar productos también tiene un input de archivo,
  // y está ANTES en el DOM — sin acotar, el primer intento le metía la foto al importador
  // de CSV, que contestaba «¿Es un Excel o un CSV?».
  const entrada = document.querySelector(
    'input[type="file"][accept="image/*"]',
  ) as HTMLInputElement;
  fireEvent.change(entrada, { target: { files: [archivo] } });
  await screen.findByText(/Se subirá al guardar/);
}

describe('cuando la foto falla al subir', () => {
  it('el segundo intento CORRIGE el producto, no crea otro', async () => {
    vi.mocked(api.postBinary).mockRejectedValue(new Error('sin red'));
    conQuery(<ProductsPage />);
    await rellenarConFoto();

    const guardar = screen.getByRole('button', { name: /^Guardar$/ });
    await userEvent.click(guardar);
    await waitFor(() => expect(api.postBinary).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledTimes(1);

    // Segundo intento, como haría cualquiera al ver un error.
    await userEvent.click(await screen.findByRole('button', { name: /^Guardar$/ }));
    await waitFor(() => expect(api.postBinary).toHaveBeenCalledTimes(2));

    expect(vi.mocked(api.post).mock.calls.length, 'se creó un segundo producto').toBe(1);
    expect(api.patch, 'el reintento no corrigió el que ya existía').toHaveBeenCalledWith(
      '/products/p-nuevo',
      expect.objectContaining({ name: 'Llanta 175/70 R13' }),
    );
  });

  it('el mensaje dice que el producto SÍ se guardó', async () => {
    // Con «Error al guardar» a secas, quien lo lee entiende que no se guardó nada — y por
    // eso vuelve a pulsar creyendo que empieza de cero.
    vi.mocked(api.postBinary).mockRejectedValue(new Error('sin red'));
    conQuery(<ProductsPage />);
    await rellenarConFoto();
    await userEvent.click(screen.getByRole('button', { name: /^Guardar$/ }));

    const aviso = await screen.findByText(/El producto se guardó/);
    expect(aviso.textContent).toMatch(/foto/);
  });

  it('si todo va bien, se crea una sola vez y se sube la foto', async () => {
    vi.mocked(api.postBinary).mockResolvedValue({} as never);
    conQuery(<ProductsPage />);
    await rellenarConFoto();
    await userEvent.click(screen.getByRole('button', { name: /^Guardar$/ }));

    await waitFor(() => expect(api.postBinary).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.patch).not.toHaveBeenCalled();
  });
});
