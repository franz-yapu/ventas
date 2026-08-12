// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { montar, screen, userEvent, waitFor } from './montar';
import { CustomersPage } from '@/features/customers/CustomersPage';

/**
 * La pantalla de Clientes llega hasta el API.
 *
 * `/customers` existía desde la fase 6 y el POS venía llenando `sale.customer_id` en cada
 * venta con comprador. **Ninguna ruta de la web leía nada de eso**: tres rutas de servidor
 * y una columna con datos reales, sin una sola puerta.
 *
 * Es la tercera vez en este proyecto —los `DELETE` de sucursales y usuarios, el fiado, y
 * esto— así que el test no se queda en el componente: monta la pantalla y comprueba que
 * **llama a la ruta correcta y enseña lo que vuelve**. Un test que sólo montara los trozos
 * volvería a dejar pasar exactamente el mismo agujero.
 */

vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

const { api } = await import('@/lib/api');

const ROSA = {
  id: 'c1',
  name: 'Doña Rosa',
  phone: '77712345',
  notes: null,
  isActive: true,
  compras: 3,
  ultimaCompra: '2026-08-10T15:00:00.000Z',
};
const NUEVO = {
  id: 'c2',
  name: 'Recién llegado',
  phone: null,
  notes: null,
  isActive: true,
  compras: 0,
  ultimaCompra: null,
};

function conQuery(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return montar(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
  vi.mocked(api.del).mockReset();
});

describe('la lista', () => {
  it('pide los compradores y enseña cuántas compras lleva cada uno', async () => {
    vi.mocked(api.get).mockResolvedValue([ROSA, NUEVO]);
    conQuery(<CustomersPage />);

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/customers'));
    expect(await screen.findAllByText('Doña Rosa')).not.toHaveLength(0);
    // El que nunca compró sale igual: si desapareciera, quien acaba de darlo de alta
    // pensaría que no se guardó.
    expect(screen.getAllByText('Recién llegado')).not.toHaveLength(0);
  });

  it('el buscador filtra por nombre sin volver a preguntar al servidor', async () => {
    vi.mocked(api.get).mockResolvedValue([ROSA, NUEVO]);
    conQuery(<CustomersPage />);
    await screen.findAllByText('Doña Rosa');

    await userEvent.type(screen.getByPlaceholderText(/Buscar por nombre/), 'rosa');

    expect(screen.queryByText('Recién llegado')).toBeNull();
    expect(screen.getAllByText('Doña Rosa')).not.toHaveLength(0);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('cuando no hay ninguno explica que no hace falta registrar a nadie para vender', async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    conQuery(<CustomersPage />);
    expect(await screen.findByText(/Todavía no hay clientes/)).toBeTruthy();
    expect(screen.getByText(/No hace falta registrar a nadie/)).toBeTruthy();
  });
});

describe('el detalle, que es la razón de la pantalla', () => {
  it('al tocar un nombre pide SU detalle y enseña sus compras', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path === '/customers'
        ? [ROSA]
        : {
            ...ROSA,
            totalGastado: '450.00',
            compras: [
              {
                id: 'v1',
                receiptNumber: 42,
                total: '300.00',
                status: 'completed',
                paymentMethod: 'cash',
                locationName: 'Central',
                clientCreatedAt: '2026-08-10T15:00:00.000Z',
              },
              {
                id: 'v2',
                receiptNumber: 43,
                total: '150.00',
                status: 'cancelled',
                paymentMethod: 'cash',
                locationName: 'Norte',
                clientCreatedAt: '2026-08-09T15:00:00.000Z',
              },
            ],
          },
    );
    conQuery(<CustomersPage />);

    const nombres = await screen.findAllByText('Doña Rosa');
    await userEvent.click(nombres[0]!);

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/customers/c1'));
    expect(await screen.findByText('Recibo #42')).toBeTruthy();
    expect(screen.getByText('Bs. 450.00')).toBeTruthy();
    // La anulada se ve, marcada: es parte de lo que pasó con este comprador.
    expect(screen.getByText('Recibo #43')).toBeTruthy();
    expect(screen.getByText('Anulada')).toBeTruthy();
  });

  /**
   * La cuenta de arriba y el historial de abajo responden preguntas distintas.
   *
   * La pantalla contaba `compras.length` —la página que devuelve el servidor, cortada en
   * 50— y lo ponía al lado de un gasto calculado sobre todas. Un cliente de 137 compras
   * salía como «50 compras» con el dinero de las 137: el ticket medio parecía 2,7 veces el
   * real, y las dos cifras de la MISMA pantalla se contradecían con la tabla.
   */
  const conDetalle = (detalle: Record<string, unknown>) =>
    vi
      .mocked(api.get)
      .mockImplementation(async (path: string) =>
        path === '/customers' ? [ROSA] : { ...ROSA, ...detalle },
      );

  const UNA_COMPRA = {
    id: 'v1',
    receiptNumber: 42,
    total: '300.00',
    status: 'completed',
    paymentMethod: 'cash',
    locationName: 'Central',
    clientCreatedAt: '2026-08-10T15:00:00.000Z',
  };

  async function abrirDetalle() {
    conQuery(<CustomersPage />);
    const nombres = await screen.findAllByText('Doña Rosa');
    await userEvent.click(nombres[0]!);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/customers/c1'));
  }

  it('la cuenta de arriba es la del servidor, no la de las filas que caben', async () => {
    conDetalle({
      totalGastado: '4500.00',
      comprasCompletadas: 137,
      comprasRegistradas: 139,
      compras: Array.from({ length: 50 }, (_, i) => ({ ...UNA_COMPRA, id: `v${i}` })),
    });
    await abrirDetalle();

    expect(await screen.findByText('137 compras')).toBeTruthy();
    expect(screen.queryByText('50 compras'), 'volvió a contar las filas').toBeNull();
  });

  /*
    Y el corte se DICE. Sin esto, un recibo más antiguo que el 50.º simplemente no aparece
    y la pantalla no da ninguna pista de que exista — que es justo la pregunta para la que
    se hizo: "¿qué le vendí a este señor y cuándo?".
  */
  it('avisa de que el historial viene cortado, y de cuánto se queda fuera', async () => {
    conDetalle({
      totalGastado: '4500.00',
      comprasCompletadas: 137,
      comprasRegistradas: 139,
      compras: Array.from({ length: 50 }, (_, i) => ({ ...UNA_COMPRA, id: `v${i}` })),
    });
    await abrirDetalle();

    const aviso = await screen.findByText(/50 más recientes/);
    expect(aviso.textContent).toContain('139');
  });

  it('cuando caben todas no avisa de nada, que sería ruido', async () => {
    conDetalle({
      totalGastado: '300.00',
      comprasCompletadas: 1,
      comprasRegistradas: 1,
      compras: [UNA_COMPRA],
    });
    await abrirDetalle();

    expect(await screen.findByText('1 compra')).toBeTruthy();
    expect(screen.queryByText(/más recientes/)).toBeNull();
  });
});

describe('crear y editar', () => {
  it('el alta manda el nombre y el teléfono', async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    vi.mocked(api.post).mockResolvedValue({});
    conQuery(<CustomersPage />);

    await userEvent.click((await screen.findAllByRole('button', { name: /Nuevo/ }))[0]!);
    await userEvent.type(screen.getByPlaceholderText('Cómo lo llamas'), 'Don Julio');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/customers', {
        name: 'Don Julio',
        phone: null,
        notes: null,
      }),
    );
  });

  it('editar va por PATCH a ESE comprador, no por POST', async () => {
    vi.mocked(api.get).mockResolvedValue([ROSA]);
    vi.mocked(api.patch).mockResolvedValue({});
    conQuery(<CustomersPage />);

    await userEvent.click((await screen.findAllByLabelText('Editar Doña Rosa'))[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(vi.mocked(api.patch).mock.calls[0]![0]).toBe('/customers/c1');
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('eliminar', () => {
  it('con historial NO se elimina, y la pantalla enseña por qué', async () => {
    // El desenlace que se pierde si se trata el 200 como un simple "ok".
    vi.mocked(api.get).mockResolvedValue([ROSA]);
    vi.mocked(api.del).mockResolvedValue({
      eliminado: false,
      mensaje:
        'No se eliminó porque Doña Rosa tiene 3 compras registradas. Se desactivó en su lugar.',
      colgando: ['3 compras registradas'],
    });
    conQuery(<CustomersPage />);

    await userEvent.click((await screen.findAllByLabelText('Eliminar Doña Rosa'))[0]!);
    await userEvent.click(screen.getByRole('button', { name: /^Eliminar$/ }));

    await waitFor(() => expect(api.del).toHaveBeenCalledWith('/customers/c1'));
    expect(await screen.findByRole('heading', { name: 'Se desactivó en su lugar' })).toBeTruthy();
    // El motivo va en prosa y repetido en vertical; se comprueba la lista, que es lo que
    // se lee cuando cuelgan tres o cuatro cosas.
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '· 3 compras registradas',
    ]);
  });
});
