import { db, schema } from '@ventafacil/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createTenant, makeApp, resetDb, type Tenant } from './helpers.js';

/*
  Importar sobre un catálogo que ya tiene cosas.

  Hasta ahora un producto repetido sólo se descubría DESPUÉS de subirlo: la restricción
  única lo rechazaba y aparecía en el informe final, cuando ya no se podía decidir nada.
  Ahora se consulta antes (`/products/lookup`) y cada fila dice si viene a crear o a
  actualizar uno concreto.

  Lo que más se protege aquí es lo que puede destruir datos: que actualizar NO borre las
  columnas que el archivo no traía, y que no se pueda tocar el producto de otro negocio.
*/

let app: FastifyInstance;
let t: Tenant;
let otro: Tenant;

beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  t = await createTenant(app, 'importa');
  otro = await createTenant(app, 'ajeno');
});

afterAll(async () => {
  await app.close();
  await resetDb();
});

/** Un producto con todos los campos llenos, para ver qué sobrevive a una actualización. */
async function sembrarProducto(campos: Partial<typeof schema.product.$inferInsert> = {}) {
  const [p] = await db
    .insert(schema.product)
    .values({
      businessId: t.businessId,
      locationId: t.locationId,
      sku: 'SKU-VIEJO',
      name: 'Foco LED 9W',
      description: 'La descripción de siempre',
      barcode: '7771234',
      price: '18.00',
      cost: '12.00',
      ...campos,
    })
    .returning();
  await db.insert(schema.inventory).values({
    businessId: t.businessId,
    productId: p!.id,
    locationId: t.locationId,
    quantity: 7,
    minStock: 2,
  });
  return p!;
}

function leer(id: string) {
  return db
    .select()
    .from(schema.product)
    .where(eq(schema.product.id, id))
    .then((f) => f[0]!);
}

function stockDe(productId: string) {
  return db
    .select({ q: schema.inventory.quantity, min: schema.inventory.minStock })
    .from(schema.inventory)
    .where(
      and(eq(schema.inventory.productId, productId), eq(schema.inventory.locationId, t.locationId)),
    )
    .then((f) => f[0]);
}

const importar = (rows: unknown[], token = t.adminToken) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/products/import',
    headers: auth(token),
    payload: { rows },
  });

beforeEach(async () => {
  // Cada test parte de un catálogo con un solo producto conocido.
  await db.delete(schema.product).where(eq(schema.product.businessId, t.businessId));
});

describe('/products/lookup — qué de esto ya tengo', () => {
  it('encuentra por código y devuelve con qué comparar', async () => {
    const p = await sembrarProducto();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/products/lookup',
      headers: auth(t.adminToken),
      payload: { skus: ['SKU-VIEJO', 'NO-EXISTE'], locationId: t.locationId },
    });

    expect(res.statusCode).toBe(200);
    const [hallado] = res.json().data.encontrados;
    expect(hallado.id).toBe(p.id);
    // Precio, costo y existencias: es lo que la pantalla enseña como «18,00 → 21,50».
    expect(hallado.price).toBe('18.00');
    expect(hallado.cost).toBe('12.00');
    expect(hallado.stock).toBe(7);
  });

  it('encuentra por nombre sin importar mayúsculas ni espacios de sobra', async () => {
    await sembrarProducto();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/products/lookup',
      headers: auth(t.adminToken),
      payload: { nombres: ['  foco led 9w  '] },
    });

    expect(res.json().data.encontrados).toHaveLength(1);
  });

  it('no cruza negocios', async () => {
    await sembrarProducto();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/products/lookup',
      headers: auth(otro.adminToken),
      payload: { skus: ['SKU-VIEJO'], nombres: ['foco led 9w'] },
    });

    expect(res.json().data.encontrados).toEqual([]);
  });

  it('sin nada que buscar no devuelve el catálogo entero', async () => {
    await sembrarProducto();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/products/lookup',
      headers: auth(t.adminToken),
      payload: {},
    });

    expect(res.json().data.encontrados).toEqual([]);
  });
});

describe('importar en modo actualizar', () => {
  it('pisa lo que trae el archivo y CONSERVA lo que no', async () => {
    const p = await sembrarProducto();

    const res = await importar([
      { modo: 'actualizar', productId: p.id, name: 'Foco LED 9W', price: '21.50' },
    ]);

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ created: 0, updated: 1, skipped: 0 });
    const despues = await leer(p.id);
    expect(despues.price).toBe('21.50');
    /*
      Lo que de verdad importa: una lista de precios con dos columnas —código y precio—
      no puede vaciar la descripción ni el código de barras de todo el catálogo.
    */
    expect(despues.description).toBe('La descripción de siempre');
    expect(despues.barcode).toBe('7771234');
    expect(despues.cost).toBe('12.00');
  });

  it('no toca las existencias si el archivo no trae esa columna', async () => {
    const p = await sembrarProducto();

    await importar([{ modo: 'actualizar', productId: p.id, name: 'Foco LED 9W', price: '21.50' }]);

    expect((await stockDe(p.id))?.q).toBe(7);
  });

  it('sí las cambia cuando el archivo las trae', async () => {
    const p = await sembrarProducto();

    await importar([
      { modo: 'actualizar', productId: p.id, name: 'Foco', price: '21.50', initialStock: 40 },
    ]);

    const inv = await stockDe(p.id);
    expect(inv?.q).toBe(40);
    // El mínimo no venía en el archivo: se queda como estaba.
    expect(inv?.min).toBe(2);
  });

  it('crea la fila de existencias si esa sucursal no tenía', async () => {
    const p = await sembrarProducto();
    await db.delete(schema.inventory).where(eq(schema.inventory.productId, p.id));

    await importar([
      { modo: 'actualizar', productId: p.id, name: 'Foco', price: '21.50', initialStock: 5 },
    ]);

    expect((await stockDe(p.id))?.q).toBe(5);
  });

  it('avisa si el producto desapareció mientras se revisaba', async () => {
    const p = await sembrarProducto();
    await db.delete(schema.product).where(eq(schema.product.id, p.id));

    const res = await importar([
      { modo: 'actualizar', productId: p.id, name: 'Foco', price: '21.50' },
    ]);

    const d = res.json().data;
    expect(d.updated).toBe(0);
    expect(d.errores[0].motivo).toMatch(/ya no existe/i);
  });

  it('NO deja actualizar el producto de otro negocio', async () => {
    const p = await sembrarProducto();

    const res = await importar(
      [{ modo: 'actualizar', productId: p.id, name: 'Robado', price: '1.00' }],
      otro.adminToken,
    );

    expect(res.json().data.updated).toBe(0);
    expect((await leer(p.id)).name).toBe('Foco LED 9W');
  });

  it('exige decir QUÉ producto se actualiza', async () => {
    const res = await importar([{ modo: 'actualizar', name: 'Foco', price: '21.50' }]);

    expect(res.statusCode).toBe(400);
  });

  it('crear sigue funcionando igual, y los dos modos conviven en un lote', async () => {
    const p = await sembrarProducto();

    const res = await importar([
      { modo: 'actualizar', productId: p.id, name: 'Foco LED 9W', price: '21.50' },
      { name: 'Producto nuevo', price: '5.00', sku: 'SKU-NUEVO' },
    ]);

    expect(res.json().data).toMatchObject({ created: 1, updated: 1, skipped: 0 });
  });
});
