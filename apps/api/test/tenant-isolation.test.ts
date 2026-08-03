import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTenant, makeApp, resetDb, type Tenant } from './helpers.js';

/**
 * El test que justifica RLS.
 *
 * Hoy el aislamiento entre negocios depende de que cada consulta recuerde su
 * `where businessId = ...`. Esta suite lo comprueba de forma mecánica: con el token
 * del negocio A pide TODO lo que expone el API y verifica que en la respuesta no
 * aparece ni un byte del negocio B.
 *
 * La comprobación es sobre el cuerpo crudo, a propósito: no depende de la forma de
 * cada respuesta y detecta la fuga aunque venga anidada en un reporte o un join.
 */

let app: FastifyInstance;
let a: Tenant;
let b: Tenant;

/** Cadenas que sólo pueden venir del negocio B. Si aparecen, hubo fuga. */
function secretsOf(t: Tenant): Array<[string, string]> {
  return [
    ['businessId', t.businessId],
    ['productId', t.productId],
    ['customerId', t.customerId],
    ['categoryId', t.categoryId],
    ['saleId', t.saleId],
    ['locationId', t.locationId],
    ['adminId', t.adminId],
    ['nombre del producto', `Producto secreto de ${t.slug}`],
    ['nombre del cliente', `Cliente secreto de ${t.slug}`],
  ];
}

/**
 * `requestUrl` se excluye del análisis: si el atacante pone un id ajeno en la URL y el
 * API lo repite en un 404, eso no es una fuga — ya lo conocía. Sólo importa lo que el
 * API revela por su cuenta.
 */
function expectNoLeak(body: string, victim: Tenant, endpoint: string, requestUrl = '') {
  for (const [label, secret] of secretsOf(victim)) {
    if (requestUrl.includes(secret)) continue;
    expect(
      body.includes(secret),
      `FUGA en ${endpoint}: la respuesta contiene ${label} del otro negocio (${secret})`,
    ).toBe(false);
  }
}

beforeAll(async () => {
  app = await makeApp();
  await resetDb();
  a = await createTenant(app, 'negocio-a');
  b = await createTenant(app, 'negocio-b');
});

afterAll(async () => {
  await app?.close();
});

describe('lectura: el negocio A nunca ve datos del negocio B', () => {
  it.each([
    ['GET /products', () => '/api/v1/products'],
    ['GET /products?search', () => '/api/v1/products?search=secreto'],
    ['GET /customers', () => '/api/v1/customers'],
    ['GET /categories', () => '/api/v1/categories'],
    ['GET /locations', () => '/api/v1/locations'],
    ['GET /users', () => '/api/v1/users'],
    ['GET /inventory', () => '/api/v1/inventory'],
    ['GET /sales', () => '/api/v1/sales'],
    ['GET /audit', () => '/api/v1/audit'],
    ['GET /business/me', () => '/api/v1/business/me'],
    ['GET /dashboard-config', () => '/api/v1/dashboard-config'],
    ['GET /reports/summary', () => '/api/v1/reports/summary'],
    ['GET /reports/dashboard', () => '/api/v1/reports/dashboard'],
    ['GET /reports/cash-z', () => '/api/v1/reports/cash-z'],
  ])('%s no filtra nada de B', async (name, urlOf) => {
    const res = await app.inject({ method: 'GET', url: urlOf(), headers: auth(a.adminToken) });
    expect(res.statusCode, `${name} respondió ${res.statusCode}: ${res.body}`).toBeLessThan(500);
    expectNoLeak(res.body, b, name);
  });

  it('GET /products/:id de B no devuelve el producto', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/products/${b.productId}`,
      headers: auth(a.adminToken),
    });
    expect(res.statusCode).not.toBe(200);
    expectNoLeak(res.body, b, 'GET /products/:id ajeno', `/api/v1/products/${b.productId}`);
  });

  it('GET /products/:id/history de B no devuelve historial', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/products/${b.productId}/history`,
      headers: auth(a.adminToken),
    });
    expectNoLeak(res.body, b, 'GET /products/:id/history ajeno', `/api/v1/products/${b.productId}/history`);
  });

  it('GET /customers/:id de B no devuelve el cliente', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/customers/${b.customerId}`,
      headers: auth(a.adminToken),
    });
    expect(res.statusCode).not.toBe(200);
    expectNoLeak(res.body, b, 'GET /customers/:id ajeno', `/api/v1/customers/${b.customerId}`);
  });

  it('GET /sales/:id de B no devuelve la venta', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/sales/${b.saleId}`,
      headers: auth(a.adminToken),
    });
    expect(res.statusCode).not.toBe(200);
    expectNoLeak(res.body, b, 'GET /sales/:id ajeno', `/api/v1/sales/${b.saleId}`);
  });

  it('filtrar por la ubicación de B no expone sus ventas', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/sales?locationId=${b.locationId}`,
      headers: auth(a.adminToken),
    });
    expectNoLeak(res.body, b, 'GET /sales?locationId ajeno', `/api/v1/sales?locationId=${b.locationId}`);
  });
});

describe('escritura: el negocio A nunca modifica datos del negocio B', () => {
  it('PATCH /products/:id de B falla', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${b.productId}`,
      headers: auth(a.adminToken),
      payload: { name: 'HACKEADO' },
    });
    expect(res.statusCode).not.toBe(200);

    const check = await app.inject({
      method: 'GET',
      url: `/api/v1/products/${b.productId}`,
      headers: auth(b.adminToken),
    });
    expect(check.body).not.toContain('HACKEADO');
  });

  it('PATCH /users/:id de B falla', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${b.adminId}`,
      headers: auth(a.adminToken),
      payload: { name: 'HACKEADO' },
    });
    expect(res.statusCode).not.toBe(200);
  });

  it('DELETE /categories/:id de B falla', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/categories/${b.categoryId}`,
      headers: auth(a.adminToken),
    });
    expect(res.statusCode).not.toBe(200);

    const check = await app.inject({
      method: 'GET',
      url: '/api/v1/categories',
      headers: auth(b.adminToken),
    });
    expect(check.body).toContain(b.categoryId);
  });

  it('POST /sales/:id/cancel sobre una venta de B falla', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${b.saleId}/cancel`,
      headers: auth(a.adminToken),
      payload: { reason: 'intento cruzado' },
    });
    expect(res.statusCode).not.toBe(200);
  });

  it('POST /customers/:id/payments sobre un cliente de B falla', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/customers/${b.customerId}/payments`,
      headers: auth(a.adminToken),
      payload: { amount: '10.00' },
    });
    expect(res.statusCode).not.toBe(200);
  });

  it('crear un producto en la ubicación de B falla', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: auth(a.adminToken),
      payload: {
        name: 'Producto intruso',
        price: '10.00',
        cost: '5.00',
        locationId: b.locationId,
      },
    });
    expect(res.statusCode).not.toBe(201);
  });
});

describe('autenticación', () => {
  it('sin token no se puede leer nada', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/products' });
    expect(res.statusCode).toBe(401);
  });

  it('el login exige el negocio cuando hay más de uno', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'secreto123' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('el token emitido para un slug sólo abre ese negocio', async () => {
    // Ambos negocios tienen un usuario 'admin': el slug es lo único que los distingue.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'secreto123', business: b.slug },
    });
    expect(res.statusCode).toBe(200);
    const token = res.json().data.accessToken as string;

    const products = await app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: auth(token),
    });
    // Entró a B, así que debe ver lo de B y nada de A.
    expect(products.body).toContain(b.productId);
    expectNoLeak(products.body, a, 'token de B tras login por slug');
  });
});
