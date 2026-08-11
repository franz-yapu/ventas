// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { montar, screen, userEvent, waitFor } from './montar';
import { EliminarModal } from '@/components/EliminarModal';
import { LocationsPage } from '@/features/locations/LocationsPage';
import { UsersPage } from '@/features/users/UsersPage';
import { ApiError } from '@/lib/api';

/**
 * Eliminar sucursales y usuarios: los tres desenlaces, y que la pantalla los alcance.
 *
 * ## Por qué este archivo existe
 *
 * El API traía esto entero desde hacía días —guardas, política de borrar-o-desactivar,
 * 14 tests— y **no había forma de llegar a ello**: ninguna pantalla tenía un botón. Pasó
 * el typecheck, el CI completo y dos revisiones con tres agentes sin que nadie lo notara,
 * porque **todos los tests entraban por el API**.
 *
 * De ahí las dos mitades de abajo, y la segunda es la que de verdad enseñó la lección:
 *
 * 1. `EliminarModal` decide qué se le enseña a quien pulsa. Se prueba suelto porque es
 *    donde vive la lógica de los tres desenlaces.
 * 2. Las **pantallas** se montan de verdad para comprobar que el botón existe, que llama
 *    a la ruta correcta y que enseña lo que vuelve. Sin esto volveríamos a tener un
 *    componente impecable que nadie usa — que es exactamente el agujero que se está
 *    tapando aquí.
 *
 * ## Los tres desenlaces, y por qué se confunden
 *
 * Dos de ellos llegan con el **mismo 200**: si no colgaba nada se borró; si colgaba, NO se
 * borró y se desactivó. Tratar la respuesta como un simple "ok" deja a alguien creyendo
 * que borró algo que sigue ahí. El tercero es un 409 con cuatro motivos distintos.
 */

vi.mock('@/lib/api', async (original) => {
  // `ApiError` tiene que ser el DE VERDAD: el componente distingue con `instanceof`, y un
  // doble haría pasar el test por el camino de "error desconocido" sin que se note.
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

const { api } = await import('@/lib/api');

function conQuery(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return montar(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.del).mockReset();
  vi.mocked(api.patch).mockReset();
});

describe('los tres desenlaces de eliminar', () => {
  function abrir(onEliminar: () => Promise<never> | Promise<any>) {
    return montar(
      <EliminarModal
        que="la sucursal «Norte»"
        onEliminar={onEliminar}
        onCambio={() => {}}
        onCerrar={() => {}}
      />,
    );
  }

  it('no llama al API hasta que se confirma', async () => {
    const eliminar = vi.fn();
    abrir(eliminar);

    expect(screen.getByRole('heading', { name: /¿Eliminar la sucursal «Norte»\?/ })).toBeTruthy();
    expect(eliminar).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(eliminar).not.toHaveBeenCalled();
  });

  it('ELIMINADO: lo dice y no habla de desactivar', async () => {
    abrir(async () => ({ eliminado: true, mensaje: '«Norte» se eliminó.' }));
    await userEvent.click(screen.getByRole('button', { name: /Eliminar/ }));

    expect(await screen.findByText('«Norte» se eliminó.')).toBeTruthy();
    expect(screen.queryByText(/desactiv/i)).toBeNull();
  });

  it('DESACTIVADO: enseña el motivo del servidor y qué colgaba', async () => {
    /*
      El caso que se pierde si se trata el 200 como un simple "ok". Y el detalle —340
      ventas, 12 turnos— no es adorno: es lo que evita que alguien se ponga a borrar
      ventas para "destrabar" el borrado de la sucursal.
    */
    abrir(async () => ({
      eliminado: false,
      mensaje:
        'No se eliminó porque la sucursal tiene 340 ventas registradas, 12 turnos de caja. ' +
        'Se desactivó en su lugar: deja de usarse y su historial se conserva.',
      colgando: ['340 ventas registradas', '12 turnos de caja'],
    }));
    await userEvent.click(screen.getByRole('button', { name: /Eliminar/ }));

    expect(await screen.findByRole('heading', { name: 'Se desactivó en su lugar' })).toBeTruthy();
    expect(screen.getByText(/No se eliminó porque la sucursal tiene 340 ventas/)).toBeTruthy();

    // Y repetido en vertical: en prosa, con tres o cuatro cosas, se lee mal justo cuando
    // más importa entenderlo.
    const lista = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(lista).toEqual(['· 340 ventas registradas', '· 12 turnos de caja']);
  });

  it('BLOQUEADO: enseña el motivo del 409, que dice qué hacer antes', async () => {
    abrir(async () => {
      throw new ApiError(
        409,
        'Es la sucursal principal. Nombra principal a otra antes de eliminarla, o el negocio se queda sin quien lo administre.',
        'es_principal',
      );
    });
    await userEvent.click(screen.getByRole('button', { name: /Eliminar/ }));

    expect(await screen.findByRole('heading', { name: 'No se puede eliminar' })).toBeTruthy();
    expect(screen.getByText(/Nombra principal a otra antes de eliminarla/)).toBeTruthy();
  });

  it('un fallo que no es del API no inventa un motivo', async () => {
    abrir(async () => {
      throw new TypeError('Failed to fetch');
    });
    await userEvent.click(screen.getByRole('button', { name: /Eliminar/ }));

    expect(await screen.findByText(/No se pudo eliminar/)).toBeTruthy();
    expect(screen.queryByText(/Failed to fetch/)).toBeNull();
  });
});

describe('la pantalla de Ubicaciones llega hasta el API', () => {
  const NORTE = { id: 'u2', name: 'Norte', address: null, isCentral: false, isActive: true };
  const CENTRAL = { id: 'u1', name: 'Central', address: null, isCentral: true, isActive: true };

  it('la papelera llama al DELETE de esa sucursal y enseña lo que vuelve', async () => {
    vi.mocked(api.get).mockResolvedValue([CENTRAL, NORTE]);
    vi.mocked(api.del).mockResolvedValue({ eliminada: true, mensaje: '«Norte» se eliminó.' });
    conQuery(<LocationsPage />);

    const papeleras = await screen.findAllByLabelText('Eliminar Norte');
    await userEvent.click(papeleras[0]!);
    await userEvent.click(screen.getByRole('button', { name: /^Eliminar$/ }));

    await waitFor(() => expect(api.del).toHaveBeenCalledWith('/locations/u2'));
    expect(await screen.findByText('«Norte» se eliminó.')).toBeTruthy();
  });

  it('la PRINCIPAL no ofrece eliminarse: su 409 no tiene arreglo desde aquí', async () => {
    vi.mocked(api.get).mockResolvedValue([CENTRAL, NORTE]);
    conQuery(<LocationsPage />);

    await screen.findAllByLabelText('Eliminar Norte');
    expect(screen.queryByLabelText('Eliminar Central')).toBeNull();
  });

  it('«hacer principal» existe, porque el 409 de la central manda a usarlo', async () => {
    /*
      El API tenía `PATCH /locations/:id/principal` desde hacía semanas y **nadie lo
      llamaba**: el mensaje de "es la principal, nombra otra antes" pedía algo que no se
      podía hacer desde ninguna pantalla. Este test es lo que impide que vuelva a pasar.
    */
    vi.mocked(api.get).mockResolvedValue([CENTRAL, NORTE]);
    vi.mocked(api.patch).mockResolvedValue({ mensaje: '«Norte» es ahora la sucursal principal.' });
    conQuery(<LocationsPage />);

    const botones = await screen.findAllByLabelText('Hacer principal Norte');
    await userEvent.click(botones[0]!);

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/locations/u2/principal'));
    expect(await screen.findByText(/es ahora la sucursal principal/)).toBeTruthy();
  });
});

describe('la pantalla de Usuarios llega hasta el API', () => {
  const MARTA = {
    id: 'x9',
    name: 'Marta Quispe',
    username: 'marta',
    role: 'seller' as const,
    locationId: 'u2',
    isActive: true,
  };

  it('la papelera llama al DELETE de ese usuario', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path === '/users' ? [MARTA] : [],
    );
    vi.mocked(api.del).mockResolvedValue({ eliminado: true, mensaje: 'Marta Quispe se eliminó.' });
    conQuery(<UsersPage />);

    const papeleras = await screen.findAllByLabelText('Eliminar Marta Quispe');
    await userEvent.click(papeleras[0]!);
    await userEvent.click(screen.getByRole('button', { name: /^Eliminar$/ }));

    await waitFor(() => expect(api.del).toHaveBeenCalledWith('/users/x9'));
    expect(await screen.findByText('Marta Quispe se eliminó.')).toBeTruthy();
  });

  it('el 409 de "es tu propia cuenta" se lee tal cual', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path === '/users' ? [MARTA] : [],
    );
    vi.mocked(api.del).mockRejectedValue(new ApiError(409, 'No puedes eliminar tu propia cuenta.'));
    conQuery(<UsersPage />);

    const papeleras = await screen.findAllByLabelText('Eliminar Marta Quispe');
    await userEvent.click(papeleras[0]!);
    await userEvent.click(screen.getByRole('button', { name: /^Eliminar$/ }));

    expect(await screen.findByText('No puedes eliminar tu propia cuenta.')).toBeTruthy();
  });
});
