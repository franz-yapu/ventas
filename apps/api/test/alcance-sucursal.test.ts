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

describe('una venta se registra donde ocurre', () => {
  /** Cuerpo válido de venta; sólo cambia la ubicación en cada caso. */
  function venta(locationId: string, productId = t.productId) {
    return {
      id: crypto.randomUUID(),
      locationId,
      subtotal: '100.00',
      discount: '0',
      total: '100.00',
      paymentMethod: 'cash',
      status: 'completed',
      clientCreatedAt: new Date().toISOString(),
      items: [
        {
          productId,
          productNameSnapshot: 'Producto',
          unitPriceSnapshot: '50.00',
          quantity: 2,
          lineTotal: '100.00',
        },
      ],
    };
  }

  it('la central NO puede grabar una venta en otra sucursal', async () => {
    // El daño concreto: la caja de Norte quedaría esperando un dinero que nadie le
    // entregó, y al cerrar el turno el cajero de allá arrastra un faltante que no
    // cometió.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: auth(t.adminToken),
      payload: venta(norteId),
    });
    expect(res.statusCode).toBe(403);
  });

  it('sí puede vender en la suya', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: auth(t.adminToken),
      payload: venta(t.locationId),
    });
    expect(res.statusCode).toBe(201);
  });

  it('un vendedor de sucursal tampoco puede vender en otra', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: auth(vendedorNorte),
      payload: venta(t.locationId),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('ver todas las sucursales es cosa de administrar, no de estar en la central', () => {
  it('el vendedor de la central NO ve las ventas de las otras sucursales', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sales',
      headers: auth(vendedorCentral),
    });
    expect(res.statusCode).toBe(200);
    const ventas = res.json().data.items as Array<{ locationId: string }>;
    expect(ventas.every((v) => v.locationId !== norteId)).toBe(true);
  });

  it('tampoco los productos ni el stock de las otras', async () => {
    for (const url of ['/api/v1/products', '/api/v1/inventory']) {
      const res = await app.inject({ method: 'GET', url, headers: auth(vendedorCentral) });
      expect(res.statusCode, url).toBe(200);
      const cuerpo = res.json().data;
      const filas = (Array.isArray(cuerpo) ? cuerpo : cuerpo.items) as Array<{
        locationId?: string;
      }>;
      expect(
        filas.every((f) => !f.locationId || f.locationId !== norteId),
        url,
      ).toBe(true);
    }
  });

  it('el admin de la central sí las ve todas', async () => {
    // Se siembra stock en Norte: el helper sólo crea inventario en la central, así que
    // sin esto la comprobación pasaría por falta de datos y no por el alcance.
    await db.insert(schema.inventory).values({
      businessId: t.businessId,
      productId: t.productId,
      locationId: norteId,
      quantity: 7,
      minStock: 1,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/inventory',
      headers: auth(t.adminToken),
    });
    const filas = res.json().data as Array<{ locationId: string }>;
    expect(filas.some((f) => f.locationId === norteId)).toBe(true);

    // Y el vendedor de la central, con ese stock ya existiendo, sigue sin verlo.
    const delVendedor = await app.inject({
      method: 'GET',
      url: '/api/v1/inventory',
      headers: auth(vendedorCentral),
    });
    const suyas = delVendedor.json().data as Array<{ locationId: string }>;
    expect(suyas.some((f) => f.locationId === norteId)).toBe(false);
  });
});

describe('la caja se abre donde está el dinero', () => {
  it('un vendedor de la central no puede operar la caja de otra sucursal', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/cash/current?locationId=${norteId}`,
      headers: auth(vendedorCentral),
    });
    expect(res.statusCode).toBe(200);
    // Se le devuelve la suya, no la que pidió: la petición no falla, simplemente su
    // alcance no se mueve.
    const caja = res.json().data;
    if (caja) expect(caja.locationId).not.toBe(norteId);
  });

  it('abrir caja ignora la ubicación que venga en el cuerpo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cash/open',
      headers: auth(adminNorte),
      payload: { openingAmount: '100.00', locationId: t.locationId },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.locationId).toBe(norteId);
  });
});

describe('mirar el trabajo de otro es supervisar', () => {
  it('la lectura Z es del administrador, no del vendedor', async () => {
    const delVendedor = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/cash-z',
      headers: auth(vendedorNorte),
    });
    expect(delVendedor.statusCode).toBe(403);

    const delAdmin = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/cash-z',
      headers: auth(t.adminToken),
    });
    expect(delAdmin.statusCode).toBe(200);
  });

  it('el panel tampoco: trae cuánto vendió cada vendedor', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/dashboard',
      headers: auth(vendedorCentral),
    });
    expect(res.statusCode).toBe(403);
  });

  it('el vendedor ve SUS cierres de caja, no los de sus compañeros', async () => {
    // adminNorte abrió y cerró un turno en Norte más arriba; vendedorNorte no.
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cash/registers',
      headers: auth(vendedorNorte),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(0);
  });

  it('el admin sí ve los turnos de su sucursal', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cash/registers',
      headers: auth(adminNorte),
    });
    expect(res.json().data.length).toBeGreaterThan(0);
  });

  it('con el id de un turno ajeno en la mano, el vendedor tampoco lo abre', async () => {
    const delAdmin = await app.inject({
      method: 'GET',
      url: '/api/v1/cash/registers',
      headers: auth(adminNorte),
    });
    const turnoAjeno = delAdmin.json().data[0].id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/cash/registers/${turnoAjeno}`,
      headers: auth(vendedorNorte),
    });
    expect(res.statusCode).toBe(404);
  });

  it('su propia caja abierta la sigue viendo entera', async () => {
    const abre = await app.inject({
      method: 'POST',
      url: '/api/v1/cash/open',
      headers: auth(vendedorCentral),
      payload: { openingAmount: '50.00' },
    });
    expect(abre.statusCode).toBe(201);

    const suya = await app.inject({
      method: 'GET',
      url: '/api/v1/cash/current',
      headers: auth(vendedorCentral),
    });
    expect(suya.statusCode).toBe(200);
    expect(suya.json().data.register.openingAmount).toBe('50.00');

    // Y su propio cierre aparece en su historial.
    const mios = await app.inject({
      method: 'GET',
      url: '/api/v1/cash/registers',
      headers: auth(vendedorCentral),
    });
    expect(mios.json().data.length).toBe(1);
  });
});
