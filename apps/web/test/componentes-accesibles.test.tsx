// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { montar, screen, userEvent } from './montar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

/**
 * Lo que el QA visual encontró, convertido en red.
 *
 * Cada ronda manual encontraba cosas de interfaz, se arreglaban, y nada impedía que
 * volvieran: el único test de estilo que había leía `index.css` y por tanto sólo veía los
 * TOKENS, no lo que los componentes hacen con ellos. Un token perfecto aplicado con la
 * clase equivocada da exactamente el mismo fallo, y el test seguía verde.
 *
 * Esto comprueba la otra mitad: que las clases que se declararon están de verdad puestas
 * en los elementos. No mide contraste —eso lo hace `paleta.test.ts` sobre los valores—;
 * mide que el valor correcto llegue al sitio correcto.
 */

describe('el contorno de los controles', () => {
  /**
   * `--color-border` y `--color-field` hacen dos trabajos distintos y se separaron por
   * eso: el primero es el filete decorativo entre dos filas, el segundo el contorno de
   * algo que se toca, y sólo el segundo tiene que llegar a 3:1. Si alguien vuelve a
   * vestir un campo con `border-border`, el contraste cae a 1.19 y ningún test de tokens
   * se entera.
   */
  it('un campo lleva el borde de CONTROL, no el decorativo', () => {
    montar(<Input placeholder="tu usuario" />);
    const campo = screen.getByPlaceholderText('tu usuario');
    expect(campo.className).toContain('border-field');
    expect(campo.className).not.toContain('border-border');
  });

  it('un desplegable también', () => {
    montar(
      <Select aria-label="sucursal">
        <option>Principal</option>
      </Select>,
    );
    expect(screen.getByLabelText('sucursal').className).toContain('border-field');
  });

  it('y el botón secundario, que es el otro que se toca', () => {
    montar(<Button variant="outline">Transferir</Button>);
    expect(screen.getByRole('button').className).toContain('border-field');
  });
});

describe('el foco de teclado', () => {
  /*
    Aquí vivía «los controles propios traen su anillo», que comprobaba que la clase
    `focus-visible:ring` estuviera en el botón. Estaba, y el anillo NO se veía: una
    utilidad de los propios componentes apagaba el contorno y las utilidades ganan por
    cascada. El test pasaba y el usuario no veía el foco.

    Se fue a `foco.test.tsx`, que compila el CSS de verdad y mira si alguna regla apaga el
    contorno de las clases que el elemento lleva puestas. La diferencia no es de estilo:
    **una clase presente no es un estilo aplicado**, y este archivo sólo puede ver lo
    primero. Lo que queda abajo sí es de su competencia, porque no hay ninguna otra regla
    peleándose por ello.
  */
  it('un botón deshabilitado trae las DOS defensas, no sólo la nativa', () => {
    /*
      La primera versión de este test hacía clic con `pointerEventsCheck: 0` y comprobaba
      que no se disparara el `onClick` — pero eso lo garantiza el atributo `disabled`
      nativo del navegador, que no es lo que este test dice vigilar. Pasaba igual con la
      clase quitada.
      
      Lo que hay que fijar es la CLASE, porque es lo que protege el caso que el atributo no
      cubre: un elemento que se ve apagado pero sigue recibiendo el clic, que es lo que
      pasa en cuanto alguien envuelve el botón en algo o lo cambia por un `<div>`.
    */
    montar(<Button disabled>Cobrar</Button>);
    const boton = screen.getByRole('button');
    expect(boton.className).toContain('disabled:pointer-events-none');
    expect(boton.className).toContain('disabled:opacity-70');
    expect(boton).toHaveProperty('disabled', true);
  });
});

describe('el modal', () => {
  it('se puede cerrar con Escape', async () => {
    // Lo mínimo que se le pide a un diálogo: que no atrape a quien navega con teclado.
    let abierto = true;
    const { Modal } = await import('@/components/ui/modal');
    montar(
      <Modal open onClose={() => (abierto = false)} title="Confirma la venta">
        <p>contenido</p>
      </Modal>,
    );
    await userEvent.keyboard('{Escape}');
    expect(abierto).toBe(false);
  });

  it('anuncia su título', async () => {
    const { Modal } = await import('@/components/ui/modal');
    montar(
      <Modal open onClose={() => {}} title="Confirma la venta">
        <p>contenido</p>
      </Modal>,
    );
    expect(screen.getByText('Confirma la venta')).toBeTruthy();
  });
});
