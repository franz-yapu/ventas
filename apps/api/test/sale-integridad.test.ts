import { db, schema } from '@ventafacil/db';
import argon2 from 'argon2';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearAccessCache } from '../src/lib/subscription.js';
import { auth, createTenant, makeApp, resetDb, type Tenant } from './helpers.js';

/**
 * Integridad de la venta.
 *
 * Los precios llegan del CLIENTE a propósito: son un snapshot del momento de la venta y
 * el POS vende sin conexión, así que el servidor no puede recalcularlos con los precios
 * de hoy sin falsear el histórico. Pero eso no obliga a creerse cualquier cosa.
 *
 * Antes se aceptaba: `total: "1.00"` con `subtotal: "30.00"`, totales negativos, una
 * línea de Bs. 9999 para un producto de Bs. 10, un descuento mayor que el subtotal, y
 * ventas con fecha en 2030 (que además desaparecen de todo arqueo, porque el turno
 * filtra por `client_created_at`).
 */

let app: FastifyInstance;
let t: Tenant;
let otro: Tenant;
let recibo = 500;

function venta(cambios: Record<string, unknown> = {}) {
  const base = {
    id: crypto.randomUUID(),
    locationId: t.locationId,
    subtotal: '100.00',
    discount: '0',
    total: '100.00',
    paymentMethod: 'cash',
    status: 'completed',
    clientCreatedAt: new Date().toISOString(),
    items: [
      {
        productId: t.productId,
        productNameSnapshot: 'Producto',
        unitPriceSnapshot: '50.00',
        quantity: 2,
        lineTotal: '100.00',
      },
    ],
  };
  return { ...base, ...cambios };
}

async function vender(cuerpo: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/sales',
    headers: auth(t.adminToken),
    payload: cuerpo,
  });
}

beforeAll(async () => {
  app = await makeApp();
  await resetDb();
  t = await createTenant(app, 'integridad-a');
  otro = await createTenant(app, 'integridad-b');
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  clearAccessCache();
  recibo++;
});

describe('la aritmética tiene que cuadrar', () => {
  it('una venta coherente se acepta', async () => {
    expect((await vender(venta())).statusCode).toBe(201);
  });

  it('rechaza un total que no es subtotal menos descuento', async () => {
    const res = await vender(venta({ total: '1.00' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/total/i);
  });

  it('rechaza un subtotal que no suma sus líneas', async () => {
    const res = await vender(venta({ subtotal: '30.00', total: '30.00' }));
    expect(res.statusCode).toBe(400);
  });

  it('rechaza una línea cuyo total no es precio × cantidad', async () => {
    const res = await vender(
      venta({
        items: [
          {
            productId: t.productId,
            productNameSnapshot: 'Producto',
            unitPriceSnapshot: '9999.00',
            quantity: 1,
            lineTotal: '100.00',
          },
        ],
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it('rechaza un descuento mayor que el subtotal', async () => {
    const res = await vender(venta({ discount: '999.00', total: '0.00' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/descuento/i);
  });

  it('el descuento que deja el total en cero SÍ se acepta si cuadra', async () => {
    // Es una decisión de negocio, no de aritmética: regalar mercadería está topado
    // aparte (ver el tope por rol), no aquí.
    const res = await vender(venta({ discount: '100.00', total: '0.00' }));
    expect(res.statusCode).toBe(201);
  });

  it('rechaza importes negativos', async () => {
    for (const campo of [{ total: '-500.00' }, { subtotal: '-100.00' }, { discount: '-5.00' }]) {
      const res = await vender(venta(campo));
      expect(res.statusCode, JSON.stringify(campo)).toBe(400);
    }
  });

  it('rechaza una fecha en el futuro: desaparecería de todo arqueo', async () => {
    const res = await vender(venta({ clientCreatedAt: '2030-01-01T10:00:00.000Z' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/futuro/i);
  });

  it('acepta un reloj adelantado unas horas: no todos los dispositivos están en hora', async () => {
    const enDosHoras = new Date(Date.now() + 2 * 3_600_000).toISOString();
    expect((await vender(venta({ clientCreatedAt: enDosHoras }))).statusCode).toBe(201);
  });
});

describe('la venta tiene que ser de este negocio', () => {
  it('no se puede vender en la ubicación de otro negocio', async () => {
    const res = await vender(venta({ locationId: otro.locationId }));
    expect(res.statusCode).toBe(403);

    // Y no quedó ni rastro en el otro negocio.
    const ventas = await db
      .select()
      .from(schema.sale)
      .where(eq(schema.sale.locationId, otro.locationId));
    expect(ventas).toHaveLength(1); // sólo la que sembró createTenant
  });

  it('no se puede vender un producto de otro negocio', async () => {
    const res = await vender(
      venta({
        items: [
          {
            productId: otro.productId,
            productNameSnapshot: 'Producto ajeno',
            unitPriceSnapshot: '50.00',
            quantity: 2,
            lineTotal: '100.00',
          },
        ],
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/negocio/i);
  });
});

describe('tope de descuento del vendedor', () => {
  /*
    Repone existencias antes de cada caso. Aquí se prueba el TOPE, no el inventario, y
    desde que vender exige stock estas ventas repetidas agotaban las 10 unidades con las
    que nace el tenant y empezaban a fallar por otro motivo — un test que falla por algo
    distinto de lo que vigila es peor que uno que no existe.
  */
  beforeEach(async () => {
    await db
      .update(schema.inventory)
      .set({ quantity: 100 })
      .where(
        and(
          eq(schema.inventory.productId, t.productId),
          eq(schema.inventory.locationId, t.locationId),
        ),
      );
  });

  let vendedor: string;

  beforeAll(async () => {
    await db.insert(schema.appUser).values({
      businessId: t.businessId,
      locationId: t.locationId,
      name: 'Cajera',
      username: 'cajera',
      passwordHash: await argon2.hash('secreto123'),
      role: 'seller',
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'cajera', password: 'secreto123', business: 'integridad-a' },
    });
    vendedor = login.json().data.accessToken;
  });

  async function venderComoCajera(discount: string) {
    const subtotal = 100;
    return app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: auth(vendedor),
      payload: venta({
        subtotal: subtotal.toFixed(2),
        discount,
        total: (subtotal - Number(discount)).toFixed(2),
      }),
    });
  }

  it('el vendedor NO puede regalar la mercadería', async () => {
    // Era el agujero: descuento igual al total -> cobrar Bs. 0 y nadie se entera.
    const res = await venderComoCajera('100.00');
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('discount_limit');
    expect(res.json().error).toMatch(/10%/);
  });

  it('dentro del tope sí puede', async () => {
    expect((await venderComoCajera('10.00')).statusCode).toBe(201);
  });

  it('un centavo por encima del tope se rechaza', async () => {
    expect((await venderComoCajera('10.50')).statusCode).toBe(403);
  });

  it('el ADMINISTRADOR no tiene tope: es su mercadería', async () => {
    const res = await vender(venta({ discount: '100.00', total: '0.00' }));
    expect(res.statusCode).toBe(201);
  });

  it('el tope lo decide el dueño: subiéndolo, el vendedor puede más', async () => {
    await db
      .update(schema.business)
      .set({ maxSellerDiscountPct: 50 })
      .where(eq(schema.business.id, t.businessId));
    expect((await venderComoCajera('45.00')).statusCode).toBe(201);
    expect((await venderComoCajera('60.00')).statusCode).toBe(403);
  });

  it('en 0, el vendedor no descuenta nada', async () => {
    await db
      .update(schema.business)
      .set({ maxSellerDiscountPct: 0 })
      .where(eq(schema.business.id, t.businessId));
    expect((await venderComoCajera('1.00')).statusCode).toBe(403);
    expect((await venderComoCajera('0')).statusCode).toBe(201);
  });
});

/**
 * No se vende lo que no se tiene.
 *
 * Encontrado probando en el NAS, y es el peor de los que salieron ese día: un vendedor de
 * una sucursal recién creada vendió un producto **del que no tenía ni una unidad**. El
 * recibo se emitió (#72) y el inventario NO registró nada — no había fila para esa
 * sucursal, y la otra conservó sus existencias intactas. Se cobró mercadería que no salió
 * de ningún sitio, y el stock del negocio pasó a mentir sin que nada lo dijera.
 *
 * La causa estaba escrita en el propio comentario del descuento: «sólo … productos con
 * inventario en la ubicación». Es un `UPDATE` que, cuando no encuentra fila, afecta a cero
 * filas y sigue como si nada. Un descuento que no descuenta y no protesta.
 *
 * Decisión de franz (12 de agosto de 2026): rechazarlo. Vender sin existencias emite un
 * papel que no se corresponde con ninguna mercadería, y el descuadre aparece días después
 * en un arqueo que nadie sabe explicar.
 */
describe('no se vende lo que no hay en la sucursal', () => {
  /** Deja el inventario del producto del tenant en una cantidad concreta. */
  async function dejarStock(cantidad: number) {
    await db
      .update(schema.inventory)
      .set({ quantity: cantidad })
      .where(
        and(
          eq(schema.inventory.productId, t.productId),
          eq(schema.inventory.locationId, t.locationId),
        ),
      );
  }

  const stockActual = async () => {
    const [fila] = await db
      .select()
      .from(schema.inventory)
      .where(
        and(
          eq(schema.inventory.productId, t.productId),
          eq(schema.inventory.locationId, t.locationId),
        ),
      );
    return fila?.quantity ?? null;
  };

  it('con existencias de sobra, la venta pasa y descuenta', async () => {
    await dejarStock(10);
    expect((await vender(venta())).statusCode).toBe(201);
    expect(await stockActual(), 'no descontó las 2 unidades vendidas').toBe(8);
  });

  it('pedir más de lo que hay se rechaza, y lo dice con el nombre y cuánto queda', async () => {
    await dejarStock(1);
    const res = await vender(venta());
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().error).toMatch(/Producto secreto/);
    expect(res.json().error).toMatch(/1/);
    expect(res.json().code).toBe('sin_stock');
  });

  it('y no se descuenta NADA: o entra entera, o no entra', async () => {
    // Media venta descontada sería peor que ninguna: el papel no sale y la mercadería
    // desaparece del sistema igual.
    await dejarStock(1);
    await vender(venta());
    expect(await stockActual()).toBe(1);
  });

  /*
    Y tampoco se gasta un número de recibo. El correlativo es lo que le da sentido a la
    numeración de un talonario: un hueco obliga a explicar dónde fue a parar ese papel.
  */
  it('una venta rechazada no consume el correlativo', async () => {
    await dejarStock(10);
    const antes = (await vender(venta())).json().data.receiptNumber;
    await dejarStock(0);
    await vender(venta());
    await dejarStock(10);
    const despues = (await vender(venta())).json().data.receiptNumber;
    expect(despues).toBe(antes + 1);
  });

  /*
    El caso exacto del NAS: un producto que existe en el negocio pero del que esta
    sucursal no tiene NI UNA fila de inventario. Antes pasaba, porque el UPDATE no
    encontraba nada que actualizar y nadie miraba cuántas filas había tocado.
  */
  it('sin fila de inventario en esa sucursal, tampoco', async () => {
    const [otraSucursal] = await db
      .insert(schema.location)
      .values({ businessId: t.businessId, name: 'Sin nada', isCentral: false })
      .returning();
    await db.insert(schema.appUser).values({
      businessId: t.businessId,
      locationId: otraSucursal!.id,
      name: 'Cajero de la nueva',
      username: 'cajero.nuevo',
      passwordHash: await argon2.hash('secreto123'),
      role: 'seller',
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'cajero.nuevo', password: 'secreto123', business: t.slug },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: auth(login.json().data.accessToken),
      payload: venta({ locationId: otraSucursal!.id }),
    });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().code).toBe('sin_stock');

    const ventas = await db
      .select()
      .from(schema.sale)
      .where(eq(schema.sale.locationId, otraSucursal!.id));
    expect(ventas, 'se emitió el recibo igualmente').toHaveLength(0);
  });
});
