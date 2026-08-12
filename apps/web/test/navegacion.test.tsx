// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { montar, screen } from './montar';

/**
 * El menú de navegación: que los enlaces existan, apunten donde dicen y se marque el que
 * corresponde a la pantalla en la que estás.
 *
 * ## Por qué este archivo aparece al subir React Router
 *
 * `Layout` es la única pieza del proyecto que usa `NavLink` y su `className` como función
 * —`({ isActive }) => …`—, y **no la cubría ningún test**. Ahí no hay error de compilación
 * que valga: si el enrutador cambia de comportamiento, lo que sale es una barra lateral sin
 * enlaces o con todos marcados a la vez, y eso sólo se ve mirando.
 *
 * En esta rama una subida de versión ya rompió seis caminos que nadie probaba. La 6 → 7 se
 * hizo con las banderas `future` de la 7 puestas desde antes, así que la migración costó un
 * único error de tipos; este archivo es lo que impide que la próxima cueste más de lo que
 * se nota.
 *
 * Se monta con `MemoryRouter` y una ruta inicial: es la forma de preguntarle al enrutador
 * "estando en /productos, ¿qué enlace está activo?" sin navegador.
 */

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: usuario, logout: vi.fn() }),
}));
// Todas las funciones del plan disponibles: aquí se prueba la navegación, no el plan.
vi.mock('@/features/subscription/SubscriptionProvider', () => ({
  useSubscription: () => ({ has: () => true }),
}));
vi.mock('@/features/subscription/SubscriptionBanner', () => ({ SubscriptionBanner: () => null }));
vi.mock('@/features/auth/EmailVerifyBanner', () => ({ EmailVerifyBanner: () => null }));
vi.mock('@/components/SyncIndicator', () => ({ SyncIndicator: () => null }));
vi.mock('@/components/Marca', () => ({
  Marca: () => null,
  NombreDeMarca: () => <span>Llantería Central</span>,
}));
// El worker de sincronización abre Dexie y temporizadores: no pinta nada de lo que se mide.
vi.mock('@/offline/sync', () => ({ startSyncWorker: vi.fn() }));

const USUARIO = {
  sub: 'u1',
  businessId: 'b1',
  locationId: 'loc-1',
  isCentral: true,
  role: 'admin' as const,
  name: 'Ana Pérez',
  locationName: 'Sucursal Norte',
};
let usuario: Record<string, unknown> = { ...USUARIO };

const { Layout } = await import('@/components/Layout');

function montarEn(ruta: string) {
  // `AvisoDeError`, que vive dentro del marco, lee del cache de consultas: sin el
  // proveedor, montar el Layout revienta antes de pintar un solo enlace.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return montar(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[ruta]}>
        <Layout>
          <p>contenido de la pantalla</p>
        </Layout>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Los `href` de los enlaces del menú, sin repetir (el menú sale dos veces: lateral y móvil). */
function destinos(): string[] {
  return [
    ...new Set(
      screen
        .getAllByRole('link')
        .map((a) => a.getAttribute('href') ?? '')
        .filter(Boolean),
    ),
  ];
}

beforeEach(() => {
  usuario = { ...USUARIO };
});

describe('el menú', () => {
  it('pinta los enlaces operativos, que son los que usa todo el mundo', () => {
    montarEn('/');
    const d = destinos();
    for (const ruta of ['/', '/ventas', '/productos', '/inventario', '/caja']) {
      expect(d, `falta el enlace a ${ruta}`).toContain(ruta);
    }
  });

  it('un admin ve además Análisis y Administración', () => {
    montarEn('/');
    const d = destinos();
    for (const ruta of ['/panel', '/reportes', '/caja/z', '/ubicaciones', '/usuarios']) {
      expect(d, `falta el enlace a ${ruta}`).toContain(ruta);
    }
  });

  it('el contenido de la pantalla sigue pintándose dentro', () => {
    // Un fallo del enrutador deja el marco en pie y el contenido fuera; se ve en blanco.
    montarEn('/productos');
    expect(screen.getByText('contenido de la pantalla')).toBeTruthy();
  });
});

/**
 * En qué sucursal estamos.
 *
 * Pedido tras probar el sistema con dos locales: la aplicación no lo decía en ninguna
 * parte. Y no es un adorno — el stock que se mira, la caja que se abre y la venta que se
 * cobra son de UNA sucursal; sin saber cuál, los tres números pueden leerse mal.
 */
describe('la sucursal en la que se trabaja', () => {
  it('se ve en la barra de arriba', () => {
    montarEn('/');
    expect(screen.getByText('Sucursal Norte')).toBeTruthy();
  });

  it('quien no tiene ubicación asignada no ve una inventada', () => {
    usuario = { ...USUARIO, locationName: null };
    montarEn('/');
    expect(screen.queryByText('Sucursal Norte')).toBeNull();
  });
});

/**
 * `aria-current="page"` es lo que `NavLink` pone en el enlace activo, y es también lo que
 * un lector de pantalla anuncia. Que sea UNO y el correcto es la parte que se rompe sin
 * hacer ruido.
 */
describe('qué enlace se marca como activo', () => {
  const activos = () =>
    screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('aria-current') === 'page')
      .map((a) => a.getAttribute('href'));

  it('estando en Productos, se marca Productos', () => {
    montarEn('/productos');
    expect(new Set(activos())).toEqual(new Set(['/productos']));
  });

  /*
    Ojo con este: es el que NO distingue, y quedó escrito por qué.

    La entrada "Vender" apunta a "/" y lleva `end`. En React Router 6 eso era
    imprescindible —un `NavLink to="/"` sin `end` se marcaba en TODAS las pantallas,
    porque toda ruta empieza por "/"—, pero **en la 7 ya no**: la raíz sin `end` tampoco
    se marca en las subrutas. Comprobado al subir de versión, quitando el `end` a mano y
    viendo que este caso seguía pasando.

    Se queda porque el comportamiento sigue siendo el que se quiere y alguien tiene que
    vigilarlo; lo que no hace es defender el `end`, y decir lo contrario sería el mismo
    comentario que ya mintió dos veces en esta rama. Quien defiende `end` es el de abajo.
  */
  it('estando en Ventas NO se marca también Vender', () => {
    montarEn('/ventas');
    const marcados = activos();
    expect(marcados).toContain('/ventas');
    expect(marcados, '"/" se marcó estando en otra pantalla').not.toContain('/');
  });

  /*
    Éste SÍ depende del `end` de `/caja`, y por eso es el que vigila de verdad: la lectura
    Z cuelga de esa ruta —`/caja/z` empieza por `/caja`— pero es otra pantalla. Sin `end`
    se marcan las dos entradas a la vez, y eso sigue siendo cierto en la 7. Verificado
    quitándolo: este caso falla, el de arriba no.
  */
  it('estando en la lectura Z no se marca también Caja', () => {
    montarEn('/caja/z');
    const marcados = activos();
    expect(marcados).toContain('/caja/z');
    expect(marcados).not.toContain('/caja');
  });

  it('en la raíz sí se marca Vender', () => {
    montarEn('/');
    expect(activos()).toContain('/');
  });
});
