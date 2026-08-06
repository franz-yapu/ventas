import { db, schema } from '@ventafacil/db';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearAccessCache } from '../src/lib/subscription.js';
import { auth, createTenant, makeApp, resetDb, type Tenant } from './helpers.js';

/**
 * Alcance de un negocio con DOS sucursales.
 *
 * `admin` significaba dos trabajos distintos según dónde estuviera la persona: el dueño,
 * que está en la central, y el encargado de una sucursal. Como los dos se comprobaban
 * igual, el encargado de una sucursal podía renombrar el negocio, cambiarle el impuesto,
 * abrir sucursales nuevas y crear usuarios en la central — y desde ahí, verlo todo.
 *
 * Y en paralelo: la pantalla de Productos escondía el costo a los vendedores, pero el
 * servidor se lo mandaba igual. Esconder en el dibujo no es proteger.
 *
 * Estos tests fijan las dos fronteras.
 */

let app: FastifyInstance;
let t: Tenant;

/** Sucursal Norte, que NO es la central. */
let norteId: string;
let adminNorte = '';
let vendedorNorte = '';
/** Vendedor de la central, para el caso del costo. */
let vendedorCentral = '';

async function entrar(username: string, password = 'secreto123') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password, business: t.slug },
  });
  const token = res.json().data?.accessToken;
  if (!token) throw new Error(`No se pudo entrar como ${username}: ${res.body}`);
  return token as string;
}

beforeAll(async () => {
  app = await makeApp();
  await resetDb();
  t = await createTenant(app, 'dos-sucursales');

  const [norte] = await db
    .insert(schema.location)
    .values({ businessId: t.businessId, name: 'Sucursal Norte', isCentral: false })
    .returning();
  norteId = norte!.id;

  const hash = await argon2.hash('secreto123');
  await db.insert(schema.appUser).values([
    {
      businessId: t.businessId,
      locationId: norteId,
      name: 'Admin Norte',
      username: 'admin.norte',
      passwordHash: hash,
      role: 'admin',
    },
    {
      businessId: t.businessId,
      locationId: norteId,
      name: 'Vendedor Norte',
      username: 'vendedor.norte',
      passwordHash: hash,
      role: 'seller',
    },
    {
      businessId: t.businessId,
      locationId: t.locationId,
      name: 'Vendedor Central',
      username: 'vendedor.central',
      passwordHash: hash,
      role: 'seller',
    },
  ]);

  adminNorte = await entrar('admin.norte');
  vendedorNorte = await entrar('vendedor.norte');
  vendedorCentral = await entrar('vendedor.central');
  clearAccessCache();
});

afterAll(async () => {
  await app.close();
});

describe('el costo no sale del servidor para un vendedor', () => {
  it('el admin sí ve costo y costo por mayor', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: auth(t.adminToken),
    });
    expect(res.statusCode).toBe(200);
    const p = res.json().data.items[0];
    expect(p).toHaveProperty('cost');
    expect(p).toHaveProperty('costWholesale');
  });

  it('el vendedor NO los recibe: no están en la respuesta, ni en null', async () => {
    for (const [quien, token] of [
      ['central', vendedorCentral],
      ['norte', vendedorNorte],
    ] as const) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/products',
        headers: auth(token),
      });
      expect(res.statusCode, quien).toBe(200);
      for (const p of res.json().data.items) {
        expect(p, quien).not.toHaveProperty('cost');
        expect(p, quien).not.toHaveProperty('costWholesale');
      }
      // Ni el número suelto por ningún lado del cuerpo: el helper de test crea el
      // producto con costo 50.00 y precio 100.00.
      expect(res.body, quien).not.toContain('"cost"');
    }
  });

  it('el vendedor tampoco puede pedir la ganancia por el otro camino', async () => {
    // Mismo dato, otra puerta: /reports/summary devuelve `profit` y sólo pedía estar
    // autenticado. Que no salga en su menú no cerraba nada.
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/summary',
      headers: auth(vendedorNorte),
    });
    expect(res.statusCode).toBe(403);
  });

  it('el admin sí puede pedirla', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/summary',
      headers: auth(t.adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.profit).toBeDefined();
  });
});

describe('el encargado de una sucursal no manda en el negocio', () => {
  it('no puede cambiar la configuración del negocio', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/business',
      headers: auth(adminNorte),
      payload: { name: 'Nombre secuestrado', taxRate: '0.99' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('tampoco el tope de descuento, que rige para TODOS los vendedores', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/business',
      headers: auth(adminNorte),
      payload: { maxSellerDiscountPct: 100 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('no puede abrir sucursales nuevas', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/locations',
      headers: auth(adminNorte),
      payload: { name: 'Sucursal fantasma' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('no puede desactivar la sucursal de al lado', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/locations/${t.locationId}`,
      headers: auth(adminNorte),
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(403);
  });

  it('el admin de la central sí puede todo eso', async () => {
    const conf = await app.inject({
      method: 'PATCH',
      url: '/api/v1/business',
      headers: auth(t.adminToken),
      payload: { name: 'Nombre nuevo legítimo' },
    });
    expect(conf.statusCode).toBe(200);
  });
});

describe('el encargado sólo administra a la gente de su sucursal', () => {
  it('ve únicamente los usuarios de su sucursal', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: auth(adminNorte),
    });
    expect(res.statusCode).toBe(200);
    const usuarios = res.json().data as Array<{ username: string; locationId: string }>;
    expect(usuarios.every((u) => u.locationId === norteId)).toBe(true);
    expect(usuarios.map((u) => u.username)).not.toContain('admin');
  });

  it('la central los ve todos', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: auth(t.adminToken),
    });
    const nombres = (res.json().data as Array<{ username: string }>).map((u) => u.username);
    expect(nombres).toContain('admin');
    expect(nombres).toContain('vendedor.norte');
  });

  it('no puede crear un usuario en OTRA sucursal', async () => {
    // El escalón que esto cierra: crear un usuario en la central, entrar con él y ver
    // el negocio entero.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(adminNorte),
      payload: {
        name: 'Infiltrado',
        username: 'infiltrado',
        password: 'secreto123',
        role: 'admin',
        locationId: t.locationId,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('sí puede crear uno en la suya', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(adminNorte),
      payload: {
        name: 'Vendedor Nuevo',
        username: 'vendedor.nuevo',
        password: 'secreto123',
        role: 'seller',
        locationId: norteId,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.locationId).toBe(norteId);
  });

  it('no puede tocar a un usuario de otra sucursal', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${t.adminId}`,
      headers: auth(adminNorte),
      payload: { password: 'la-cambio-yo-123' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('no puede mover a uno de los suyos a otra sucursal', async () => {
    const suyos = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: auth(adminNorte),
    });
    const vendedor = (suyos.json().data as Array<{ id: string; username: string }>).find(
      (u) => u.username === 'vendedor.norte',
    )!;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${vendedor.id}`,
      headers: auth(adminNorte),
      payload: { locationId: t.locationId },
    });
    expect(res.statusCode).toBe(403);
  });

  it('la central sí puede mover gente entre sucursales', async () => {
    const todos = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: auth(t.adminToken),
    });
    const vendedor = (todos.json().data as Array<{ id: string; username: string }>).find(
      (u) => u.username === 'vendedor.central',
    )!;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${vendedor.id}`,
      headers: auth(t.adminToken),
      payload: { locationId: norteId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.locationId).toBe(norteId);
  });
});
