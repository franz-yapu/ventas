import { db, schema } from '@ventafacil/db';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTenant, makeApp, resetDb, type Tenant } from './helpers.js';

/**
 * Fiado: el saldo de un cliente, sus abonos y quién puede verlo.
 *
 * `customers.ts` estaba al 52 % de cobertura y es **dinero que el negocio no ha cobrado
 * todavía**. Un error aquí no revienta: da un número, y el dueño le fía a alguien que ya
 * no debería recibir más, o le cobra a quien no debe. De los tres módulos peor cubiertos
 * del API salieron el hallazgo crítico y dos altos de la revisión; éste era el que
 * quedaba sin red y el que maneja plata.
 *
 * Lo que se fija aquí es la ARITMÉTICA del saldo (ventas a crédito menos abonos) y la
 * excepción deliberada de alcance: el fiado se le fía al negocio, no a una sucursal.
 */

let app: FastifyInstance;
let t: Tenant;
/** Vendedor de una SEGUNDA sucursal, para la excepción de alcance. */
let vendedorNorte = '';
let norteId = '';
let clienteId = '';

/** Inserta una venta a crédito directamente: aquí se prueba el saldo, no el flujo. */
async function fiar(total: string, receipt: number, locationId = t.locationId) {
  await db.insert(schema.sale).values({
    id: crypto.randomUUID(),
    businessId: t.businessId,
    locationId,
    userId: t.adminId,
    customerId: clienteId,
    status: 'completed',
    subtotal: total,
    total,
    paymentMethod: 'credit',
    receiptNumber: receipt,
    clientCreatedAt: new Date(),
  });
}

async function saldoDe(token: string): Promise<string> {
  const res = await app.inject({ method: 'GET', url: '/api/v1/customers', headers: auth(token) });
  const c = res.json().data.find((x: { id: string }) => x.id === clienteId);
  return String(c.balance);
}

beforeAll(async () => {
  app = await makeApp();
  await resetDb();
  t = await createTenant(app, 'fiado');

  const [norte] = await db
    .insert(schema.location)
    .values({ businessId: t.businessId, name: 'Sucursal Norte', isCentral: false })
    .returning();
  norteId = norte!.id;

  await db.insert(schema.appUser).values({
    businessId: t.businessId,
    locationId: norteId,
    name: 'Vendedor Norte',
    username: 'vendedor.norte',
    passwordHash: await argon2.hash('secreto123'),
    role: 'seller',
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'vendedor.norte', password: 'secreto123', business: t.slug },
  });
  vendedorNorte = login.json().data.accessToken;

  const nuevo = await app.inject({
    method: 'POST',
    url: '/api/v1/customers',
    headers: auth(t.adminToken),
    payload: { name: 'Doña Rosa', phone: '70000000' },
  });
  clienteId = nuevo.json().data.id;
});

afterAll(async () => {
  await app.close();
});

describe('el saldo de un cliente', () => {
  it('un cliente nuevo no debe nada', async () => {
    expect(Number(await saldoDe(t.adminToken))).toBe(0);
  });

  it('cada venta a crédito le suma', async () => {
    await fiar('300.00', 501);
    expect(Number(await saldoDe(t.adminToken))).toBe(300);
    await fiar('200.00', 502);
    expect(Number(await saldoDe(t.adminToken))).toBe(500);
  });

  it('un abono le resta', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/customers/${clienteId}/payments`,
      headers: auth(t.adminToken),
      payload: { amount: '120.00', method: 'cash' },
    });
    expect(res.statusCode).toBe(201);
    expect(Number(await saldoDe(t.adminToken))).toBe(380);
  });

  it('pagar de más deja el saldo a favor, no lo esconde', async () => {
    // Pasa de verdad: se abona un billete redondo por una deuda con céntimos. Que el
    // número quede en negativo es correcto — el negocio le debe esa diferencia.
    await app.inject({
      method: 'POST',
      url: `/api/v1/customers/${clienteId}/payments`,
      headers: auth(t.adminToken),
      payload: { amount: '400.00', method: 'cash' },
    });
    expect(Number(await saldoDe(t.adminToken))).toBe(-20);

    // Y se deja como estaba para los casos siguientes.
    await fiar('20.00', 503);
    expect(Number(await saldoDe(t.adminToken))).toBe(0);
  });

  it('un abono a un cliente que no existe responde 404, no 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/customers/11111111-1111-4111-8111-111111111111/payments',
      headers: auth(t.adminToken),
      payload: { amount: '10.00', method: 'cash' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('un abono con monto inválido se rechaza', async () => {
    for (const amount of ['0.00', '-5.00', 'mucho']) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/customers/${clienteId}/payments`,
        headers: auth(t.adminToken),
        payload: { amount, method: 'cash' },
      });
      expect(res.statusCode, `monto ${amount}`).toBe(400);
    }
  });
});

describe('el fiado se le fía AL NEGOCIO, no a una sucursal', () => {
  /**
   * Excepción deliberada al alcance por ubicación, documentada en `customers.ts`.
   *
   * Si cada local viera sólo su parte, un cliente que debe Bs. 3.000 repartidos entre
   * tres locales parecería deber Bs. 1.000 en cada uno — y en los tres le seguirían
   * fiando. El test existe para que a nadie le parezca un olvido de los arreglos de
   * alcance y lo "corrija".
   */
  it('el vendedor de Norte ve la deuda contraída en la central', async () => {
    await fiar('750.00', 601, t.locationId);
    expect(Number(await saldoDe(vendedorNorte))).toBe(750);
  });

  it('y el detalle le muestra esas ventas, aunque sean de otro local', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/customers/${clienteId}`,
      headers: auth(vendedorNorte),
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.creditSales.length).toBeGreaterThan(0);
    // Quien cobra un abono necesita ver contra qué recibo lo aplica.
    expect(d.payments.length).toBeGreaterThan(0);
  });

  it('pero el cliente de OTRO negocio sigue siendo inalcanzable', async () => {
    const otro = await createTenant(app, 'fiado-ajeno');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/customers/${otro.customerId}`,
      headers: auth(t.adminToken),
    });
    expect(res.statusCode).not.toBe(200);
  });
});
