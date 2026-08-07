import { db, schema } from '@ventafacil/db';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearUserCache } from '../src/lib/sessions.js';
import { clearAccessCache } from '../src/lib/subscription.js';
import { auth, createTenant, makeApp, resetDb, type Tenant } from './helpers.js';

/**
 * Un usuario SIN ubicación asignada.
 *
 * Es el camino por defecto: en la pantalla de usuarios, "Ubicación" dice "(opcional)"
 * y el desplegable arranca en "Sin asignar". Un dueño que da de alta a su primer
 * empleado cae aquí sin darse cuenta.
 *
 * Antes, `viewScope()` devolvía el centinela `'__none__'`, que se comparaba contra una
 * columna `uuid` y reventaba con 22P02: la app del vendedor respondía 500 en todas las
 * pantallas, pero SIN mensaje — se veía como un negocio recién creado y vacío. El peor
 * fallo posible: roto y silencioso.
 */

let app: FastifyInstance;
let t: Tenant;
let sinUbicacion: string;

beforeAll(async () => {
  app = await makeApp();
  await resetDb();
  t = await createTenant(app, 'sin-ubicacion');

  await db.insert(schema.appUser).values({
    businessId: t.businessId,
    locationId: null, // <- lo que deja el formulario por defecto
    name: 'Vendedor sin sucursal',
    username: 'huerfano',
    passwordHash: await argon2.hash('secreto123'),
    role: 'seller',
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'huerfano', password: 'secreto123', business: 'sin-ubicacion' },
  });
  sinUbicacion = login.json().data.accessToken;
  clearAccessCache();
  clearUserCache();
});

afterAll(async () => {
  await app.close();
});

describe('un usuario sin ubicación no rompe la aplicación', () => {
  const pantallas = [
    '/api/v1/products',
    '/api/v1/sales',
    '/api/v1/inventory',
    '/api/v1/cash/registers',
    '/api/v1/reports/summary',
    '/api/v1/reports/cash-z',
  ];

  for (const url of pantallas) {
    it(`${url} responde sin reventar`, async () => {
      const res = await app.inject({ method: 'GET', url, headers: auth(sinUbicacion) });
      expect(res.statusCode, `${url} devolvió ${res.body.slice(0, 120)}`).toBeLessThan(500);
    });
  }

  it('ve el catálogo del negocio, pero sin existencias de ninguna sucursal', async () => {
    /*
      Esto cambió a propósito cuando el catálogo pasó a ser del negocio.

      Antes este usuario recibía una lista vacía, porque los productos se filtraban por
      la ubicación que los había dado de alta. Ese filtro era justo el que dejaba a una
      sucursal entera sin poder vender, así que se quitó: el catálogo es del negocio y
      la existencia es de cada local.

      Para alguien sin ubicación eso significa ver los productos y **no ver stock de
      nadie**, que es lo correcto: no está en ningún sitio desde donde vender. Lo que
      importaba del test original —que no reviente y que no herede existencias ajenas—
      se sigue comprobando aquí.
    */
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: auth(sinUbicacion),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().data.items;
    expect(items).toHaveLength(1);
    expect(items[0].stock).toBeNull();
  });
});

describe('crear un vendedor exige ubicación', () => {
  it('sin ubicación se rechaza con un motivo entendible', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(t.adminToken),
      payload: { name: 'Nuevo', username: 'nuevo1', password: 'secreto123', role: 'seller' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/ubicaci[oó]n/i);
  });

  it('con ubicación se crea', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(t.adminToken),
      payload: {
        name: 'Nuevo',
        username: 'nuevo2',
        password: 'secreto123',
        role: 'seller',
        locationId: t.locationId,
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it('quitarle la ubicación a un vendedor existente también se rechaza', async () => {
    const [u] = await db
      .select({ id: schema.appUser.id })
      .from(schema.appUser)
      .where(eq(schema.appUser.username, 'nuevo2'));
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${u!.id}`,
      headers: auth(t.adminToken),
      payload: { locationId: null },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('el negocio no se queda sin quien lo administre', () => {
  /**
   * Desactivar al último admin de la central, o degradarlo a vendedor, dejaba el negocio
   * sin nadie que pudiera crear usuarios, abrir sucursales ni tocar la configuración — y
   * sin nadie que pudiera deshacerlo desde dentro. Se salía de ahí llamando a soporte
   * para que usara el rescate del panel: un rodeo caro para un descuido de un clic.
   *
   * `platform.ts` ya tenía esta guarda para los operadores principales y no se había
   * trasladado aquí. Es la misma pregunta.
   */
  it('no se puede desactivar al último admin de la central', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${t.adminId}`,
      headers: auth(t.adminToken),
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ultimo_admin');
  });

  it('tampoco degradarlo a vendedor', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${t.adminId}`,
      headers: auth(t.adminToken),
      payload: { role: 'seller' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('con OTRO admin en la central, sí se puede', async () => {
    // La guarda protege al último, no al cargo: nombrar sucesor y retirarse es normal.
    const nuevo = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(t.adminToken),
      payload: {
        name: 'Segundo Admin',
        username: 'admin2',
        password: 'secreto123',
        role: 'admin',
        locationId: t.locationId,
      },
    });
    expect(nuevo.statusCode).toBe(201);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${t.adminId}`,
      headers: auth(t.adminToken),
      payload: { role: 'seller' },
    });
    expect(res.statusCode, res.body).toBe(200);
  });
});
