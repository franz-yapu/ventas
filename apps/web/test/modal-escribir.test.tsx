// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { montar, screen, userEvent } from './montar';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';

/**
 * Escribir dentro de un modal, que es lo que estaba roto.
 *
 * Reportado desde el uso real: al cancelar una venta, el campo del motivo "no te deja
 * escribir directo, salta a cerrar modal". Bloqueante — la cancelación exige un motivo de
 * tres caracteres y no se podía teclear.
 *
 * La causa está en `Modal`: su `useEffect` llevaba `onClose` en las dependencias, y quien
 * lo usa le pasa una flecha en línea (`onClose={() => setCancelId(null)}`) que es una
 * función NUEVA en cada render. Cada tecla cambiaba el estado del padre → nuevo render →
 * nueva identidad de `onClose` → el efecto se limpiaba y se volvía a montar. Y su limpieza
 * devuelve el foco a donde estaba antes de abrir, mientras que al montar lo lleva al primer
 * campo: el foco salía disparado en cada letra.
 *
 * No era un fallo de la pantalla de ventas: le pasaba a CUALQUIER modal cuyo formulario
 * viva en el estado del padre, que son casi todos.
 */

/** Un modal como los de la aplicación: el valor vive en el padre y `onClose` es una flecha. */
function ModalConCampo() {
  const [abierto, setAbierto] = useState(true);
  const [motivo, setMotivo] = useState('');
  return (
    <Modal open={abierto} onClose={() => setAbierto(false)} title="Cancelar venta">
      <Input
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Ej. producto devuelto"
      />
      <p>escrito: {motivo}</p>
    </Modal>
  );
}

describe('se puede escribir dentro de un modal', () => {
  it('el campo conserva el foco entre teclas', async () => {
    montar(<ModalConCampo />);
    const campo = screen.getByPlaceholderText('Ej. producto devuelto');

    await userEvent.click(campo);
    expect(document.activeElement, 'perdió el foco al primer clic').toBe(campo);

    await userEvent.keyboard('p');
    expect(document.activeElement, 'el foco se fue tras la primera tecla').toBe(campo);
  });

  it('un motivo entero llega completo, sin perder letras', async () => {
    // La prueba que reproduce el síntoma tal cual lo describió quien lo sufrió: se
    // escribe una frase normal y tiene que quedar entera.
    montar(<ModalConCampo />);
    const campo = screen.getByPlaceholderText('Ej. producto devuelto');

    await userEvent.type(campo, 'producto devuelto');

    expect((campo as HTMLInputElement).value).toBe('producto devuelto');
    expect(screen.getByText('escrito: producto devuelto')).toBeTruthy();
  });

  it('y el modal NO se cierra por escribir', async () => {
    montar(<ModalConCampo />);
    await userEvent.type(screen.getByPlaceholderText('Ej. producto devuelto'), 'abc');
    expect(screen.getByText('Cancelar venta')).toBeTruthy();
  });

  it('Escape sigue cerrando: el arreglo no se lleva por delante lo que funcionaba', async () => {
    montar(<ModalConCampo />);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('Cancelar venta')).toBeNull();
  });
});
