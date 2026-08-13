import { describe, expect, it } from 'vitest';
import {
  clasificar,
  diferencias,
  filasParaEnviar,
  interpretar,
  type ProductoExistente,
} from '@/features/products/importar';

/**
 * Los repetidos: los que vienen dos veces en el Excel y los que ya están en el catálogo.
 *
 * Las dos cosas eran antes callejones sin salida. El código repetido dentro del archivo
 * se descartaba sin preguntar cuál de las dos filas valía; y el que ya existía en el
 * catálogo ni se miraba — se subía, el servidor lo rechazaba por la restricción única y
 * salía en el informe FINAL, cuando ya no se podía decidir nada.
 *
 * Ahora las dos son decisiones, y lo que se prueba aquí es que la pantalla reciba
 * exactamente las que hay: ni una de más —cada una cuesta un clic— ni una de menos.
 */

const mapeo = {
  CODIGO: 'sku' as const,
  DESCRIPCION: 'name' as const,
  'P. VENTA': 'price' as const,
  CANT: 'initialStock' as const,
};

const leer = (filas: Array<Record<string, unknown>>) => interpretar(filas, mapeo);

function existente(campos: Partial<ProductoExistente> = {}): ProductoExistente {
  return {
    id: 'p1',
    sku: 'A1',
    name: 'Foco LED',
    barcode: null,
    description: 'Una descripción',
    price: '18.00',
    cost: '12.00',
    stock: 7,
    minStock: 2,
    ...campos,
  };
}

describe('repetidos dentro del propio archivo', () => {
  it('agrupa las filas que traen el mismo código, sin importar mayúsculas', () => {
    const c = clasificar(
      leer([
        { CODIGO: 'A1', DESCRIPCION: 'Uno', 'P. VENTA': '10' },
        { CODIGO: 'B2', DESCRIPCION: 'Dos', 'P. VENTA': '20' },
        { CODIGO: 'a1', DESCRIPCION: 'Uno otra vez', 'P. VENTA': '30' },
      ]),
    );

    expect(c.entran.map((f) => f.fila)).toEqual([3]); // sólo B2
    expect(c.repetidos).toHaveLength(1);
    expect(c.repetidos[0]!.motivo).toBe('archivo');
    expect(c.repetidos[0]!.por).toBe('sku');
    // Las DOS filas viajan: la decisión es cuál vale, y para eso hay que verlas.
    expect(c.repetidos[0]!.filas.map((f) => f.fila)).toEqual([2, 4]);
  });

  it('sin código, agrupa por nombre', () => {
    const c = clasificar(
      leer([
        { DESCRIPCION: 'Foco LED', 'P. VENTA': '10' },
        { DESCRIPCION: '  foco led  ', 'P. VENTA': '12' },
      ]),
    );

    expect(c.repetidos).toHaveLength(1);
    expect(c.repetidos[0]!.por).toBe('nombre');
  });

  it('el mismo nombre con distinto código NO es repetido', () => {
    // Dos productos legítimamente distintos con nombre parecido: manda el código.
    const c = clasificar(
      leer([
        { CODIGO: 'A1', DESCRIPCION: 'Foco LED', 'P. VENTA': '10' },
        { CODIGO: 'A2', DESCRIPCION: 'Foco LED', 'P. VENTA': '12' },
      ]),
    );

    expect(c.repetidos).toEqual([]);
    expect(c.entran).toHaveLength(2);
  });

  it('tres veces la misma fila es UNA decisión, no dos', () => {
    const c = clasificar(
      leer([
        { CODIGO: 'A1', DESCRIPCION: 'Uno', 'P. VENTA': '10' },
        { CODIGO: 'A1', DESCRIPCION: 'Uno', 'P. VENTA': '11' },
        { CODIGO: 'A1', DESCRIPCION: 'Uno', 'P. VENTA': '12' },
      ]),
    );

    expect(c.repetidos).toHaveLength(1);
    expect(c.repetidos[0]!.filas).toHaveLength(3);
  });
});

describe('repetidos contra el catálogo', () => {
  it('lo marca y dice qué cambiaría', () => {
    const c = clasificar(leer([{ CODIGO: 'A1', DESCRIPCION: 'Foco LED', 'P. VENTA': '21.50' }]), [
      existente(),
    ]);

    expect(c.entran).toEqual([]);
    const r = c.repetidos[0]!;
    expect(r.motivo).toBe('catalogo');
    expect(r.existente?.id).toBe('p1');
    expect(r.cambios).toEqual([{ campo: 'price', etiqueta: 'Precio', de: '18.00', a: '21.50' }]);
  });

  it('«sin cambios» cuando los datos ya son iguales', () => {
    const c = clasificar(leer([{ CODIGO: 'A1', DESCRIPCION: 'Foco LED', 'P. VENTA': '18' }]), [
      existente(),
    ]);

    // Sigue siendo una decisión —el producto existe— pero la pantalla puede decir que
    // actualizar no serviría de nada, y ahorrarle el clic.
    expect(c.repetidos[0]!.cambios).toEqual([]);
  });

  it('también lo encuentra por nombre cuando el archivo no trae códigos', () => {
    const c = clasificar(leer([{ DESCRIPCION: 'foco led', 'P. VENTA': '21.50' }]), [existente()]);

    expect(c.repetidos[0]!.motivo).toBe('catalogo');
    expect(c.repetidos[0]!.por).toBe('nombre');
  });

  it('repetido en el archivo Y ya existente: una sola decisión, con las dos cosas', () => {
    const c = clasificar(
      leer([
        { CODIGO: 'A1', DESCRIPCION: 'Foco LED', 'P. VENTA': '21.50' },
        { CODIGO: 'A1', DESCRIPCION: 'Foco LED', 'P. VENTA': '22.00' },
      ]),
      [existente()],
    );

    expect(c.repetidos).toHaveLength(1);
    const r = c.repetidos[0]!;
    expect(r.motivo).toBe('archivo');
    expect(r.filas).toHaveLength(2);
    // Y se sabe que además está guardado, para poder ofrecer actualizarlo.
    expect(r.existente?.id).toBe('p1');
  });
});

describe('lo que no cambia de sitio', () => {
  it('las filas mal siguen apartadas, y no se cuelan en los repetidos', () => {
    const c = clasificar(
      leer([
        { CODIGO: 'A1', DESCRIPCION: '', 'P. VENTA': '10' },
        { CODIGO: 'A1', DESCRIPCION: 'Uno', 'P. VENTA': '10' },
      ]),
    );

    expect(c.noEntran).toHaveLength(1);
    // La fila sin nombre no cuenta como pareja: sólo queda una buena con ese código.
    expect(c.repetidos).toEqual([]);
    expect(c.entran).toHaveLength(1);
  });

  it('todo sale en el orden del archivo', () => {
    const c = clasificar(
      leer([
        { CODIGO: 'Z9', DESCRIPCION: 'Ultimo', 'P. VENTA': '10' },
        { CODIGO: 'A1', DESCRIPCION: 'Primero', 'P. VENTA': '10' },
        { CODIGO: 'M5', DESCRIPCION: 'Medio', 'P. VENTA': '10' },
      ]),
    );

    // Quien revisa mira su hoja de cálculo: una lista desordenada obliga a buscar cada
    // fila a mano.
    expect(c.entran.map((f) => f.fila)).toEqual([2, 3, 4]);
  });
});

describe('qué cambiaría al actualizar', () => {
  it('sólo lista los campos que el archivo TRAE', () => {
    // El archivo no mapeó costo ni descripción: no se van a tocar, así que listarlos
    // como cambio sería mentir.
    const cambios = diferencias({ name: 'Foco LED', price: '21.50' }, existente());

    expect(cambios.map((c) => c.campo)).toEqual(['price']);
  });

  it('cuenta las existencias como un cambio más', () => {
    const cambios = diferencias({ initialStock: 40 }, existente());

    expect(cambios).toEqual([{ campo: 'initialStock', etiqueta: 'Existencias', de: '7', a: '40' }]);
  });

  it('un campo vacío en el catálogo se enseña como raya, no como "null"', () => {
    const cambios = diferencias({ barcode: '7771234' }, existente({ barcode: null }));

    expect(cambios[0]!.de).toBe('—');
  });
});

describe('qué se le manda al servidor según lo decidido', () => {
  const conRepetidos = () =>
    clasificar(
      leer([
        { CODIGO: 'X9', DESCRIPCION: 'Suelto', 'P. VENTA': '5' },
        { CODIGO: 'A1', DESCRIPCION: 'Foco LED', 'P. VENTA': '21.50' },
        { CODIGO: 'B2', DESCRIPCION: 'Pila', 'P. VENTA': '9.50' },
        { CODIGO: 'B2', DESCRIPCION: 'Pila', 'P. VENTA': '10.00' },
      ]),
      [existente()],
    );

  it('por defecto: lo que ya existe se OMITE, y del repetido del archivo entra la primera', () => {
    const c = conRepetidos();

    const envio = filasParaEnviar(c, {});

    // El suelto y la primera «Pila». El «Foco LED», que ya está guardado, no.
    expect(envio.map((f) => f.datos.name)).toEqual(['Suelto', 'Pila']);
    expect(envio.find((f) => f.datos.name === 'Pila')!.datos.price).toBe('9.50');
    expect(envio.some((f) => f.datos.modo === 'actualizar')).toBe(false);
  });

  it('«actualizar» viaja con el modo y el id del producto guardado', () => {
    const c = conRepetidos();
    const clave = c.repetidos.find((r) => r.existente)!.clave;

    const envio = filasParaEnviar(c, { [clave]: { tipo: 'actualizar' } });

    const foco = envio.find((f) => f.datos.name === 'Foco LED')!.datos;
    expect(foco.modo).toBe('actualizar');
    expect(foco.productId).toBe('p1');
  });

  it('elegir la segunda fila manda esa, no la primera', () => {
    const c = conRepetidos();
    const grupo = c.repetidos.find((r) => r.motivo === 'archivo')!;

    const envio = filasParaEnviar(c, { [grupo.clave]: { tipo: 'fila', fila: 5 } });

    expect(envio.find((f) => f.datos.name === 'Pila')!.datos.price).toBe('10.00');
  });

  it('omitir de verdad omite', () => {
    const c = conRepetidos();
    const omitirTodo = Object.fromEntries(
      c.repetidos.map((r) => [r.clave, { tipo: 'omitir' as const }]),
    );

    expect(filasParaEnviar(c, omitirTodo).map((f) => f.datos.name)).toEqual(['Suelto']);
  });

  it('«actualizar» sobre algo que NO está guardado no se manda a medias', () => {
    /*
      Un «actualizar» sin `productId` es un 400 del servidor, y como se sube por lotes se
      llevaría por delante las 299 filas que iban con él. Se descarta aquí.
    */
    const c = conRepetidos();
    const grupo = c.repetidos.find((r) => !r.existente)!;

    const envio = filasParaEnviar(c, { [grupo.clave]: { tipo: 'actualizar' } });

    expect(envio.some((f) => f.datos.name === 'Pila')).toBe(false);
    expect(envio.every((f) => f.datos.modo !== 'actualizar' || f.datos.productId)).toBe(true);
  });
});
