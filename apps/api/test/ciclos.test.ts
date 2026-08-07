import { describe, expect, it } from 'vitest';
import {
  CICLOS,
  avisoDePermanencia,
  calcularDevolucion,
  cotizar,
  PORCENTAJE_DEVOLUCION,
} from '@ventafacil/shared';

/**
 * Contratación por más de un mes, con descuento y con su regla de devolución.
 *
 * Aquí no se prueba un endpoint: se prueba **aritmética de dinero cobrado por
 * adelantado**, que es de lo poco que no se puede arreglar con un despliegue. Un error
 * de redondeo repetido sesenta veces es un descuadre que después nadie sabe explicar, y
 * una devolución mal calculada es una discusión con un cliente que se está yendo.
 */

describe('cotizar un ciclo', () => {
  it('mensual no tiene descuento', () => {
    const q = cotizar('149.00', 1);
    expect(q.total).toBe('149.00');
    expect(q.ahorro).toBe('0.00');
  });

  it('un año descuenta el 10%', () => {
    const q = cotizar('149.00', 12);
    expect(q.sinDescuento).toBe('1788.00');
    expect(q.total).toBe('1609.20');
    expect(q.ahorro).toBe('178.80');
  });

  it('cinco años descuentan el 30%', () => {
    const q = cotizar('149.00', 60);
    expect(q.sinDescuento).toBe('8940.00');
    expect(q.total).toBe('6258.00');
    expect(q.ahorro).toBe('2682.00');
  });

  it('las cuentas cuadran solas: total + ahorro = sin descuento', () => {
    // La comprobación que atrapa un redondeo torcido en cualquier ciclo y cualquier
    // precio, sin tener que escribir a mano el resultado de cada combinación.
    for (const ciclo of CICLOS) {
      for (const precio of ['149.00', '299.00', '599.00', '99.99', '0.01']) {
        const q = cotizar(precio, ciclo.meses);
        expect(
          (Number(q.total) + Number(q.ahorro)).toFixed(2),
          `${precio} × ${ciclo.meses} meses`,
        ).toBe(q.sinDescuento);
      }
    }
  });

  it('un número de meses inventado cae al mensual, no revienta', () => {
    expect(cotizar('149.00', 7).meses).toBe(1);
  });
});

describe('qué se devuelve si se va antes', () => {
  /**
   * La regla del negocio: sobre el tiempo NO usado se devuelve la mitad. No es todo
   * porque el descuento se dio por adelantado a cambio de la permanencia — devolver el
   * 100% convertiría el plan de 5 años en un mensual con descuento, que es justo lo que
   * no es.
   */
  it('el caso que hay que poder responder por teléfono: 5 años, se va a los 2', () => {
    const pagado = cotizar('149.00', 60).total; // 6258.00
    const d = calcularDevolucion(pagado, 60, 24);

    expect(d.mesesSinUsar).toBe(36);
    // 36 de 60 meses = 60% de lo pagado = 3754.80; la mitad = 1877.40
    expect(d.proporcional).toBe('3754.80');
    expect(d.devolucion).toBe('1877.40');
  });

  it('irse el último día no devuelve nada', () => {
    const d = calcularDevolucion('6258.00', 60, 60);
    expect(d.mesesSinUsar).toBe(0);
    expect(d.devolucion).toBe('0.00');
  });

  it('arrepentirse sin haber usado nada devuelve la mitad, no todo', () => {
    // Es la consecuencia dura de la regla y conviene que esté escrita: incluso sin usar
    // un solo día, la devolución es del 50%. Si algún día se quiere una ventana de
    // arrepentimiento, es una decisión aparte y se añade aquí.
    const d = calcularDevolucion('6258.00', 60, 0);
    expect(d.mesesSinUsar).toBe(60);
    expect(d.devolucion).toBe('3129.00');
  });

  it('sólo cuentan los meses CUMPLIDOS, y el redondeo favorece al cliente', () => {
    /*
      Hacia abajo a propósito. Quien lleva 3 meses y 6 días cuenta como 3, no como 4: la
      diferencia es pequeña y siempre a favor de quien se está yendo, que es justo cuando
      no conviene discutir por céntimos. Y evita el absurdo contrario — contratar y
      arrepentirse el mismo día costaría un mes entero.
    */
    expect(calcularDevolucion('1200.00', 12, 3.2).mesesSinUsar).toBe(9);
    expect(calcularDevolucion('1200.00', 12, 3.99).mesesSinUsar).toBe(9);
    expect(calcularDevolucion('1200.00', 12, 4).mesesSinUsar).toBe(8);
  });

  it('usar más meses de los contratados no genera devolución negativa', () => {
    const d = calcularDevolucion('1200.00', 12, 20);
    expect(d.mesesSinUsar).toBe(0);
    expect(Number(d.devolucion)).toBeGreaterThanOrEqual(0);
  });

  it('la devolución nunca supera lo pagado', () => {
    for (const ciclo of CICLOS) {
      const pagado = cotizar('599.00', ciclo.meses).total;
      const d = calcularDevolucion(pagado, ciclo.meses, 0);
      expect(Number(d.devolucion)).toBeLessThanOrEqual(Number(pagado));
    }
  });
});

describe('el aviso que se enseña ANTES de contratar', () => {
  it('el mensual no avisa de nada: no hay permanencia', () => {
    expect(avisoDePermanencia(1)).toBeNull();
  });

  it('el de 5 años dice el porcentaje Y el ejemplo concreto', () => {
    const aviso = avisoDePermanencia(60)!;
    expect(aviso).toContain(String(PORCENTAJE_DEVOLUCION));
    // El ejemplo importa tanto como la regla: "el 50% de lo que quede sin usar" se
    // entiende a medias; "si te vas a los 2 años de 5" se entiende del todo.
    expect(aviso).toContain('5 años');
    expect(aviso).toContain('2');
  });

  it('nombra bien el plazo en singular y en plural', () => {
    expect(avisoDePermanencia(12)).toContain('1 año');
    expect(avisoDePermanencia(24)).toContain('2 años');
  });
});
