// @vitest-environment jsdom
import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { montar, screen, userEvent, waitFor } from './montar';

/**
 * El tour guiado: cuándo sale, qué enseña a cada quien y cómo se apaga.
 *
 * Lo que de verdad se está protegiendo aquí es la promesa que se le hace al cliente:
 * **si lo cierras, no vuelve a salir**. Un tour que reaparece es peor que ninguno —es la
 * clase de cosa por la que la gente llama enfadada—, así que ese camino se prueba entero:
 * cerrarlo en el PRIMER paso, comprobar que se avisa al servidor y que no se reabre.
 *
 * Y se prueba el filtrado por permisos, que no es cosmético: sin él el tour llevaría a un
 * vendedor a pantallas que su rol no puede abrir, la ruta lo devolvería al inicio y el
 * recorrido se quedaría dando tumbos.
 */

/*
  Como el de verdad: apaga el aviso en memoria ANTES de hablar con el servidor, para que
  el recuadro desaparezca en el acto. Que el doble haga esto importa — si no lo hiciera,
  los tests de abajo no estarían probando el mismo camino que corre en el navegador.
*/
const marcarTourVisto = vi.fn(async () => {
  usuario.mostrarTour = false;
});
let usuario: {
  role: 'admin' | 'seller';
  isCentral: boolean;
  mostrarTour: boolean;
} = { role: 'admin', isCentral: true, mostrarTour: true };
let planTiene = true;

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { sub: 'u1', businessId: 'b1', locationId: 'loc-1', name: 'Ana', ...usuario },
    marcarTourVisto,
  }),
}));
vi.mock('@/features/subscription/SubscriptionProvider', () => ({
  useSubscription: () => ({ has: () => planTiene }),
}));

const { MemoryRouter } = await import('react-router-dom');
const { TourProvider } = await import('@/features/tour/TourProvider');
const { BotonAyuda } = await import('@/features/tour/BotonAyuda');
const { PASOS, pasosPara } = await import('@/features/tour/pasos');

// jsdom no implementa scrollIntoView, y el tour lo llama al enfocar un elemento.
window.HTMLElement.prototype.scrollIntoView = vi.fn();

function conRouter(ui: ReactNode) {
  return montar(<MemoryRouter initialEntries={['/']}>{ui}</MemoryRouter>);
}

const tarjeta = () => screen.queryByTestId('tour-tarjeta');

/**
 * Da a un elemento un tamaño de verdad.
 *
 * jsdom no maqueta: `getBoundingClientRect` devuelve ceros para TODO, esté visible o no.
 * Sin esto no se puede distinguir «está en pantalla» de «está oculto», que es justo lo
 * que decide si el tour lo señala.
 */
function medirComo(el: Element, r: { top: number; left: number; width: number; height: number }) {
  el.getBoundingClientRect = () =>
    ({
      ...r,
      bottom: r.top + r.height,
      right: r.left + r.width,
      x: r.left,
      y: r.top,
      toJSON: () => r,
    }) as DOMRect;
}

/**
 * Envoltorio con un botón que redibuja al PROVEEDOR, para simular que la sesión se
 * releyó.
 *
 * El botón va por FUERA de `TourProvider` a propósito, y costó una mutación descubrirlo:
 * puesto dentro, su estado sólo redibuja al propio botón —el proveedor es su padre y ni
 * se entera—, así que el test pasaba igual con la guarda quitada. Un test que no puede
 * fallar no está probando nada.
 */
function ConRedibujado({ children }: { children: ReactNode }) {
  const [n, set] = useState(0);
  return (
    <>
      <button data-n={n} onClick={() => set((x) => x + 1)}>
        redibujar
      </button>
      <TourProvider>{children}</TourProvider>
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  usuario = { role: 'admin', isCentral: true, mostrarTour: true };
  planTiene = true;
});

describe('a quién se le enseña qué', () => {
  const quien = (role: 'admin' | 'seller', isCentral = true, tiene = true) =>
    pasosPara({ role, isCentral, tiene: () => tiene });

  it('un vendedor no ve los pasos de administración', () => {
    const ids = quien('seller').map((p) => p.id);
    expect(ids).toContain('vender');
    expect(ids).toContain('caja');
    expect(ids).not.toContain('usuarios');
    expect(ids).not.toContain('reportes');
  });

  it('una sucursal que no es la central no ve lo que el API le cierra', () => {
    const ids = quien('admin', false).map((p) => p.id);
    expect(ids).toContain('usuarios'); // esto sí lo conserva
    expect(ids).not.toContain('ubicaciones');
    expect(ids).not.toContain('configuracion');
  });

  it('sin la función en el plan, su paso no se enseña', () => {
    const ids = quien('admin', true, false).map((p) => p.id);
    expect(ids).not.toContain('panel');
    expect(ids).not.toContain('actividad');
  });

  it('a nadie se le queda el recorrido vacío', () => {
    expect(quien('seller', false, false).length).toBeGreaterThan(3);
  });

  it('cada paso dice a qué pantalla va y tiene texto', () => {
    for (const p of PASOS) {
      expect(p.ruta.startsWith('/')).toBe(true);
      expect(p.titulo.length).toBeGreaterThan(3);
      expect(p.texto.length).toBeGreaterThan(20);
    }
  });

  it('los identificadores no se repiten', () => {
    expect(new Set(PASOS.map((p) => p.id)).size).toBe(PASOS.length);
  });
});

describe('cuándo sale solo', () => {
  it('sale si el servidor dice que toca', async () => {
    conRouter(<TourProvider>{null}</TourProvider>);
    await waitFor(() => expect(tarjeta()).not.toBeNull());
    expect(screen.getByText('Aquí se cobra')).toBeTruthy();
  });

  it('NO sale si el servidor dice que ya no', async () => {
    usuario.mostrarTour = false;
    conRouter(<TourProvider>{null}</TourProvider>);
    // Se espera un poco para no dar por bueno un "no está" que sólo era "todavía no".
    await new Promise((r) => setTimeout(r, 50));
    expect(tarjeta()).toBeNull();
  });

  it('el botón de Ayuda lo abre aunque ya estuviera apagado', async () => {
    usuario.mostrarTour = false;
    conRouter(
      <TourProvider>
        <BotonAyuda />
      </TourProvider>,
    );
    expect(tarjeta()).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Ayuda/i }));

    await waitFor(() => expect(tarjeta()).not.toBeNull());
  });
});

describe('cerrarlo lo apaga para siempre', () => {
  it('«No mostrar más» en el PRIMER paso lo apaga y avisa al servidor', async () => {
    conRouter(<TourProvider>{null}</TourProvider>);
    await waitFor(() => expect(tarjeta()).not.toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'No mostrar más' }));

    expect(tarjeta()).toBeNull();
    expect(marcarTourVisto).toHaveBeenCalledTimes(1);
  });

  it('la X hace exactamente lo mismo', async () => {
    conRouter(<TourProvider>{null}</TourProvider>);
    await waitFor(() => expect(tarjeta()).not.toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar el tour' }));

    expect(tarjeta()).toBeNull();
    expect(marcarTourVisto).toHaveBeenCalledTimes(1);
  });

  it('no se reabre solo después de cerrarlo', async () => {
    conRouter(<TourProvider>{null}</TourProvider>);
    await waitFor(() => expect(tarjeta()).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'No mostrar más' }));

    await new Promise((r) => setTimeout(r, 80));
    expect(tarjeta()).toBeNull();
  });

  it('no reaparece aunque el servidor vuelva a decir que sí', async () => {
    /*
      El caso que de verdad rompería la promesa, y que pasa sin red: el aviso al servidor
      se pierde, y más tarde algo relee `/auth/me` —confirmar el correo, guardar el
      perfil— y trae `mostrarTour: true` otra vez. Sin la marca de «ya ofrecido» en esta
      carga, el tour reaparecería encima de alguien que ya lo cerró.
    */
    conRouter(<ConRedibujado>{null}</ConRedibujado>);
    await waitFor(() => expect(tarjeta()).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'No mostrar más' }));
    expect(tarjeta()).toBeNull();

    usuario.mostrarTour = true; // lo que devolvería /auth/me si el aviso no llegó
    await userEvent.click(screen.getByRole('button', { name: 'redibujar' }));

    await new Promise((r) => setTimeout(r, 80));
    expect(tarjeta()).toBeNull();
  });
});

describe('moverse por el recorrido', () => {
  it('avanza, retrocede y cuenta por dónde va', async () => {
    conRouter(<TourProvider>{null}</TourProvider>);
    await waitFor(() => expect(tarjeta()).not.toBeNull());
    const total = pasosPara({ role: 'admin', isCentral: true, tiene: () => true }).length;

    expect(screen.getByText(`1 de ${total}`)).toBeTruthy();
    // En el primero no hay "Atrás": no hay a dónde volver.
    expect(screen.queryByRole('button', { name: 'Atrás' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText(`2 de ${total}`)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Atrás' }));
    expect(screen.getByText(`1 de ${total}`)).toBeTruthy();
  });

  it('el último paso cierra con «Listo», no con «Siguiente»', async () => {
    // Un vendedor tiene el recorrido más corto: se llega al final sin dar cien clics.
    usuario = { role: 'seller', isCentral: false, mostrarTour: true };
    planTiene = false;
    const total = pasosPara({ role: 'seller', isCentral: false, tiene: () => false }).length;
    conRouter(<TourProvider>{null}</TourProvider>);
    await waitFor(() => expect(tarjeta()).not.toBeNull());

    for (let i = 1; i < total; i++) {
      await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    }

    expect(screen.getByText(`${total} de ${total}`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Siguiente' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Listo' }));
    expect(tarjeta()).toBeNull();
    expect(marcarTourVisto).toHaveBeenCalledTimes(1);
  });
});

describe('cuando el elemento a señalar no está', () => {
  it('el paso se enseña igual, centrado, en vez de romperse', async () => {
    // Ningún `data-tour` existe en este árbol: es lo que pasa en un móvil, donde media
    // interfaz no se dibuja, o mientras la pantalla todavía carga su lista.
    conRouter(<TourProvider>{null}</TourProvider>);
    await waitFor(() => expect(tarjeta()).not.toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    // El segundo paso tiene ancla (`pos-buscar`) y aquí no hay ninguna.
    expect(screen.getByText('Busca por nombre o por código')).toBeTruthy();
    expect(screen.queryByTestId('tour-foco')).toBeNull();
  });

  it('lo señala cuando sí está', async () => {
    conRouter(
      <TourProvider>
        <input data-tour="pos-buscar" />
      </TourProvider>,
    );
    await waitFor(() => expect(tarjeta()).not.toBeNull());
    // jsdom no maqueta: sin esto TODO mide 0×0 y el tour lo trataría —con razón— como
    // un elemento que no está en pantalla. Este test pasaba antes por casualidad.
    medirComo(screen.getByRole('textbox'), { top: 100, left: 40, width: 300, height: 44 });

    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    await waitFor(() => expect(screen.queryByTestId('tour-foco')).not.toBeNull());
  });

  it('un elemento OCULTO no se señala: en el móvil mide cero y el foco iría a la esquina', async () => {
    /*
      El caso real: la tarjeta del carrito del POS no se desmonta en el teléfono, se
      esconde con `display:none`. Sigue estando en el DOM, así que el tour la encuentra;
      pero mide 0×0 en (0,0), y el foco saldría como un puntito arriba a la izquierda con
      el velo alrededor.
    */
    conRouter(
      <TourProvider>
        <input data-tour="pos-buscar" style={{ display: 'none' }} />
      </TourProvider>,
    );
    await waitFor(() => expect(tarjeta()).not.toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    // El paso se enseña igual, centrado, pero sin señalar nada.
    expect(screen.getByText('Busca por nombre o por código')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 200)); // dos vueltas del intervalo de medición
    expect(screen.queryByTestId('tour-foco')).toBeNull();
  });
});
