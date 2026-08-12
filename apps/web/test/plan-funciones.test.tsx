// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { montar, screen, waitFor } from './montar';

/**
 * Lo que ve alguien cuando su plan no incluye una parte de la pantalla.
 *
 * El fallo que esto impide se encontró recorriendo el producto entero en la instancia de
 * prueba, con un negocio recién registrado —o sea, plan Básico, que es lo que tendrá
 * cualquier cliente nuevo—: la pantalla de Reportes se quedaba a medias **sin decir nada**.
 *
 * Faltaban las cuatro cifras de arriba, la tendencia de 30 días, las ventas por ubicación,
 * el top de productos y las ventas por vendedor. Y el dueño no tenía forma de saber si le
 * faltaba algo, si estaba roto o si es que no había datos todavía.
 *
 * Se juntaban dos silencios, cada uno correcto por su cuenta:
 *
 * 1. Los widgets se pintan con `{dash && …}`, para no reventar mientras cargan.
 * 2. El manejador global de errores calla los 402 a propósito, para no llenar de errores
 *    la pantalla de un negocio bloqueado.
 *
 * Con el 402 del API por medio, el resultado era un hueco mudo. Ahora la consulta ni se
 * hace —`enabled`— y en su sitio va un aviso que dice qué falta y enlaza a los planes.
 */

vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return { ...real, api: { ...real.api, get: vi.fn(), put: vi.fn() } };
});

let funciones: string[] = [];
vi.mock('@/features/subscription/SubscriptionProvider', () => ({
  useSubscription: () => ({
    sub: { plan: { name: 'Básico', code: 'basico' } },
    loading: false,
    has: (f: string) => funciones.includes(f),
  }),
}));

const { api } = await import('@/lib/api');
const { ReportsPage } = await import('@/features/reports/ReportsPage');
const { DashboardPage } = await import('@/features/dashboard/DashboardPage');

/** Lo que devuelve `/reports/dashboard`, que es lo que el plan Básico no puede pedir. */
const PANEL = {
  today: { total: '167.00', count: 1, deltaPct: 12 },
  month: { total: '167.00', count: 1 },
  avgTicket: '167.00',
  projection: { value: '5000.00', low: '4000.00', high: '6000.00' },
  trend: [],
  byLocation: [{ name: 'Principal', total: '167.00', count: 1 }],
  topProducts: [],
  bySeller: [],
};
const RESUMEN = {
  byLocation: [
    {
      locationId: 'loc-1',
      locationName: 'Principal',
      today: '167.00',
      week: '167.00',
      month: '167.00',
      todayCount: 1,
      profitToday: '47.00',
      profitWeek: '47.00',
      profitMonth: '47.00',
      rangeTotal: '167.00',
      rangeCount: 1,
      rangeProfit: '47.00',
    },
  ],
  hasRange: true,
  totals: { today: '167.00', week: '167.00', month: '167.00', range: '167.00' },
  profit: { today: '47.00', week: '47.00', month: '47.00', range: '47.00' },
  rangeCount: 1,
};

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
    if (url.startsWith('/reports/dashboard')) return PANEL;
    if (url.startsWith('/reports/summary')) return RESUMEN;
    if (url.startsWith('/dashboard-config')) return null;
    return {};
  });
});

/** Las rutas que pidió la pantalla. */
const pedidas = () => vi.mocked(api.get).mock.calls.map((c) => String(c[0]));

describe('Reportes, con un plan que no incluye los gráficos', () => {
  beforeEach(() => {
    funciones = ['auditoria'];
  });

  it('lo DICE, en vez de dejar media pantalla en blanco', async () => {
    conQuery(<ReportsPage />);
    expect(await screen.findByText(/no entra en tu plan/)).toBeTruthy();
  });

  it('y lleva a los planes, que es lo único que puede hacer con eso', async () => {
    conQuery(<ReportsPage />);
    const enlace = await screen.findByRole('link', { name: /Ver los planes/ });
    expect(enlace.getAttribute('href')).toBe('/suscripcion');
  });

  /*
    Ni siquiera se pide: el API respondería 402 y el manejador global lo callaría. Una
    petición que se sabe rechazada de antemano sólo gasta batería en una tablet de tienda.
  */
  it('ni siquiera pide los datos que sabe que le van a negar', async () => {
    conQuery(<ReportsPage />);
    await waitFor(() => expect(pedidas().some((u) => u.startsWith('/reports/summary'))).toBe(true));
    expect(pedidas().some((u) => u.startsWith('/reports/dashboard'))).toBe(false);
  });

  it('lo que SÍ entra en su plan se sigue viendo', async () => {
    // El comparativo por ubicación viene de otra ruta y no depende del plan. Si esto
    // desapareciera, el arreglo habría escondido algo que la persona sí puede ver.
    conQuery(<ReportsPage />);
    expect(await screen.findByText(/En el rango seleccionado/)).toBeTruthy();
    // Con `findAll`, no `getAll`: la tarjeta se pinta con el estado local del filtro, o
    // sea ANTES de que lleguen los datos, y de entrada muestra Bs. 0.00.
    expect((await screen.findAllByText(/167/)).length).toBeGreaterThan(0);
  });
});

describe('Reportes, con el plan que sí los incluye', () => {
  beforeEach(() => {
    funciones = ['auditoria', 'reportes_avanzados'];
  });

  it('no sale ningún aviso de plan', async () => {
    conQuery(<ReportsPage />);
    await waitFor(() =>
      expect(pedidas().some((u) => u.startsWith('/reports/dashboard'))).toBe(true),
    );
    expect(screen.queryByText(/no entra en tu plan/)).toBeNull();
  });
});

/**
 * El Panel tiene la misma puerta, y por eso está aquí: el menú ya lo oculta sin la
 * función, pero la ruta se alcanza igual escribiéndola o desde un enlace guardado.
 * Ocultar una entrada del menú no es contestar a quien llega por otro camino.
 */
describe('el Panel, al que se llega por la URL sin tener el plan', () => {
  beforeEach(() => {
    funciones = ['auditoria'];
  });

  it('explica por qué está vacío, en vez de salir en blanco', async () => {
    conQuery(<DashboardPage />);
    expect(await screen.findByText(/no entra en tu plan/)).toBeTruthy();
    expect(pedidas().some((u) => u.startsWith('/reports/dashboard'))).toBe(false);
  });
});
