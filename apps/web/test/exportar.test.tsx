// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { montar, screen, userEvent, waitFor } from './montar';
import { Exportar } from '@/components/Exportar';

/**
 * Los dos botones de exportar.
 *
 * El módulo del PDF se prueba aparte y a fondo; lo que se comprueba aquí es lo otro, que
 * es donde este proyecto ya se ha equivocado tres veces: que **alguien llame** a ese
 * módulo. Un generador impecable al que ninguna pantalla invoca es exactamente el fiado,
 * los `DELETE` de sucursales y la pantalla de Clientes que no existía.
 *
 * `construirPdf` va simulado —armar PDFs de verdad en cada caso son segundos por test—
 * pero el tope, el aviso y los datos que se le pasan son los de verdad.
 */

vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return { ...real, api: { ...real.api, get: vi.fn() } };
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
let usuario: typeof USUARIO | (Omit<typeof USUARIO, 'role'> & { role: 'vendedor' }) = USUARIO;

vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ user: usuario }) }));
vi.mock('@/theme/ThemeProvider', () => ({
  useMarca: () => ({ name: 'Llantería Central', logoUrl: 'data:image/png;base64,AAA' }),
}));

const { api } = await import('@/lib/api');
// `lineaDeFiltros` es el de verdad —sólo `construirPdf` va simulado—: lo que se comprueba
// es el texto que se imprime, no una copia suya escrita a mano en el test.
const { construirPdf, avisoDeTamano, lineaDeFiltros } = await import('@/lib/pdf');

const VENTA = { Recibo: 'R-1', Fecha: '2026-08-11T14:00:00.000Z', Total: '120.50' };
const responde = (filas: unknown[]) =>
  vi.mocked(api.get).mockResolvedValue({ seccion: 'ventas', filas } as never);

/** Lo que se pulsó para descargar: el `<a>` que el componente crea y clica. */
let descargas: string[] = [];

beforeEach(() => {
  usuario = USUARIO;
  descargas = [];
  vi.mocked(api.get).mockReset();
  vi.mocked(construirPdf).mockClear();
  // jsdom no implementa ninguna de las dos.
  URL.createObjectURL = vi.fn(() => 'blob:falso');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    descargas.push(this.download);
  });
});

describe('quién ve los botones', () => {
  it('el admin de la central ve los dos', () => {
    montar(<Exportar seccion="ventas" />);
    expect(screen.getByRole('button', { name: /Excel/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /PDF/ })).toBeTruthy();
  });

  it('un vendedor no ve ninguno, en vez de uno que siempre diría que no', () => {
    usuario = { ...USUARIO, role: 'vendedor' };
    const { container } = montar(<Exportar seccion="ventas" />);
    expect(container.textContent).toBe('');
  });
});

describe('el botón de PDF', () => {
  it('pide las filas con los mismos filtros de la pantalla y genera el archivo', async () => {
    responde([VENTA]);
    montar(
      <Exportar
        seccion="ventas"
        filtros={{ from: '2026-08-01', to: '2026-08-31', locationId: 'loc-1' }}
        alcance="Sucursal Norte"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /PDF/ }));

    await waitFor(() => expect(construirPdf).toHaveBeenCalled());
    expect(vi.mocked(api.get).mock.calls[0]![0]).toBe(
      '/export/ventas?from=2026-08-01&to=2026-08-31&locationId=loc-1',
    );

    const datos = vi.mocked(construirPdf).mock.calls[0]![0];
    expect(datos.negocio).toBe('Llantería Central');
    expect(datos.generadoPor).toBe('Ana Pérez');
    expect(datos.logoUrl).toBe('data:image/png;base64,AAA');
    expect(datos.alcance).toBe('Sucursal Norte');
    expect(datos.alcanceSinNombre).toBe(false);
    expect(datos.filas).toEqual([VENTA]);
  });

  it('descarga el archivo con la sección y la fecha en el nombre', async () => {
    responde([VENTA]);
    montar(<Exportar seccion="ventas" />);
    await userEvent.click(screen.getByRole('button', { name: /PDF/ }));
    await waitFor(() => expect(descargas).toHaveLength(1));
    expect(descargas[0]).toMatch(/^ventas-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  /**
   * Y esa fecha es la del NEGOCIO, no la de UTC.
   *
   * A las 21:00 del 11 de agosto en Bolivia ya es el 12 en UTC, así que el archivo se
   * guardaba como `ventas-2026-08-12.pdf` con una hoja que decía «Generado … 11/8/26,
   * 9:00 p. m.». Estos papeles se archivan: la carpeta y el papel no pueden discrepar sobre
   * qué día se hizo.
   *
   * Con el reloj congelado en esa franja de cuatro horas, que es la única en la que las dos
   * zonas dan días distintos — sin fijarlo, el test pasaría 20 de cada 24 horas sin probar
   * nada.
   */
  it('la fecha del nombre es la del negocio, aunque en UTC ya sea otro día', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-12T01:00:00Z'));
    try {
      responde([VENTA]);
      montar(<Exportar seccion="ventas" />);
      await userEvent.click(screen.getByRole('button', { name: /PDF/ }));
      await waitFor(() => expect(descargas).toHaveLength(1));
      expect(descargas[0]).toBe('ventas-2026-08-11.pdf');
    } finally {
      vi.useRealTimers();
    }
  });

  /*
    Filtrado por sucursal y sin nombre: el componente lo DICE.

    Es el caso que deja un papel pareciendo de todo el negocio cuando es de un solo local.
    La pantalla que olvide pasar `alcance` no puede provocar eso en silencio.
  */
  it('marca que hay sucursal filtrada aunque la pantalla no pase su nombre', async () => {
    responde([VENTA]);
    montar(<Exportar seccion="ventas" filtros={{ locationId: 'loc-1' }} />);
    await userEvent.click(screen.getByRole('button', { name: /PDF/ }));
    await waitFor(() => expect(construirPdf).toHaveBeenCalled());
    expect(vi.mocked(construirPdf).mock.calls[0]![0].alcanceSinNombre).toBe(true);
  });

  /*
    Los filtros que no son de fecha, en sus DOS mitades.

    El fallo que esto impide: la pantalla de Ventas filtrada a «Anuladas» pedía al servidor
    todas las ventas del rango y las imprimía bajo un título que decía «del 1 al 31 de
    agosto» sin más. Las dos mitades tienen que estar — que el filtro VIAJE al API, y que
    el papel lo DIGA — porque cada una tapa el fallo de la otra: si sólo viaja, el papel
    trae las anuladas sin decir que lo son; si sólo se escribe, el papel dice «Anulada» con
    todas las ventas dentro, que es peor.
  */
  it('manda los filtros de la pantalla al API y los escribe en el papel', async () => {
    responde([VENTA]);
    montar(
      <Exportar
        seccion="ventas"
        filtros={{ from: '2026-08-01', to: '2026-08-31', status: 'cancelled' }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /PDF/ }));
    await waitFor(() => expect(construirPdf).toHaveBeenCalled());

    expect(vi.mocked(api.get).mock.calls[0]![0]).toContain('status=cancelled');
    // Y llega hasta la línea que se imprime bajo el título, que es lo que alguien firma.
    const datos = vi.mocked(construirPdf).mock.calls[0]![0];
    expect(lineaDeFiltros(datos)).toBe('Anulada · del 1 al 31 de agosto de 2026');
  });

  it('el nombre del usuario que filtra la actividad llega al papel, y no su uuid', async () => {
    responde([VENTA]);
    montar(
      <Exportar
        seccion="actividad"
        filtros={{ userId: 'u-9', action: 'price_change' }}
        etiquetas={{ userId: 'Ana Pérez' }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /PDF/ }));
    await waitFor(() => expect(construirPdf).toHaveBeenCalled());

    const linea = lineaDeFiltros(vi.mocked(construirPdf).mock.calls[0]![0]);
    expect(linea).toBe('Cambio de precio · por Ana Pérez');
    expect(linea).not.toContain('u-9');
  });

  /*
    El tope avisa y NO genera. Las dos mitades importan: si generara igual, saldrían 200
    páginas; si sólo callara, no habría forma de saber por qué no pasó nada.
  */
  it('por encima del tope avisa del tamaño y no genera nada', async () => {
    responde(Array.from({ length: 8320 }, () => VENTA));
    montar(<Exportar seccion="ventas" />);
    await userEvent.click(screen.getByRole('button', { name: /PDF/ }));

    // Se compara con el aviso de verdad, no con una cifra copiada: cuántas filas entran
    // en una hoja se decide en `pdf.ts` y ya cambió una vez (eran 40, son 25). Lo que este
    // test defiende es que el aviso LLEGA a la pantalla, entero.
    const aviso = await screen.findByText(/8\.320 filas/);
    expect(aviso.textContent).toBe(avisoDeTamano(8320));
    expect(aviso.textContent).toContain('usa Excel');
    expect(construirPdf).not.toHaveBeenCalled();
    expect(descargas).toHaveLength(0);
  });

  it('sin filas lo dice y no baja un papel en blanco', async () => {
    responde([]);
    montar(<Exportar seccion="ventas" />);
    await userEvent.click(screen.getByRole('button', { name: /PDF/ }));

    await waitFor(() => expect(screen.getByText(/No hay nada que exportar/)).toBeTruthy());
    expect(construirPdf).not.toHaveBeenCalled();
    expect(descargas).toHaveLength(0);
  });

  it('si el API falla lo dice y no deja el botón colgado en "Preparando…"', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('sin red'));
    montar(<Exportar seccion="ventas" />);
    await userEvent.click(screen.getByRole('button', { name: /PDF/ }));

    await waitFor(() => expect(screen.getByText(/No se pudo exportar/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /PDF/ }).hasAttribute('disabled')).toBe(false);
  });
});

describe('el botón de Excel', () => {
  it('sigue bajando su .xlsx, y sin tope', async () => {
    responde(Array.from({ length: 8320 }, () => VENTA));
    montar(<Exportar seccion="ventas" />);
    await userEvent.click(screen.getByRole('button', { name: /Excel/ }));
    await waitFor(() => expect(descargas).toHaveLength(1), { timeout: 15_000 });
    expect(descargas[0]).toMatch(/^ventas-\d{4}-\d{2}-\d{2}\.xlsx$/);
  }, 20_000);
});
