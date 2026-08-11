/**
 * @vitest-environment jsdom
 *
 * `jspdf` sólo arranca en un navegador: al cargarlo en `node` revienta buscando `atob` en
 * el objeto global. Corre en el navegador en producción, así que se prueba donde corre.
 */
import { describe, expect, it } from 'vitest';
import {
  avisoDeTamano,
  celda,
  construirPdf,
  esNumerica,
  lineaDeFiltros,
  lineaDeOrigen,
  MAX_FILAS_PDF,
  paginasAprox,
  tituloDe,
} from '@/lib/pdf';

/**
 * El informe en PDF.
 *
 * Casi todo lo que se prueba aquí son funciones puras, y es a propósito: lo que puede
 * salir mal no es que el archivo esté corrupto —de eso responde la librería— sino que el
 * papel diga algo distinto de lo que se pidió. Un informe "del 31 de julio" cuando se
 * filtró desde el 1 de agosto se imprime igual de bien.
 */

describe('la línea de filtros', () => {
  /*
    El fallo que este test existe para impedir.

    Una fecha pelada la parsea `Date` como medianoche UTC. Formateándola después en la zona
    del negocio (UTC−4) sale el día ANTERIOR: quien filtra desde el 1 de agosto recibe un
    papel que dice "del 31 de julio". El informe sale, sólo que mintiendo — y es de los que
    se firman.
  */
  it('respeta el día que se escribió en el filtro, sin correrlo por la zona horaria', () => {
    expect(lineaDeFiltros({ desde: '2026-08-01', hasta: '2026-08-31' })).toBe(
      'del 1 al 31 de agosto de 2026',
    );
  });

  it('no repite el mes ni el año cuando son los mismos en las dos puntas', () => {
    const l = lineaDeFiltros({ desde: '2026-08-01', hasta: '2026-08-31' });
    expect(l.match(/agosto/g)).toHaveLength(1);
    expect(l.match(/2026/g)).toHaveLength(1);
  });

  it('dice los dos meses cuando el rango los cruza', () => {
    expect(lineaDeFiltros({ desde: '2026-07-28', hasta: '2026-08-03' })).toBe(
      'del 28 de julio al 3 de agosto de 2026',
    );
  });

  it('dice los dos años cuando el rango los cruza', () => {
    expect(lineaDeFiltros({ desde: '2025-12-30', hasta: '2026-01-02' })).toBe(
      'del 30 de diciembre de 2025 al 2 de enero de 2026',
    );
  });

  it('aguanta que sólo venga una de las dos puntas', () => {
    expect(lineaDeFiltros({ desde: '2026-08-01' })).toBe('desde el 1 de agosto de 2026');
    expect(lineaDeFiltros({ hasta: '2026-08-31' })).toBe('hasta el 31 de agosto de 2026');
  });

  it('sin ningún filtro lo dice, en vez de dejar el hueco', () => {
    expect(lineaDeFiltros({})).toBe('todo el registro');
  });

  it('añade la sucursal cuando la pantalla la pasa', () => {
    expect(
      lineaDeFiltros({ desde: '2026-08-01', hasta: '2026-08-31', alcance: 'Sucursal Norte' }),
    ).toBe('del 1 al 31 de agosto de 2026 · Sucursal Norte');
  });

  /*
    Filtrado por sucursal pero sin su nombre: se DICE que está filtrado.

    Callarlo dejaría un papel que parece de todo el negocio siendo de un solo local. Es el
    mismo tipo de fallo silencioso que el de la zona horaria: el documento se imprime bien
    y dice algo que no es.
  */
  it('avisa de que hay una sucursal filtrada aunque no se sepa cuál', () => {
    expect(lineaDeFiltros({ alcanceSinNombre: true })).toBe('una sucursal');
    expect(lineaDeFiltros({ desde: '2026-08-01', alcanceSinNombre: true })).toBe(
      'desde el 1 de agosto de 2026 · una sucursal',
    );
  });

  it('ignora una fecha que no tenga la forma esperada, en vez de escribir "Invalid Date"', () => {
    expect(lineaDeFiltros({ desde: 'ayer', hasta: '' })).toBe('todo el registro');
  });
});

describe('el contenido de una celda', () => {
  /*
    Una fecha ISO cruzando la medianoche: es el caso que distingue la zona del negocio de
    UTC. Las 02:30 UTC del 12 son las 22:30 del 11 en La Paz — día distinto, no sólo hora.
  */
  it('pasa las fechas a la hora del negocio, no a UTC', () => {
    // 02:30 UTC del 12 son las 22:30 del 11 en La Paz: cambia el DÍA, no sólo la hora.
    // El reloj sale en 12 horas porque así lo da `dateTime`, que es el de toda la app.
    expect(celda('2026-08-12T02:30:00.000Z')).toMatch(/^11\/0?8\/\d{2,4},? 10:30 p/);
  });

  it('no deja pasar un ISO crudo al papel', () => {
    expect(celda('2026-08-12T02:30:00.000Z')).not.toContain('T');
    expect(celda('2026-08-12T02:30:00.000Z')).not.toContain('Z');
  });

  it('los vacíos salen como raya y no como "null"', () => {
    expect(celda(null)).toBe('—');
    expect(celda(undefined)).toBe('—');
    expect(celda('')).toBe('—');
  });

  it('los booleanos salen en castellano', () => {
    expect(celda(true)).toBe('Sí');
    expect(celda(false)).toBe('No');
  });

  it('el cero es un dato, no un vacío', () => {
    expect(celda(0)).toBe('0');
  });

  it('deja en paz lo que ya es texto', () => {
    expect(celda('Filtro de aceite')).toBe('Filtro de aceite');
    expect(celda('123.45')).toBe('123.45');
  });
});

describe('las columnas numéricas', () => {
  const filas = [
    { Producto: 'Filtro', Total: '120.50', Notas: null },
    { Producto: 'Bujía', Total: '9.00', Notas: '' },
  ];

  it('reconoce los decimales que llegan como texto desde el API', () => {
    expect(esNumerica('Total', filas)).toBe(true);
  });

  it('no alinea a la derecha una columna de texto', () => {
    expect(esNumerica('Producto', filas)).toBe(false);
  });

  it('una columna entera vacía no cuenta como numérica', () => {
    expect(esNumerica('Notas', filas)).toBe(false);
  });
});

describe('el tope', () => {
  it('cuenta las páginas y las nombra en el aviso', () => {
    // 25 filas por hoja, medido sobre un informe de ventas de verdad (en horizontal
    // entran 24). Antes se suponían 40 y el aviso se quedaba corto casi en la mitad.
    expect(paginasAprox(8320)).toBe(333);
    const aviso = avisoDeTamano(8320);
    expect(aviso).toContain('8.320 filas');
    expect(aviso).toContain('333 páginas');
    expect(aviso).toContain('Excel');
  });

  it('nunca dice "0 páginas"', () => {
    expect(paginasAprox(0)).toBe(1);
    expect(paginasAprox(1)).toBe(1);
  });
});

describe('los títulos y el origen', () => {
  it('traduce la sección al título del papel', () => {
    expect(tituloDe('ventas')).toBe('Ventas');
    expect(tituloDe('actividad')).toBe('Actividad');
  });

  it('firma quién y cuándo, en la hora del negocio', () => {
    const l = lineaDeOrigen('Ana Pérez', new Date('2026-08-12T02:30:00.000Z'));
    expect(l).toContain('Generado por Ana Pérez');
    expect(l).toMatch(/11\/0?8\/\d{2,4},? 10:30 p/);
  });
});

/**
 * El Blob de jsdom no trae `.text()`, así que se lee con `FileReader` — que es además lo
 * que existe en los navegadores viejos donde corre esto. Se decodifica como latin1 y no
 * como UTF-8: un PDF es binario, y lo que se busca dentro (`%PDF`, `/Count`) es ASCII.
 */
async function leer(blob: Blob): Promise<string> {
  const buf = await new Promise<ArrayBuffer>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as ArrayBuffer);
    r.onerror = () => rej(r.error);
    r.readAsArrayBuffer(blob);
  });
  return Buffer.from(buf).toString('latin1');
}

describe('el archivo', () => {
  const base = {
    seccion: 'ventas' as const,
    negocio: 'Llantería Central',
    generadoPor: 'Ana Pérez',
    ahora: new Date('2026-08-11T20:00:00.000Z'),
  };
  const fila = (i: number) => ({
    Recibo: `R-${i}`,
    Fecha: '2026-08-11T14:00:00.000Z',
    Sucursal: 'Principal',
    Total: '120.50',
  });

  it('sale un PDF de verdad', async () => {
    const blob = await construirPdf({ ...base, filas: [fila(1)] });
    expect(blob.size).toBeGreaterThan(0);
    expect(await leer(blob)).toMatch(/^%PDF-/);
  });

  /*
    Que crezca en páginas al crecer las filas.

    Es lo único que distingue un PDF armado de uno que sólo dibujó la cabecera y se dejó la
    tabla: 400 filas no caben en una hoja. El contador `/Count` del catálogo lo dice sin
    tener que interpretar el formato.
  */
  it('reparte las filas en varias páginas', async () => {
    const una = await leer(await construirPdf({ ...base, filas: [fila(1)] }));
    const muchas = await leer(
      await construirPdf({ ...base, filas: Array.from({ length: 400 }, (_, i) => fila(i)) }),
    );
    const cuenta = (pdf: string) => Number(pdf.match(/\/Count (\d+)/)?.[1] ?? 0);
    expect(cuenta(una)).toBe(1);
    expect(cuenta(muchas)).toBeGreaterThan(5);
  });

  /*
    Ninguna página se queda sin cabecera. Lo destapó mirar el PDF, no un test.

    Cuando la tabla termina pegada al borde inferior, la firma se va a una hoja nueva — y
    esa hoja la abre `addPage` a mano, así que no pasa por `didDrawPage` de la tabla.
    Salía **en blanco con dos rayas**: sin negocio, sin fechas, sin decir de qué informe
    era. Y es justo la hoja que alguien firma y archiva por separado.

    Se barren RANGOS CONTINUOS y no una lista de números sueltos. Hoy el caso salta con
    33-37 filas y con 70-74, pero ese borde se mueve en cuanto cambie el cuerpo de letra o
    el alto de celda — la primera versión de este test probaba 1, 20, 22, 24, 25, 26, 28,
    30, 48 y 52, pasaba entera, y no se enteraba del fallo. Un rango que cruza el borde lo
    sigue cruzando aunque el borde se corra un par de filas.
  */
  it('ninguna página se queda sin cabecera, tampoco la de la firma', async () => {
    const rango = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    for (const cuantas of [1, 24, ...rango(30, 40), ...rango(68, 76)]) {
      const pdf = await leer(
        await construirPdf({
          ...base,
          // Una palabra sin acentos y que no salga en los datos: dentro del PDF el texto
          // va en WinAnsi, y buscar "Llantería" obligaría a decodificar.
          negocio: 'Bolivar SRL',
          filas: Array.from({ length: cuantas }, (_, i) => fila(i)),
        }),
      );
      const paginas = Number(pdf.match(/\/Count (\d+)/)?.[1] ?? 0);
      const cabeceras = pdf.match(/Bolivar SRL/g)?.length ?? 0;
      expect(paginas).toBeGreaterThan(0);
      expect(`${cuantas} filas → ${cabeceras}/${paginas}`).toBe(
        `${cuantas} filas → ${paginas}/${paginas}`,
      );
    }
  });

  it('no se cae cuando el negocio no tiene logo', async () => {
    const blob = await construirPdf({ ...base, filas: [fila(1)], logoUrl: null });
    expect(blob.size).toBeGreaterThan(0);
  });

  /*
    Un logo ilegible no puede llevarse por delante el informe.

    El logo se guarda en PNG desde Configuración, pero basta con que una versión futura lo
    guarde en otro formato para que `addImage` lance. Perder el logo es mucho menos grave
    que no poder sacar el papel.
  */
  it('sigue adelante si el logo no se puede dibujar', async () => {
    const blob = await construirPdf({
      ...base,
      filas: [fila(1)],
      logoUrl: 'data:image/webp;base64,esto-no-es-una-imagen',
    });
    expect(blob.size).toBeGreaterThan(0);
    expect(await leer(blob)).toMatch(/^%PDF-/);
  });

  it('el tope está donde dice estar', () => {
    expect(MAX_FILAS_PDF).toBe(1500);
  });
});
