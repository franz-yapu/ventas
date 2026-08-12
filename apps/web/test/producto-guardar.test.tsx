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
  const sku = await screen.findByPlaceholderText('Se genera solo al guardar');
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

/**
 * El SKU y la descripción, dos cosas que el formulario hacía al revés.
 *
 * Pedido tras usar el sistema (12 de agosto de 2026):
 *
 * - **El SKU se generaba solo, pero se podía escribir y corregir a mano.** Un código que
 *   el sistema controla y que a la vez cualquiera puede reescribir no es un código: es una
 *   invitación a duplicados y a erratas, y ese SKU viaja a recibos y exportaciones ya
 *   emitidos.
 * - **La descripción existía en la base y el POS la enseñaba —«Llanta 175/70R13» contra
 *   «…reforzada» es la pregunta del mostrador—, pero NO había forma de escribirla.** Un
 *   campo que se lee y no se puede rellenar es peor que no tenerlo: parece que el sistema
 *   perdió el dato.
 */
describe('el SKU y la descripción en el formulario', () => {
  async function abrirNuevo() {
    conQuery(<ProductsPage />);
    await userEvent.click((await screen.findAllByRole('button', { name: /Nuevo/ }))[0]!);
  }

  it('el SKU no se puede escribir: lo pone el sistema', async () => {
    await abrirNuevo();
    // Si sigue habiendo un campo donde teclear el SKU, esto lo encuentra.
    const campos = screen.queryAllByLabelText(/SKU/i);
    for (const c of campos) {
      expect(
        (c as HTMLInputElement).readOnly || (c as HTMLInputElement).disabled,
        'el SKU se puede teclear',
      ).toBe(true);
    }
    expect(screen.getByPlaceholderText(/se genera solo/i)).toBeTruthy();
  });

  it('y al guardar no se manda ninguno inventado', async () => {
    vi.mocked(api.post).mockResolvedValue(PRODUCTO_CREADO as never);
    await abrirNuevo();
    await userEvent.type(screen.getByLabelText('Nombre'), 'Caramelo surtido');
    await userEvent.type(screen.getByLabelText('Precio de venta'), '1.50');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const cuerpo = vi.mocked(api.post).mock.calls[0]![1] as Record<string, unknown>;
    expect(cuerpo.sku, 'mandó un SKU escrito a mano').toBeUndefined();
  });

  /*
    La descripción admite texto largo: es donde se distingue un producto de otro que se
    llama casi igual, y en una sola línea no cabe.
  */
  it('la descripción se puede escribir, y viaja al guardar', async () => {
    vi.mocked(api.post).mockResolvedValue(PRODUCTO_CREADO as never);
    await abrirNuevo();
    const desc = screen.getByLabelText(/Descripción/i);
    expect(desc.tagName.toLowerCase(), 'la descripción no admite texto largo').toBe('textarea');

    await userEvent.type(screen.getByLabelText('Nombre'), 'Polera algodón');
    await userEvent.type(screen.getByLabelText('Precio de venta'), '80');
    await userEvent.type(desc, 'Talla M, cuello redondo, algodón peinado');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const cuerpo = vi.mocked(api.post).mock.calls[0]![1] as Record<string, unknown>;
    expect(cuerpo.description).toBe('Talla M, cuello redondo, algodón peinado');
  });
});
