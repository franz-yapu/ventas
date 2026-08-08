import { describe, expect, it } from 'vitest';
import {
  aCsv,
  aMoneda,
  faltanObligatorios,
  interpretar,
  proponerMapeo,
} from '@/features/products/importar';

/**
 * La importación de inventario, que es la barrera de entrada del producto.
 *
 * Un negocio con 5.000 referencias no se pone a teclearlas: si esto no funciona, el
 * cliente no empieza — y el primer día es cuando se decide si se queda.
 *
 * Lo que se prueba aquí no es leer un archivo (eso son tres líneas) sino lo que de verdad
 * cuesta: **que el archivo de un cliente real nunca tiene las columnas que uno espera**.
 * Las cabeceras de abajo están sacadas de cómo se llaman las cosas en una planilla de
 * verdad, no de cómo nos gustaría que se llamaran.
 */

describe('adivinar qué columna es cuál', () => {
  it('reconoce las cabeceras que usa la gente, no las que nos convienen', () => {
    const m = proponerMapeo(['CODIGO', 'DESCRIPCION', 'CANT', 'P. VENTA', 'P. COMPRA']);
    expect(m['CODIGO']).toBe('sku');
    expect(m['DESCRIPCION']).toBe('name');
    expect(m['CANT']).toBe('initialStock');
    expect(m['P. VENTA']).toBe('price');
    expect(m['P. COMPRA']).toBe('cost');
  });

  it('le da igual tildes, mayúsculas y puntuación', () => {
    const m = proponerMapeo(['Artículo', 'Precio Únitario', 'Existencia']);
    expect(m['Artículo']).toBe('name');
    expect(m['Precio Únitario']).toBe('price');
    expect(m['Existencia']).toBe('initialStock');
  });

  it('con "nombre" Y "descripcion", el nombre gana', () => {
    // Una planilla con las dos casi siempre usa "descripcion" como el texto largo.
    const m = proponerMapeo(['nombre', 'descripcion', 'precio']);
    expect(m['nombre']).toBe('name');
    expect(m['descripcion']).not.toBe('name');
  });

  it('no propone el mismo campo dos veces', () => {
    // Proponer lo mismo dos veces obliga a deshacer, que es peor que no proponer.
    const m = proponerMapeo(['precio', 'precio venta', 'nombre']);
    const precios = Object.values(m).filter((c) => c === 'price');
    expect(precios).toHaveLength(1);
  });

  it('lo que no reconoce lo deja sin asignar, no lo inventa', () => {
    const m = proponerMapeo(['nombre', 'precio', 'proveedor', 'ubicacion en bodega']);
    expect(m['proveedor']).toBeNull();
    expect(m['ubicacion en bodega']).toBeNull();
  });

  it('avisa si falta un campo obligatorio', () => {
    expect(faltanObligatorios(proponerMapeo(['nombre', 'precio']))).toEqual([]);
    expect(faltanObligatorios(proponerMapeo(['nombre', 'proveedor']))).toContain('Precio de venta');
  });
});

describe('leer los números como los escribe la gente', () => {
  it('acepta el formato boliviano con punto de miles y coma decimal', () => {
    expect(aMoneda('1.234,50')).toBe('1234.50');
  });

  it('y el formato con punto decimal', () => {
    expect(aMoneda('1234.5')).toBe('1234.50');
    expect(aMoneda(1234.5)).toBe('1234.50');
  });

  it('se traga el símbolo de moneda que trae la planilla', () => {
    expect(aMoneda('Bs 1.500,00')).toBe('1500.00');
    expect(aMoneda('$45')).toBe('45.00');
  });

  it('sólo coma decimal', () => {
    expect(aMoneda('45,90')).toBe('45.90');
  });

  it('un separador SOLO: tres dígitos detrás son miles', () => {
    /*
      El caso difícil. `"1.234"` puede ser mil doscientos treinta y cuatro o uno con
      doscientos treinta y cuatro, y el texto no lo dice. Antes ganaba `Number`, que lo
      leía como 1,23: un precio de Bs 1.234 entraba como Bs 1,23 y se vendía así.

      Desempata contar los dígitos: tres detrás es de miles, porque nadie escribe tres
      decimales en un precio.
    */
    expect(aMoneda('1.234')).toBe('1234.00');
    expect(aMoneda('1,234')).toBe('1234.00');
    expect(aMoneda('45.9')).toBe('45.90');
    expect(aMoneda('45,90')).toBe('45.90');
  });

  it('varios separadores iguales sólo pueden ser miles', () => {
    expect(aMoneda('1.234.567')).toBe('1234567.00');
    expect(aMoneda('1,234,567')).toBe('1234567.00');
  });

  it('con punto Y coma, el último es el decimal', () => {
    expect(aMoneda('1.234,50')).toBe('1234.50');
    expect(aMoneda('1,234.50')).toBe('1234.50');
  });

  it('lo que no es un número devuelve null, no cero', () => {
    // Cero sería peor que fallar: se importaría un producto a precio 0 y se vendería así.
    expect(aMoneda('consultar')).toBeNull();
    expect(aMoneda('')).toBeNull();
    expect(aMoneda('-5')).toBeNull();
  });
});

describe('la vista previa: qué entra y qué no', () => {
  const mapeo = proponerMapeo(['CODIGO', 'DESCRIPCION', 'CANT', 'P. VENTA']);

  it('una fila normal entra sin errores', () => {
    const [f] = interpretar(
      [{ CODIGO: 'LL-001', DESCRIPCION: 'Llanta 175/70', CANT: '12', 'P. VENTA': '350,00' }],
      mapeo,
    );
    expect(f!.errores).toEqual([]);
    expect(f!.valores).toMatchObject({
      sku: 'LL-001',
      name: 'Llanta 175/70',
      price: '350.00',
      initialStock: 12,
    });
  });

  it('sin nombre no entra, y lo dice', () => {
    const [f] = interpretar([{ CODIGO: 'X', DESCRIPCION: '  ', 'P. VENTA': '10' }], mapeo);
    expect(f!.errores).toContain('Sin nombre');
  });

  it('con un precio ilegible dice CUÁL era', () => {
    // "Precio no válido" a secas obliga a ir a buscar la fila; con el valor dentro, se
    // entiende de un vistazo que la planilla dice "consultar".
    const [f] = interpretar([{ DESCRIPCION: 'Llanta', 'P. VENTA': 'consultar' }], mapeo);
    expect(f!.errores[0]).toContain('consultar');
  });

  it('detecta el código repetido DENTRO del archivo, y dice en qué fila estaba', () => {
    /*
      Esto no lo puede ver el servidor: los recibe de uno en uno, así que el primero
      entraría y el segundo daría un error que parece del sistema cuando en realidad es
      que el archivo trae el código dos veces. Aquí se ve antes de escribir nada.
    */
    const filas = interpretar(
      [
        { CODIGO: 'A1', DESCRIPCION: 'Uno', 'P. VENTA': '10' },
        { CODIGO: 'B2', DESCRIPCION: 'Dos', 'P. VENTA': '20' },
        { CODIGO: 'a1', DESCRIPCION: 'Uno otra vez', 'P. VENTA': '30' },
      ],
      mapeo,
    );
    expect(filas[0]!.errores).toEqual([]);
    expect(filas[2]!.errores[0]).toContain('fila 2');
  });

  it('el número de fila es el DEL ARCHIVO, contando la cabecera', () => {
    // Quien corrige mira una hoja de cálculo, no nuestro índice: si decimos "fila 1"
    // para la primera de datos, va a mirar la cabecera y no va a encontrar nada.
    const filas = interpretar([{ DESCRIPCION: 'A', 'P. VENTA': '1' }], mapeo);
    expect(filas[0]!.fila).toBe(2);
  });

  it('las columnas que nadie mapeó se ignoran sin estorbar', () => {
    const m = proponerMapeo(['DESCRIPCION', 'P. VENTA', 'PROVEEDOR']);
    const [f] = interpretar([{ DESCRIPCION: 'A', 'P. VENTA': '1', PROVEEDOR: 'Juan' }], m);
    expect(f!.errores).toEqual([]);
    expect(f!.valores).not.toHaveProperty('PROVEEDOR');
  });

  it('el stock vacío no es un error: hay negocios que lo cargan después', () => {
    const [f] = interpretar([{ DESCRIPCION: 'A', 'P. VENTA': '1', CANT: '' }], mapeo);
    expect(f!.errores).toEqual([]);
    expect(f!.valores).not.toHaveProperty('initialStock');
  });
});

describe('devolver las filas rechazadas para reintentar sólo ésas', () => {
  it('el CSV trae el motivo y la fila original', () => {
    /*
      Con 5.000 filas, "87 no entraron" sin decir cuáles obliga a volver a subir el
      archivo entero — y entonces las 4.913 que sí entraron chocan por código repetido.
      Devolver las rechazadas convierte un callejón sin salida en un segundo intento de
      87 filas.
    */
    const mapeo = proponerMapeo(['CODIGO', 'DESCRIPCION', 'P. VENTA']);
    const filas = interpretar(
      [
        { CODIGO: 'A', DESCRIPCION: 'Bien', 'P. VENTA': '10' },
        { CODIGO: 'B', DESCRIPCION: '', 'P. VENTA': 'x' },
      ],
      mapeo,
    );
    const csv = aCsv(
      filas.filter((f) => f.errores.length),
      ['CODIGO', 'DESCRIPCION', 'P. VENTA'],
    );

    expect(csv.split('\n')[0]).toBe('fila_original,motivo,CODIGO,DESCRIPCION,P. VENTA');
    expect(csv).toContain('Sin nombre');
    expect(csv).toContain('3'); // la segunda fila de datos es la 3 del archivo
    expect(csv).not.toContain('Bien'); // la buena no se devuelve
  });

  it('escapa comas y comillas para no romper el archivo devuelto', () => {
    const mapeo = proponerMapeo(['DESCRIPCION', 'P. VENTA']);
    const filas = interpretar([{ DESCRIPCION: 'Llanta "grande", roja', 'P. VENTA': 'x' }], mapeo);
    const csv = aCsv(filas, ['DESCRIPCION', 'P. VENTA']);
    expect(csv).toContain('"Llanta ""grande"", roja"');
  });
});
