import { beforeEach, describe, expect, it } from 'vitest';
import type { Product } from '@/lib/types';

/**
 * ¿Este negocio usa fotos? La respuesta decide la rejilla ENTERA del POS.
 *
 * La banda de imagen de las tarjetas es todo-o-nada a propósito: media rejilla con foto y
 * media sin ella queda descuadrada. Pero la respuesta se sacaba de `products`, que es la
 * ventana de 24 filas que devuelve `searchCatalog` — o sea, de lo que hay pintado.
 *
 * De ahí salían dos desenlaces, y el segundo es el malo:
 *
 * - Una tienda con 500 productos y fotos en unos pocos: si ninguno de los 24 primeros por
 *   orden alfabético tenía foto, el POS **no enseñaba ninguna**, y el dueño que acababa de
 *   subirlas creía que la función estaba rota.
 * - El cajero teclea «fil», un resultado sí tiene foto, la respuesta cambia y **todas** las
 *   tarjetas ganan 80 px de golpe: la rejilla se recoloca a mitad de pulsación y se añade
 *   el producto equivocado a la venta.
 *
 * Por eso la pregunta se le hace al catálogo entero, que es de quien es la respuesta.
 */

const { db } = await import('@/offline/db');
const { hayFotosEnCatalogo, searchCatalog } = await import('@/offline/catalog');

function producto(nombre: string, imageUrl: string | null = null): Product {
  return {
    id: `id-${nombre}`,
    sku: `SKU-${nombre}`,
    barcode: null,
    name: nombre,
    price: '10.00',
    cost: null,
    imageUrl,
    isActive: true,
  } as unknown as Product;
}

beforeEach(async () => {
  await db.catalog.clear();
});

describe('¿hay fotos en este catálogo?', () => {
  it('dice que sí aunque la única con foto quede fuera de la primera página', async () => {
    // 30 productos: los 24 primeros por orden alfabético no tienen foto. Es exactamente la
    // tienda de 500 productos con fotos en unos pocos.
    const sinFoto = Array.from({ length: 29 }, (_, i) =>
      producto(`A-${String(i).padStart(2, '0')}`),
    );
    await db.catalog.bulkPut([...sinFoto, producto('Zapato', '/media/n1/zapato.webp')]);

    const visibles = await searchCatalog('');
    expect(visibles, 'la ventana ya no son 24: el caso deja de probar lo suyo').toHaveLength(24);
    expect(
      visibles.some((p) => p.imageUrl),
      'la foto se coló en la página visible',
    ).toBe(false);

    expect(await hayFotosEnCatalogo()).toBe(true);
  });

  it('sin ninguna foto dice que no, y la rejilla se queda compacta', async () => {
    await db.catalog.bulkPut([producto('Aceite'), producto('Filtro')]);
    expect(await hayFotosEnCatalogo()).toBe(false);
  });

  it('con el catálogo vacío no promete una banda que nadie va a llenar', async () => {
    expect(await hayFotosEnCatalogo()).toBe(false);
  });

  /*
    La mitad que de verdad se sentía en el mostrador: la respuesta NO puede depender de lo
    que se esté tecleando. Si cambia entre una búsqueda y otra, la rejilla se recoloca bajo
    el dedo del cajero.
  */
  it('la respuesta no cambia según lo que se busque', async () => {
    await db.catalog.bulkPut([
      producto('Bujía'),
      producto('Filtro de aceite', '/media/n1/filtro.webp'),
    ]);

    const antes = await hayFotosEnCatalogo();
    // Una búsqueda que sólo devuelve el producto SIN foto.
    const soloSinFoto = await searchCatalog('Bujía');
    expect(soloSinFoto).toHaveLength(1);
    expect(soloSinFoto.some((p) => p.imageUrl)).toBe(false);

    expect(await hayFotosEnCatalogo()).toBe(antes);
    expect(antes).toBe(true);
  });
});
