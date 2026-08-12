// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { TERMS_VERSION_MATERIAL } from '@ventafacil/shared';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { montar, screen, userEvent, waitFor } from './montar';

/**
 * El aviso de que los términos cambiaron.
 *
 * Los términos prometen por escrito: «Podemos cambiar estas condiciones. Si el cambio es
 * importante, te avisaremos con antelación razonable; seguir usando el servicio después
 * implica aceptarlas». No se avisaba de nada — `TERMS_VERSION` se guardaba al registrarse
 * y no se comparaba con nada—, así que esa cláusula se apoyaba en un aviso inexistente.
 *
 * Se prueba el componente Y que el marco lo monte. Es la tercera vez que en este proyecto
 * aparece código impecable al que ninguna pantalla llama —el fiado, los `DELETE` de
 * sucursales, la pantalla de Clientes—, y un aviso legal que nadie ve es exactamente el
 * mismo agujero con peores consecuencias.
 */

vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return { ...real, api: { ...real.api, post: vi.fn(), get: vi.fn() } };
});

const USUARIO = {
  sub: 'u1',
  businessId: 'b1',
  locationId: null,
  isCentral: true,
  role: 'admin' as const,
  name: 'Ana Pérez',
};
let usuario: Record<string, unknown> | null = { ...USUARIO };
let negocio: Record<string, unknown> | null = { id: 'b1', termsVersion: '2026-01-01' };

vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ user: usuario }) }));
vi.mock('@/theme/ThemeProvider', () => ({ useBusiness: () => negocio }));

const { api } = await import('@/lib/api');
const { AvisoDeTerminos } = await import('@/features/legal/AvisoDeTerminos');

function montarAviso(ui: ReactNode = <AvisoDeTerminos />) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return montar(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  usuario = { ...USUARIO };
  negocio = { id: 'b1', termsVersion: '2026-01-01' };
  vi.mocked(api.post).mockReset();
  vi.mocked(api.post).mockResolvedValue({} as never);
});

describe('cuándo sale el aviso', () => {
  it('sale si el negocio aceptó una versión anterior a la última importante', () => {
    montarAviso();
    expect(screen.getByText(/Actualizamos los términos/)).toBeTruthy();
    // Y con la puerta abierta para leerlos, que es lo que el aviso pide de verdad.
    expect(screen.getByRole('link', { name: /Leerlos/ }).getAttribute('href')).toBe('/terminos');
  });

  it('no sale si ya aceptó la versión importante vigente', () => {
    negocio = { id: 'b1', termsVersion: TERMS_VERSION_MATERIAL };
    const { container } = montarAviso();
    expect(container.textContent).toBe('');
  });

  it('sale si no consta ninguna aceptación', () => {
    // Los negocios creados por CLI no aceptaron términos por nadie.
    negocio = { id: 'b1', termsVersion: null };
    montarAviso();
    expect(screen.getByText(/Actualizamos los términos/)).toBeTruthy();
  });

  it('mientras el negocio no ha cargado no se enseña nada', () => {
    // Un aviso que aparece y se va medio segundo después es peor que uno que tarda.
    negocio = null;
    const { container } = montarAviso();
    expect(container.textContent).toBe('');
  });
});

/*
  Quién puede aceptar: sólo el admin de la central, que es quien aceptó al registrarse y
  quien responde por el negocio. A los demás ni se les enseña — un aviso legal en el
  mostrador sólo estorba a quien está cobrando, y encima no podría hacer nada con él: el
  API le responde 403.
*/
describe('quién lo ve', () => {
  it('un vendedor no lo ve', () => {
    usuario = { ...USUARIO, role: 'vendedor' };
    const { container } = montarAviso();
    expect(container.textContent).toBe('');
  });

  it('un administrador de sucursal tampoco: no compromete al negocio', () => {
    usuario = { ...USUARIO, isCentral: false };
    const { container } = montarAviso();
    expect(container.textContent).toBe('');
  });
});

describe('aceptar', () => {
  it('«Entendido» registra la aceptación en el servidor', async () => {
    montarAviso();
    await userEvent.click(screen.getByRole('button', { name: 'Entendido' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/business/terms'));
  });

  /*
    Sin esto el aviso sería decorativo: dentro de un año seguiría sin haber forma de saber
    qué versión aceptó cada negocio, que es justo para lo que existe la constante.
  */
  it('si el servidor falla lo dice, en vez de aparentar que se guardó', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('sin red'));
    montarAviso();
    await userEvent.click(screen.getByRole('button', { name: 'Entendido' }));

    expect(await screen.findByText(/No se pudo guardar/)).toBeTruthy();
    // Y el aviso sigue ahí: no se puede dar por aceptado lo que no se guardó.
    expect(screen.getByText(/Actualizamos los términos/)).toBeTruthy();
  });
});

/**
 * Y que el MARCO lo monte, que es la mitad que ya se olvidó tres veces en este proyecto.
 *
 * Se comprueba sobre el `Layout` de verdad: si alguien lo quita de ahí, el componente
 * seguiría impecable y sus tests en verde, y nadie volvería a ver el aviso nunca.
 */
describe('el marco lo enseña', () => {
  it('el Layout monta el aviso', async () => {
    vi.doMock('@/features/subscription/SubscriptionProvider', () => ({
      useSubscription: () => ({ has: () => true }),
    }));
    vi.doMock('@/features/subscription/SubscriptionBanner', () => ({
      SubscriptionBanner: () => null,
    }));
    vi.doMock('@/features/auth/EmailVerifyBanner', () => ({ EmailVerifyBanner: () => null }));
    vi.doMock('@/components/SyncIndicator', () => ({ SyncIndicator: () => null }));
    vi.doMock('@/components/Marca', () => ({ Marca: () => null, NombreDeMarca: () => null }));
    vi.doMock('@/offline/sync', () => ({ startSyncWorker: vi.fn() }));
    const { Layout } = await import('@/components/Layout');

    montarAviso(
      <Layout>
        <p>pantalla</p>
      </Layout>,
    );
    expect(screen.getByText(/Actualizamos los términos/)).toBeTruthy();
  });
});
