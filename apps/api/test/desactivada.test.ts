import { db, schema } from '@ventafacil/db';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mesesCumplidos } from '../src/modules/platform.js';
import { auth, createTenant, makeApp, resetDb, type Tenant } from './helpers.js';

/**
 * Lo que encontró el QA punta a punta y los tests no veían.
 *
 * Tres cosas distintas con la misma forma: una promesa que el sistema no cumplía, y que
 * ningún test comprobaba porque todos probaban el camino por el que la promesa se hacía,
 * no el camino por el que se rompía.
 */

let app: FastifyInstance;
let t: Tenant;
let sucursalId = '';
let vendedorToken = '';

beforeAll(async () => {
  app = await makeApp();
  await resetDb();
  t = await createTenant(app, 'desactivada');

  const [suc] = await db
    .insert(schema.location)
    .values({ businessId: t.businessId, name: 'Sucursal que se cierra', isCentral: false })
    .returning();
  sucursalId = suc!.id;

  await db.insert(schema.appUser).values({
    businessId: t.businessId,
    locationId: sucursalId,
    name: 'Vendedor de la sucursal',
    username: 'vendedor.suc',
    passwordHash: await argon2.hash('secreto123'),
    role: 'seller',
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'vendedor.suc', password: 'secreto123', business: t.slug },
  });
  vendedorToken = login.json().data.accessToken;
});

afterAll(async () => {
  await app.close();
});

describe('una sucursal desactivada deja de usarse DE VERDAD', () => {
  /**
   * Al desactivar, el sistema responde "deja de usarse y su historial se conserva". La
   * segunda mitad era cierta; la primera no.
   *
   * El vendedor asignado seguía entrando y grabando ventas con normalidad en un local que
   * el dueño creía cerrado. Y peor: `POST /cash/open` SÍ rechazaba la sucursal inactiva,
   * así que ese efectivo no tenía ningún turno al que colgarse — ventas reales, dinero
   * real, y ni arqueo ni descuadre que lo delatara.
   */
  it('antes de desactivar, la venta entra con normalidad', async () => {
    const res = await vender();
    expect(res.statusCode, res.body.slice(0, 120)).toBe(201);
  });

  it('desactivada, NO se puede vender ahí', async () => {
    await db
      .update(schema.location)
      .set({ isActive: false })
      .where(eq(schema.location.id, sucursalId));

    const res = await vender();
    expect(res.statusCode, 'siguió vendiendo en una sucursal cerrada').not.toBe(201);
  });

  it('y tampoco por el sync, que es la otra puerta', async () => {
    // La cola offline entra por `/sales/sync`, no por `/sales`. Si sólo se cerrara una de
    // las dos, bastaría con perder la conexión para saltarse la restricción.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/sync',
      headers: auth(vendedorToken),
      payload: { sales: [cuerpoDeVenta()] },
    });
    const [r] = res.json().data.results as Array<{ status: string }>;
    expect(r!.status).toBe('error');
  });

  function cuerpoDeVenta() {
    return {
      id: crypto.randomUUID(),
      locationId: sucursalId,
      total: '50.00',
      subtotal: '50.00',
      discount: '0.00',
      paymentMethod: 'cash',
      clientCreatedAt: new Date().toISOString(),
      items: [
        {
          productId: t.productId,
          productNameSnapshot: 'Producto',
          unitPriceSnapshot: '50.00',
          quantity: 1,
          lineTotal: '50.00',
        },
      ],
    };
  }

  function vender() {
    return app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: auth(vendedorToken),
      payload: cuerpoDeVenta(),
    });
  }
});

describe('desactivar por PATCH tiene las mismas guardas que eliminar', () => {
  /**
   * `DELETE /locations/:id` se negaba a tocar la central y a dejar el negocio sin ninguna
   * sucursal activa. El `PATCH` genérico rodeaba las dos: `{"isActive": false}` sobre la
   * central respondía 200 tan campante, y después ni su propio admin podía abrir caja.
   *
   * Ocho puertas cerradas y una abierta dan el mismo resultado que ninguna cerrada.
   */
  it('no se desactiva la sucursal principal', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/locations/${t.locationId}`,
      headers: auth(t.adminToken),
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('es_principal');
  });

  it('ni la única que queda activa', async () => {
    // La sucursal de arriba ya está inactiva, así que la central es la única activa.
    const [otra] = await db
      .insert(schema.location)
      .values({ businessId: t.businessId, name: 'Tercera', isCentral: false })
      .returning();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/locations/${otra!.id}`,
      headers: auth(t.adminToken),
      payload: { isActive: false },
    });
    // Ésta sí se puede: quedan dos activas.
    expect(res.statusCode).toBe(200);
  });

  it('un cuerpo vacío es un 400, no un 500', async () => {
    // Cada 500 escribe "error no controlado" Y manda un aviso por correo: un `{}` mal
    // formado desde cualquier sitio llenaba el buzón de operación.
    for (const url of [
      `/api/v1/locations/${t.locationId}`,
      `/api/v1/users/${t.adminId}`,
      '/api/v1/business',
    ]) {
      const res = await app.inject({
        method: 'PATCH',
        url,
        headers: auth(t.adminToken),
        payload: {},
      });
      expect(res.statusCode, url).toBe(400);
    }
  });
});

describe('una fecha imposible no revienta el servidor', () => {
  /**
   * Regresión del arreglo de zona horaria: `2026-08-32` casa el patrón `AAAA-MM-DD` pero
   * da un `Invalid Date`, y `Intl.formatToParts` lanza con él. El arreglo convirtió un
   * fallo silencioso (informe completo) en un 500 — y cada 500 manda un correo, así que
   * bastaba un rastreador probando URLs para llenar el buzón de operación.
   */
  it.each([['2026-08-32'], ['2026-13-01'], ['0000-00-00'], ['01-08-2026'], ['ayer']])(
    'from=%s responde 400, no 500',
    async (fecha) => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/export/ventas?from=${encodeURIComponent(fecha)}`,
        headers: auth(t.adminToken),
      });
      expect(res.statusCode, res.body.slice(0, 100)).toBe(400);
    },
  );

  it('una fecha que no se entiende NO devuelve el informe completo', async () => {
    // Lo peor de la versión anterior: `?from=2026-02-30` daba 200 con TODO dentro. Alguien
    // pide una semana, recibe dos años, y no tiene forma de notarlo.
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/export/ventas?from=2026-02-30',
      headers: auth(t.adminToken),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('los meses de la devolución se cuentan con el calendario', () => {
  /**
   * Dividir por 30,44 días daba 23,96 en el segundo aniversario exacto: un mes de menos,
   * dinero de más devuelto, y una cuenta que contradice el ejemplo que el cliente leyó al
   * firmar. Discutir eso con alguien que ya se está yendo es lo que la regla venía a
   * evitar.
   */
  it('el segundo aniversario exacto son 24 meses, no 23', () => {
    expect(mesesCumplidos(new Date('2024-08-07T10:00:00Z'), new Date('2026-08-07T10:00:00Z'))).toBe(
      24,
    );
  });

  it('el día antes del aniversario todavía son 23', () => {
    expect(mesesCumplidos(new Date('2024-08-07T10:00:00Z'), new Date('2026-08-06T10:00:00Z'))).toBe(
      23,
    );
  });

  it('cinco años son 60 y no se pasa', () => {
    expect(mesesCumplidos(new Date('2021-08-07T10:00:00Z'), new Date('2026-08-07T10:00:00Z'))).toBe(
      60,
    );
  });

  it('un día 31 en un mes de 30 cuenta el último del mes', () => {
    // Lo que hace cualquiera con un calendario delante.
    expect(mesesCumplidos(new Date('2026-01-31T10:00:00Z'), new Date('2026-03-01T10:00:00Z'))).toBe(
      1,
    );
  });

  it('nunca da negativo', () => {
    expect(mesesCumplidos(new Date('2026-08-07'), new Date('2026-01-01'))).toBe(0);
  });
});
