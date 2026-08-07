import { disableRlsStatements, enableRlsStatements } from '@ventafacil/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTenant, makeApp, resetDb, type Tenant } from './helpers.js';
import { closeOwner, runAsOwner } from './owner-db.js';

/**
 * La prueba de que la migración a withTenant() está COMPLETA.
 *
 * Ejercita los endpoints reales con RLS activo. Como RLS falla cerrado, cualquier
 * handler que siga consultando con el `db` global —sin fijar el negocio en la
 * transacción— devolverá vacío o fallará, y el test lo delata. Mientras algo aquí
 * este en rojo, RLS no se puede activar en producción.
 */

let app: FastifyInstance;
let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  app = await makeApp();
  await resetDb();
  a = await createTenant(app, 'int-a');
  b = await createTenant(app, 'int-b');
  await runAsOwner(enableRlsStatements);
});

afterAll(async () => {
  await runAsOwner(disableRlsStatements);
  await closeOwner();
  await app?.close();
});

/** Endpoints de lectura que deben seguir devolviendo los datos del propio negocio. */
const LECTURAS: Array<[string, string, (t: Tenant) => string | undefined]> = [
  ['GET /products', '/api/v1/products', (t) => t.productId],
  ['GET /customers', '/api/v1/customers', (t) => t.customerId],
  ['GET /categories', '/api/v1/categories', (t) => t.categoryId],
  ['GET /locations', '/api/v1/locations', (t) => t.locationId],
  ['GET /users', '/api/v1/users', (t) => t.adminId],
  ['GET /inventory', '/api/v1/inventory', (t) => t.productId],
  ['GET /sales', '/api/v1/sales', (t) => t.saleId],
  ['GET /business/me', '/api/v1/business/me', (t) => t.businessId],
  ['GET /audit', '/api/v1/audit', () => undefined],
  ['GET /reports/summary', '/api/v1/reports/summary', () => undefined],
  ['GET /reports/dashboard', '/api/v1/reports/dashboard', () => undefined],
  ['GET /reports/cash-z', '/api/v1/reports/cash-z', () => undefined],
  ['GET /dashboard-config', '/api/v1/dashboard-config', () => undefined],
];

describe('con RLS activo, cada negocio sigue viendo LO SUYO', () => {
  it.each(LECTURAS)('%s responde y trae los datos propios', async (name, url, esperado) => {
    const res = await app.inject({ method: 'GET', url, headers: auth(a.adminToken) });

    expect(res.statusCode, `${name} respondió ${res.statusCode}: ${res.body.slice(0, 300)}`).toBe(
      200,
    );

    const propio = esperado(a);
    if (propio) {
      expect(
        res.body.includes(propio),
        `${name} no devolvió los datos del propio negocio: el handler probablemente ` +
          `sigue usando el db global sin withTenant() (RLS falla cerrado).`,
      ).toBe(true);
    }
  });

  it.each(LECTURAS)('%s no filtra nada del otro negocio', async (name, url) => {
    const res = await app.inject({ method: 'GET', url, headers: auth(a.adminToken) });
    for (const secreto of [b.productId, b.customerId, b.saleId, b.businessId, b.adminId]) {
      expect(res.body.includes(secreto), `FUGA en ${name}`).toBe(false);
    }
  });
});

describe('con RLS activo, las escrituras siguen funcionando', () => {
  it('crear una categoría y verla en el listado', async () => {
    const crear = await app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: auth(a.adminToken),
      payload: { name: 'Categoria con RLS' },
    });
    expect(crear.statusCode, crear.body.slice(0, 300)).toBe(201);

    const listar = await app.inject({
      method: 'GET',
      url: '/api/v1/categories',
      headers: auth(a.adminToken),
    });
    expect(listar.body).toContain('Categoria con RLS');
  });

  it('crear un producto y verlo en el catálogo', async () => {
    const crear = await app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: auth(a.adminToken),
      payload: {
        name: 'Producto con RLS',
        price: '55.00',
        cost: '20.00',
        locationId: a.locationId,
      },
    });
    expect(crear.statusCode, crear.body.slice(0, 300)).toBe(201);

    const listar = await app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: auth(a.adminToken),
    });
    expect(listar.body).toContain('Producto con RLS');
  });

  it('registrar una venta y verla en el historial', async () => {
    const saleId = crypto.randomUUID();
    const vender = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: auth(a.adminToken),
      payload: {
        id: saleId,
        locationId: a.locationId,
        subtotal: '100.00',
        discount: '0',
        total: '100.00',
        paymentMethod: 'cash',
        clientCreatedAt: new Date().toISOString(),
        items: [
          {
            productId: a.productId,
            productNameSnapshot: 'Producto secreto de int-a',
            unitPriceSnapshot: '100.00',
            quantity: 1,
            lineTotal: '100.00',
          },
        ],
      },
    });
    expect(vender.statusCode, vender.body.slice(0, 300)).toBe(201);

    const historial = await app.inject({
      method: 'GET',
      url: '/api/v1/sales',
      headers: auth(a.adminToken),
    });
    expect(historial.body).toContain(saleId);
  });

  it('la auditoría queda registrada (audit_log también está bajo RLS)', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: auth(a.adminToken),
      payload: { name: 'Categoria auditada' },
    });

    const auditoria = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: auth(a.adminToken),
    });
    expect(auditoria.statusCode).toBe(200);
    expect(
      auditoria.body.includes('category'),
      'no se registró la auditoría: el plugin de audit necesita contexto de tenant',
    ).toBe(true);
  });

  it('el login sigue funcionando con RLS activo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'secreto123', business: a.slug },
    });
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
  });
});
