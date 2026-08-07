import { db, schema } from '@ventafacil/db';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
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

  // Stock del producto del negocio EN NORTE. El helper sólo crea inventario en la
  // central, y sin esto varias comprobaciones pasarían por falta de datos en vez de por
  // el alcance. Va aquí, y no dentro de un test, porque lo necesitan dos.
  await db.insert(schema.inventory).values({
    businessId: t.businessId,
    productId: t.productId,
    locationId: norteId,
    quantity: 7,
    minStock: 1,
  });

  adminNorte = await entrar('admin.norte');
  vendedorNorte = await entrar('vendedor.norte');
  vendedorCentral = await entrar('vendedor.central');
  clearAccessCache();
});

afterAll(async () => {
  await app.close();
});

describe('una sucursal puede vender lo que tiene', () => {
  /**
   * El catálogo es del NEGOCIO; la existencia, de cada sucursal.
   *
   * Antes `/products` filtraba por la ubicación que había dado de alta el producto, así
   * que el vendedor de una sucursal no veía nada de lo creado por la central: Sucursal
   * Norte tenía 57 unidades en 6 productos en su bodega y recibía `items: []`, también
   * buscando por SKU. No podía cobrar. El multi-sucursal, que es lo que distingue al
   * producto, no operaba.
   */
  it('el vendedor de Norte ve el producto creado por la central', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: auth(vendedorNorte),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().data.items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.map((p: { id: string }) => p.id)).toContain(t.productId);
  });

  it('y también buscándolo por SKU', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/products?search=SKU-dos-sucursales',
      headers: auth(vendedorNorte),
    });
    expect(res.json().data.items.length).toBeGreaterThan(0);
  });

  it('el stock que ve es el de SU sucursal, no el de la central', async () => {
    // Lo que hace que el dato sirva para vender: si viera el de la central, prometería
    // existencias que no están en su bodega. Norte tiene 7, sembrado en beforeAll.
    const norte = await app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: auth(vendedorNorte),
    });
    const suyo = norte.json().data.items.find((p: { id: string }) => p.id === t.productId);
    expect(suyo.stock).toBe(7);

    const central = await app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: auth(vendedorCentral),
    });
    const delOtro = central.json().data.items.find((p: { id: string }) => p.id === t.productId);
    expect(delOtro.stock).not.toBe(7);
  });

  it('el admin de la central puede mirar el stock de una sucursal', async () => {
    // Lo que necesita para reponer: ver desde su oficina lo que le falta a Norte.
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/products?locationId=${norteId}`,
      headers: auth(t.adminToken),
    });
    const p = res.json().data.items.find((x: { id: string }) => x.id === t.productId);
    expect(p.stock).toBe(7);
  });

  it('un vendedor NO puede espiar el stock de otra sucursal con ?locationId', async () => {
    // El parámetro es para administrar, no para curiosear: a quien tiene alcance de
    // sucursal se le ignora y sigue viendo el suyo.
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/products?locationId=${t.locationId}`,
      headers: auth(vendedorNorte),
    });
    const p = res.json().data.items.find((x: { id: string }) => x.id === t.productId);
    expect(p.stock).toBe(7);
  });
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
    // Se mueve a `vendedor.nuevo` —creado por el test de más arriba y que no usa nadie—
    // y no a `vendedor.central`, como se hacía antes. Mover a alguien ahora le cierra la
    // sesión, así que hacerlo sobre un usuario del fixture dejaba sin token a media suite.
    const todos = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: auth(t.adminToken),
    });
    const vendedor = (todos.json().data as Array<{ id: string; username: string }>).find(
      (u) => u.username === 'vendedor.nuevo',
    )!;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${vendedor.id}`,
      headers: auth(t.adminToken),
      payload: { locationId: t.locationId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.locationId).toBe(t.locationId);
  });

  /**
   * Y el cambio tiene que surtir efecto YA, no cuando caduque el refresco.
   *
   * `/auth/refresh` copia el rol, la ubicación y `isCentral` del propio token de refresco
   * sin releer la base, y ese token vive 30 días: bajar a un admin a vendedor no le quitaba
   * nada durante un mes. El test se hace sobre un usuario de usar y tirar para no dejar sin
   * sesión al resto del archivo.
   */
  it('bajarle el rango a alguien le cierra la sesión en el momento', async () => {
    const alta = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(t.adminToken),
      payload: {
        name: 'Admin Efímero',
        username: 'admin.efimero',
        password: 'secreto123',
        role: 'admin',
        locationId: t.locationId,
      },
    });
    expect(alta.statusCode).toBe(201);
    const suToken = await entrar('admin.efimero');

    // Con su token todavía en la mano, funciona.
    const antes = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: auth(suToken),
    });
    expect(antes.statusCode).toBe(200);

    const baja = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${alta.json().data.id}`,
      headers: auth(t.adminToken),
      payload: { role: 'seller' },
    });
    expect(baja.statusCode).toBe(200);

    const despues = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: auth(suToken),
    });
    expect(despues.statusCode).toBe(401);
  });

  /**
   * La ubicación tiene que ser DE ESTE NEGOCIO.
   *
   * `puedeAdministrarA` comparaba ubicaciones sin mirar de quién son, y para la central
   * devolvía `true` sin más: mandando el `locationId` de otro negocio se creaba un usuario
   * con el `business_id` de uno y la ubicación de otro, que al entrar recibía un token con
   * `isCentral: true` heredado de una sucursal ajena.
   */
  it('no se puede crear un usuario en la sucursal de otro negocio', async () => {
    const otro = await createTenant(app, 'negocio-ajeno');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(t.adminToken),
      payload: {
        name: 'Cruzado',
        username: 'cruzado',
        password: 'secreto123',
        role: 'seller',
        locationId: otro.locationId,
      },
    });
    expect(res.statusCode).toBe(400);

    // Ni moviendo a uno que ya existe.
    const mover = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${t.adminId}`,
      headers: auth(t.adminToken),
      payload: { locationId: otro.locationId },
    });
    expect(mover.statusCode).toBe(400);
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

  it('un vendedor de la central que pide la de Norte NO recibe la de Norte', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/cash/current?locationId=${norteId}`,
      headers: auth(vendedorCentral),
    });
    // No falla: simplemente su alcance no se mueve. Como en la central no hay ninguna
    // caja abierta, lo que recibe es "no hay", nunca la del otro local.
    expect(res.statusCode).toBe(200);
    const caja = res.json().data;
    expect(caja?.register?.locationId ?? null).not.toBe(norteId);
  });

  it('el encargado de Norte sí recibe la suya', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cash/current',
      headers: auth(adminNorte),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.register.locationId).toBe(norteId);
  });

  it('y el admin de la CENTRAL sí puede pedir la de Norte', async () => {
    // El camino positivo que el cambio conserva a propósito —el dueño supervisa el
    // negocio entero— y que no verificaba nadie: si `viewScope` empezara a devolver una
    // ubicación también para la central, sólo fallarían los 403 y esto seguiría verde.
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/cash/current?locationId=${norteId}`,
      headers: auth(t.adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.register.locationId).toBe(norteId);
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

  it('el vendedor no puede pedir las ventas de un compañero con ?userId', async () => {
    /*
      El mismo razonamiento de los cierres de caja, que aquí no se había aplicado: el
      filtro `?userId=` se empujaba a la consulta tal cual, sin mirar quién preguntaba.
      Bastaba con poner el id del de al lado para sacar sus ventas y su total.

      No responde 403 —pedirlas suele ser una pantalla mal enlazada, no un ataque—: le
      devuelve las suyas.
    */
    const compañero = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: auth(adminNorte),
    });
    const otro = compañero
      .json()
      .data.find((u: { username: string }) => u.username === 'admin.norte');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/sales?userId=${otro.id}`,
      headers: auth(vendedorNorte),
    });
    expect(res.statusCode).toBe(200);
    const ventas = res.json().data.items as Array<{ sellerName: string }>;
    expect(
      ventas.every((v) => v.sellerName !== 'Admin Norte'),
      'le llegaron ventas del compañero que pidió',
    ).toBe(true);
  });

  it('el admin sí puede filtrar por vendedor: es su trabajo', async () => {
    const usuarios = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: auth(t.adminToken),
    });
    const alguien = usuarios.json().data[0];

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/sales?userId=${alguien.id}`,
      headers: auth(t.adminToken),
    });
    expect(res.statusCode).toBe(200);
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

/**
 * Las otras tres puertas del costo.
 *
 * El arreglo original cerró la lista de productos y dio el asunto por terminado, pero el
 * mismo dato salía por el detalle de una venta, por el historial de un producto y por la
 * exportación del negocio. Ocho puertas cerradas y una abierta dan el mismo resultado que
 * ninguna cerrada, así que cada una tiene aquí su test.
 */
describe('el costo tampoco sale por las otras puertas', () => {
  it('el detalle de una venta: el admin ve el costo congelado, el vendedor no', async () => {
    const delAdmin = await app.inject({
      method: 'GET',
      url: `/api/v1/sales/${t.saleId}`,
      headers: auth(t.adminToken),
    });
    expect(delAdmin.statusCode).toBe(200);
    expect(delAdmin.json().data.items[0]).toHaveProperty('unitCostSnapshot', '50.00');

    const delVendedor = await app.inject({
      method: 'GET',
      url: `/api/v1/sales/${t.saleId}`,
      headers: auth(vendedorCentral),
    });
    // Puede abrir el recibo —es una venta de su ubicación— pero sin el margen.
    expect(delVendedor.statusCode).toBe(200);
    for (const it of delVendedor.json().data.items) {
      expect(it).not.toHaveProperty('unitCostSnapshot');
    }
    expect(delVendedor.body).not.toContain('"unitCostSnapshot"');
    expect(delVendedor.body).not.toContain('50.00');
  });

  it('el historial de un producto: el costo viaja dentro del `after` de la auditoría', async () => {
    // Una edición deja en `audit_log` las dos versiones ENTERAS de la fila, costo incluido.
    const editar = await app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${t.productId}`,
      headers: auth(t.adminToken),
      payload: { name: 'Producto secreto de dos-sucursales', price: '110.00' },
    });
    expect(editar.statusCode).toBe(200);

    const delAdmin = await app.inject({
      method: 'GET',
      url: `/api/v1/products/${t.productId}/history`,
      headers: auth(t.adminToken),
    });
    expect(delAdmin.statusCode).toBe(200);
    // Se comprueba que la fuga EXISTE para el admin: si no, el test del vendedor
    // pasaría por no haber nada que esconder y no probaría nada.
    expect(delAdmin.body).toContain('"cost"');

    const delVendedor = await app.inject({
      method: 'GET',
      url: `/api/v1/products/${t.productId}/history`,
      headers: auth(vendedorCentral),
    });
    expect(delVendedor.statusCode).toBe(200);
    expect(delVendedor.body).not.toContain('"cost"');
    expect(delVendedor.body).not.toContain('"costWholesale"');
    for (const e of delVendedor.json().data) {
      if (e.before) expect(e.before).not.toHaveProperty('cost');
      if (e.after) expect(e.after).not.toHaveProperty('cost');
    }
  });

  it('la exportación del negocio es de la central, no del encargado de sucursal', async () => {
    // Con `requireAdmin` a secas, `admin.norte` se descargaba en un JSON las ventas de la
    // central, sus usuarios y los productos con costo: la exportación anulaba de un golpe
    // todos los filtros de alcance que este archivo comprueba uno por uno.
    const suSucursal = await app.inject({
      method: 'GET',
      url: '/api/v1/business/export',
      headers: auth(adminNorte),
    });
    expect(suSucursal.statusCode).toBe(403);

    const central = await app.inject({
      method: 'GET',
      url: '/api/v1/business/export',
      headers: auth(t.adminToken),
    });
    expect(central.statusCode).toBe(200);

    const vendedor = await app.inject({
      method: 'GET',
      url: '/api/v1/business/export',
      headers: auth(vendedorCentral),
    });
    expect(vendedor.statusCode).toBe(403);
  });
});

/**
 * El reverso del mismo cambio: esconderle el costo al vendedor no puede dejar sin costo a
 * la venta.
 *
 * El POS arma la línea con lo que tiene en su catálogo. Como al vendedor ya no le llega el
 * costo, su venta llegaba sin él y se guardaba en NULL; los reportes cuentan
 * `COALESCE(costo, 0)`, así que cada venta suya declaraba como ganancia el precio entero.
 * No fallaba nada: sólo salía mal el número con el que el dueño decide. Y no se arregla
 * después, porque `unit_cost_snapshot` es histórico.
 */
describe('el costo de la venta lo pone el servidor', () => {
  /** La línea tal como la manda el POS de un vendedor: sin costo, porque no lo tiene. */
  function venta(extra: Record<string, unknown> = {}) {
    return {
      id: crypto.randomUUID(),
      locationId: t.locationId,
      status: 'completed' as const,
      subtotal: '110.00',
      discount: '0',
      total: '110.00',
      paymentMethod: 'cash' as const,
      clientCreatedAt: new Date().toISOString(),
      items: [
        {
          productId: t.productId,
          productNameSnapshot: 'Producto secreto de dos-sucursales',
          unitPriceSnapshot: '110.00',
          quantity: 1,
          lineTotal: '110.00',
          ...extra,
        },
      ],
    };
  }

  async function costoGuardado(saleId: string) {
    const filas = await db
      .select({ costo: schema.saleItem.unitCostSnapshot })
      .from(schema.saleItem)
      .where(eq(schema.saleItem.saleId, saleId));
    return filas[0]?.costo ?? null;
  }

  it('la venta de un vendedor guarda el costo del producto, no NULL', async () => {
    const payload = venta();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: auth(vendedorCentral),
      payload,
    });
    expect(res.statusCode).toBe(201);
    expect(await costoGuardado(payload.id)).toBe('50.00');
  });

  it('y no se cree el costo que le mande un vendedor: no tiene de dónde sacarlo', async () => {
    const payload = venta({ unitCostSnapshot: '1.00' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: auth(vendedorCentral),
      payload,
    });
    expect(res.statusCode).toBe(201);
    expect(await costoGuardado(payload.id)).toBe('50.00');
  });

  it('al admin sí se le respeta el suyo: su copia offline es del momento de la venta', async () => {
    const payload = venta({ unitCostSnapshot: '42.00' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: auth(t.adminToken),
      payload,
    });
    expect(res.statusCode).toBe(201);
    expect(await costoGuardado(payload.id)).toBe('42.00');
  });
});

/**
 * Los turnos son de quien los trabaja, no sólo de quien los abrió.
 *
 * El cajón es de la UBICACIÓN y los turnos se relevan: si Ana abre y Beto cierra, es Beto
 * quien cuenta los billetes y quien firma el descuadre. Filtrando sólo por `user_id` —quien
 * abrió— ese turno no le aparecía a Beto ni podía abrir su detalle: se le pedía responder
 * por algo que no podía ni mirar.
 */
describe('el turno también es de quien lo cierra', () => {
  it('el vendedor que releva y cierra ve ese turno en su historial', async () => {
    // En Norte hay una caja abierta por `adminNorte` (la abrió un test de más arriba), y
    // `vendedorNorte` no ha abierto ninguna: su historial está vacío.
    const antes = await app.inject({
      method: 'GET',
      url: '/api/v1/cash/registers',
      headers: auth(vendedorNorte),
    });
    expect(antes.json().data).toHaveLength(0);

    // Llega el relevo y cierra el turno que abrió otra persona.
    const cierre = await app.inject({
      method: 'POST',
      url: '/api/v1/cash/close',
      headers: auth(vendedorNorte),
      payload: { countedAmount: '100.00' },
    });
    expect(cierre.statusCode).toBe(200);

    const despues = await app.inject({
      method: 'GET',
      url: '/api/v1/cash/registers',
      headers: auth(vendedorNorte),
    });
    expect(despues.statusCode).toBe(200);
    const turnos = despues.json().data as Array<{ id: string }>;
    expect(turnos).toHaveLength(1);

    // Y puede abrir su detalle, que es donde está el descuadre que firmó.
    const detalle = await app.inject({
      method: 'GET',
      url: `/api/v1/cash/registers/${turnos[0]!.id}`,
      headers: auth(vendedorNorte),
    });
    expect(detalle.statusCode).toBe(200);
  });

  it('pero el de al lado sigue sin verlo', async () => {
    // `vendedorCentral` no abrió ni cerró ese turno: para él no existe.
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cash/registers',
      headers: auth(vendedorCentral),
    });
    const suyos = res.json().data as Array<{ locationId: string }>;
    expect(suyos.every((c) => c.locationId !== norteId)).toBe(true);
  });
});

/**
 * La pantalla de login es pública y pide la marca del negocio por el subdominio.
 *
 * Lo que sale por ahí lo puede leer cualquiera sin estar autenticado, así que el endpoint
 * devuelve marca y nada más. El comentario del código lo prometía; no había nada que lo
 * comprobara.
 */
describe('el endpoint público de marca sólo da marca', () => {
  it('con un slug que no existe, 404 y sin pistas', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/public/business/no-existe-jamas' });
    expect(res.statusCode).toBe(404);
  });

  it('con uno válido, nombre y tema — pero nada del interior del negocio', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/public/business/${t.slug}` });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.name).toBeTruthy();
    for (const filtracion of [
      'currency',
      'taxRate',
      'maxSellerDiscountPct',
      'textsJson',
      'attributeSchema',
    ]) {
      expect(d, filtracion).not.toHaveProperty(filtracion);
    }
  });
});

/**
 * El sync offline tiene que responder como responde la venta online.
 *
 * Serializaba la excepción tal cual —`"Error: LOCATION_SCOPE"`—, así que el POS no tenía
 * mensaje que enseñar y se filtraban nombres internos al navegador.
 */
describe('el sync traduce sus errores', () => {
  it('una venta en la ubicación de otro vuelve con un motivo legible', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/sync',
      headers: auth(vendedorCentral),
      payload: {
        sales: [
          {
            id: crypto.randomUUID(),
            locationId: norteId,
            status: 'completed',
            subtotal: '100.00',
            discount: '0',
            total: '100.00',
            paymentMethod: 'cash',
            clientCreatedAt: new Date().toISOString(),
            items: [
              {
                productId: t.productId,
                productNameSnapshot: 'Producto',
                unitPriceSnapshot: '100.00',
                quantity: 1,
                lineTotal: '100.00',
              },
            ],
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const [r] = res.json().data.results as Array<{ status: string; error: string }>;
    expect(r!.status).toBe('error');
    expect(r!.error).toBe('Sólo puedes vender en tu propia ubicación');
    // Y nada de tripas del servidor.
    expect(res.body).not.toContain('LOCATION_SCOPE');
    expect(res.body).not.toContain('Error:');
  });
});
