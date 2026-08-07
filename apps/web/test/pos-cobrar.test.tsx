// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { montar, screen, userEvent } from './montar';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/format';

/**
 * El primer test que MONTA algo. Vale la pena decir por qué éste y no otro.
 *
 * La web tenía 3,5 % de cobertura y cero componentes montados: sus 10.000 líneas de
 * pantallas sólo las vigilaba una ronda manual de QA, que encuentra cosas pero no deja
 * red — cada hallazgo visual se arreglaba y nada impedía que volviera.
 *
 * Se empieza por la confirmación de cobro porque es lo último que se construyó y lo único
 * que se había comprobado nada más que a ojo, en un navegador, una vez. Y porque es
 * dinero: el diálogo existe para que un roce no registre una venta.
 *
 * Se prueba la DECISIÓN (`motivoParaConfirmar`) y el diálogo por separado, no `PosPage`
 * entera: montarla arrastra Dexie, react-query, el escáner y el proveedor de tema, y un
 * test que necesita media aplicación en pie se rompe por motivos que no son el que
 * vigila. La lógica se extrae y se prueba; el envoltorio se mira con capturas.
 */

/**
 * La misma regla que aplica el POS, escrita aquí como contrato.
 *
 * Duplicarla es deliberado y tiene un límite: si algún día divergen, este test no lo
 * nota. A cambio, fija en un sitio legible CUÁNDO se pregunta y cuándo no, que es la
 * decisión de producto — el código de `PosPage` la implementa entre el carrito, el
 * descuento y los métodos de pago, donde no se lee de un vistazo.
 */
function motivoParaConfirmar(v: {
  total: number;
  descuento: number;
  metodo: string;
  cliente?: string;
}): string | null {
  if (v.descuento > 0) {
    return `Vas a cobrar ${money(v.total)} con ${money(v.descuento)} de descuento.`;
  }
  if (v.metodo === 'credit') {
    return v.cliente
      ? `Vas a fiar ${money(v.total)} a ${v.cliente}. Quedará como deuda suya.`
      : `Vas a fiar ${money(v.total)}.`;
  }
  if (v.total >= 1000) return `Vas a cobrar ${money(v.total)}, que es una venta grande.`;
  return null;
}

describe('cuándo se pregunta antes de cobrar', () => {
  it('la venta de todos los días NO pregunta', () => {
    // Lo más importante del diseño: cobrar es el gesto más repetido de la jornada, y un
    // diálogo que se pulsa doscientas veces al día deja de leerse en una semana.
    expect(motivoParaConfirmar({ total: 45, descuento: 0, metodo: 'cash' })).toBeNull();
    expect(motivoParaConfirmar({ total: 999.99, descuento: 0, metodo: 'card' })).toBeNull();
  });

  it('con descuento pregunta, y dice cuánto se está dejando de cobrar', () => {
    const motivo = motivoParaConfirmar({ total: 90, descuento: 10, metodo: 'cash' });
    expect(motivo).toContain('10.00');
    expect(motivo).toContain('descuento');
  });

  it('al fiar pregunta, y nombra a quien queda debiendo', () => {
    const motivo = motivoParaConfirmar({
      total: 300,
      descuento: 0,
      metodo: 'credit',
      cliente: 'Doña Rosa',
    });
    expect(motivo).toContain('Doña Rosa');
    expect(motivo).toContain('deuda');
  });

  it('una venta grande pregunta por el monto', () => {
    expect(motivoParaConfirmar({ total: 1000, descuento: 0, metodo: 'cash' })).toContain(
      'venta grande',
    );
  });
});

describe('el diálogo de confirmación', () => {
  function Confirmacion({ onCobrar }: { onCobrar: () => void }) {
    return (
      <Modal open onClose={() => {}} title="Confirma la venta">
        <p>Vas a cobrar Bs. 90.00 con Bs. 10.00 de descuento.</p>
        <div>
          <Button variant="outline">Volver</Button>
          <Button onClick={onCobrar}>Cobrar {money(90)}</Button>
        </div>
      </Modal>
    );
  }

  it('el botón que confirma repite el total, no dice sólo "aceptar"', async () => {
    // Quien llegó aquí por un roce tiene que leer CUÁNTO va a cobrar. "Aceptar" no
    // informa de nada y se pulsa por reflejo.
    montar(<Confirmacion onCobrar={() => {}} />);
    expect(screen.getByRole('button', { name: /Cobrar Bs\. 90/ })).toBeTruthy();
  });

  it('cobra sólo cuando se confirma', async () => {
    const cobrar = vi.fn();
    montar(<Confirmacion onCobrar={cobrar} />);

    expect(cobrar).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Cobrar Bs\. 90/ }));
    expect(cobrar).toHaveBeenCalledOnce();
  });

  it('"Volver" no cobra', async () => {
    const cobrar = vi.fn();
    montar(<Confirmacion onCobrar={cobrar} />);
    await userEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(cobrar).not.toHaveBeenCalled();
  });
});
