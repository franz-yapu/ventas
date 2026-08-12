// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SALE_STATUS_LABELS } from '@ventafacil/shared';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { montar, screen, userEvent, waitFor } from './montar';

/**
 * Cómo se llama en la pantalla una venta que se anuló.
 *
 * Había TRES vocabularios para lo mismo, y nadie lo notaba hasta comparar la pantalla con
 * el papel:
 *
 * - la pantalla de Ventas decía «Cancelada» (texto suelto en el JSX),
 * - el recibo impreso dice «*** ANULADO ***»,
 * - y `SALE_STATUS_LABELS` —que es lo que sale en el Excel, en el PDF y en la línea de
 *   filtros del informe— dice «Anulada».
 *
 * Se unificó en ANULAR, que es lo que ya usaban el papel y la bitácora (`AUDIT_ACTION_LABELS
 * .cancel` = «Anulación»), y que además evita la colisión con el otro «Cancelar» de la
 * interfaz: el de cerrar un diálogo sin hacer nada. Una venta se anula; un diálogo se
 * cancela.
 *
 * ⚠️ «Cancelada» sigue siendo correcto para las SUSCRIPCIONES (`PlatformPage`,
 * `SubscriptionPage`): una suscripción sí se cancela. Son dos cosas distintas y conviene
 * que se llamen distinto.
 *
 * Este test monta la pantalla y compara contra el rótulo COMPARTIDO, no contra una cadena
 * copiada: si alguien vuelve a escribir el texto a mano, o cambia el rótulo en
 * `@ventafacil/shared` sin mirar aquí, se entera.
 */

vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

const USUARIO = {
  sub: 'u1',
  businessId: 'b1',
  locationId: 'loc-1',
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
const { SalesPage } = await import('@/features/sales/SalesPage');

const ANULADA = {
  id: 'v1',
  receiptNumber: 2,
  clientCreatedAt: '2026-08-10T15:00:00.000Z',
  locationName: 'Caranavi',
  sellerName: 'Ana Pérez',
  customerName: 'Doña Rosa',
  paymentMethod: 'cash',
  total: '320.00',
  status: 'cancelled',
};
const COMPLETADA = { ...ANULADA, id: 'v2', receiptNumber: 3, status: 'completed' };

function conQuery(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return montar(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url.startsWith('/locations')) return [{ id: 'loc-1', name: 'Caranavi', isCentral: true }];
    return { items: [ANULADA, COMPLETADA], total: 2, page: 1, limit: 30, sumTotal: '320.00' };
  });
});

describe('el estado de una venta en la pantalla', () => {
  it('usa el mismo rótulo que el Excel y el PDF', async () => {
    conQuery(<SalesPage />);
    // Sale dos veces —tabla de escritorio y tarjetas de móvil—, y las dos tienen que decirlo.
    await waitFor(() =>
      expect(screen.getAllByText(SALE_STATUS_LABELS.cancelled).length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(SALE_STATUS_LABELS.completed).length).toBeGreaterThan(0);
  });

  it('ya no queda ningún «Cancelada» suelto para una venta', async () => {
    // El literal que estaba escrito a mano en el JSX. Si vuelve, aquí se ve.
    conQuery(<SalesPage />);
    // Se espera a que la tabla esté pintada: comprobar la ausencia de un texto sobre una
    // pantalla que aún no ha cargado pasa siempre, y no probaría nada.
    await waitFor(() => expect(screen.getAllByText(/#\d+/).length).toBeGreaterThan(0));
    expect(screen.queryAllByText('Cancelada')).toHaveLength(0);
  });

  it('el filtro de estado ofrece los mismos rótulos', async () => {
    conQuery(<SalesPage />);
    const filtro = await screen.findByDisplayValue('Todos los estados');
    const opciones = Array.from(filtro.querySelectorAll('option')).map((o) => o.textContent);
    expect(opciones).toContain(SALE_STATUS_LABELS.cancelled);
    expect(opciones).toContain(SALE_STATUS_LABELS.completed);
  });

  /*
    Y la ACCIÓN se llama como el estado que produce. Decir «Cancelar» en el botón y
    «Anulada» en la fila resultante obliga a deducir que son lo mismo — y encima choca con
    el otro «Cancelar» de la interfaz, el de cerrar un diálogo sin hacer nada.
  */
  it('la acción se llama anular, no cancelar', async () => {
    conQuery(<SalesPage />);
    await waitFor(() => expect(screen.getAllByTitle('Anular').length).toBeGreaterThan(0));
    expect(screen.queryAllByTitle('Cancelar')).toHaveLength(0);
  });

  /*
    Y el diálogo entero, que es donde vivía el resto del vocabulario viejo: se titulaba
    «Cancelar venta» y su botón decía «Confirmar cancelación». Va aquí porque es lo único
    de este arreglo que no se puede mirar en una captura — hay que abrirlo.
  */
  it('el diálogo de anular habla de anular, de principio a fin', async () => {
    conQuery(<SalesPage />);
    const botones = await screen.findAllByTitle('Anular');
    await userEvent.click(botones[0]!);

    expect(await screen.findByRole('heading', { name: 'Anular venta' })).toBeTruthy();
    expect(screen.getByText(/queda marcada como anulada/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirmar anulación' })).toBeTruthy();
    // El «Cancelar» que queda en la interfaz es el de cerrar sin hacer nada, y ése está
    // bien: una venta se anula, un diálogo se cancela.
    expect(screen.queryByText(/cancelación/)).toBeNull();
  });
});
