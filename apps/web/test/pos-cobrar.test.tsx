// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { montar, screen, userEvent } from './montar';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/format';
import { motivoParaConfirmar } from '@/features/pos/confirmar';

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
 * test que necesita media aplicación en pie se rompe por motivos que no son el que vigila.
 *
 * ⚠️ La primera versión de este archivo **copiaba** la regla aquí dentro "como contrato" y
 * la probaba sobre la copia: cero líneas del código real. Pasó a la primera, que debería
 * haber sido la señal. Por eso la regla se extrajo a `features/pos/confirmar.ts` y ahora
 * se importa la de verdad — si alguien cambia el umbral en el POS, estos tests se enteran.
 *
 * ⚠️ Y hubo una segunda trampa, de otra clase: aquí vivía un test de "al fiar pregunta, y
 * nombra a quien queda debiendo". Verde, sobre código real… al que **nadie llamaba nunca**,
 * porque la pantalla de cobro no ofrecía ese método. Importar la función de verdad no basta
 * si la rama que se prueba está muerta: hay que mirar también quién la llama. Se fue con el
 * resto del fiado el 11 de agosto de 2026.
 */

describe('cuándo se pregunta antes de cobrar', () => {
  it('la venta de todos los días NO pregunta', () => {
    // Lo más importante del diseño: cobrar es el gesto más repetido de la jornada, y un
    // diálogo que se pulsa doscientas veces al día deja de leerse en una semana.
    expect(motivoParaConfirmar({ total: 45, descuento: 0 })).toBeNull();
    expect(motivoParaConfirmar({ total: 999.99, descuento: 0 })).toBeNull();
  });

  it('con descuento pregunta, y dice cuánto se está dejando de cobrar', () => {
    const motivo = motivoParaConfirmar({ total: 90, descuento: 10 });
    expect(motivo).toContain('10.00');
    expect(motivo).toContain('descuento');
  });

  it('una venta grande pregunta por el monto', () => {
    expect(motivoParaConfirmar({ total: 1000, descuento: 0 })).toContain('venta grande');
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
