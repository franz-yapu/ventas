import { db, schema } from '@ventafacil/db';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
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
