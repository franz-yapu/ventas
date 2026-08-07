import { db, schema } from '@ventafacil/db';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearAccessCache } from '../src/lib/subscription.js';
import { auth, createTenant, makeApp, resetDb, type Tenant } from './helpers.js';

/**
 * Caja / arqueo.
 *
 * Lo que se prueba aquí no es que los endpoints respondan, sino que el ESPERADO sea
 * creíble: que sume lo que entró en efectivo, reste lo que se sacó, y no cuente lo que
 * nunca fue efectivo (fiado, tarjeta) ni lo que se devolvió (anuladas). Un arqueo que
 * descuadra siempre enseña a la gente a ignorar los descuadres.
 */

let app: FastifyInstance;
let t: Tenant;
let otro: Tenant;
/** Vendedor de la misma ubicación: el arqueo lo hace quien está en la caja. */
let vendedorToken: string;

function auth2(token: string) {
  return auth(token);
}

async function abrir(token: string, openingAmount: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/cash/open',
    headers: auth(token),
    payload: { openingAmount },
  });
}

async function cerrar(token: string, countedAmount: string, notes?: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/cash/close',
    headers: auth(token),
    payload: { countedAmount, notes },
  });
}

async function actual(token: string) {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/cash/current',
    headers: auth(token),
  });
  return res.json().data;
}

/** Inserta una venta directamente: el objetivo es el cálculo, no el flujo de venta. */
async function sembrarVenta(opts: {
  tenant: Tenant;
  total: string;
  method: 'cash' | 'card' | 'credit';
  status?: 'completed' | 'cancelled';
  cuando?: Date;
  receipt: number;
}) {
  await db.insert(schema.sale).values({
    id: crypto.randomUUID(),
    businessId: opts.tenant.businessId,
    locationId: opts.tenant.locationId,
    userId: opts.tenant.adminId,
    status: opts.status ?? 'completed',
    subtotal: opts.total,
    total: opts.total,
    paymentMethod: opts.method,
    receiptNumber: opts.receipt,
    clientCreatedAt: opts.cuando ?? new Date(),
  });
}

beforeAll(async () => {
  app = await makeApp();
  await resetDb();
  t = await createTenant(app, 'caja-a');
  otro = await createTenant(app, 'caja-b');

  // Un vendedor en la misma ubicación que el admin.
  await db.insert(schema.appUser).values({
    businessId: t.businessId,
    locationId: t.locationId,
    name: 'Vendedora',
    username: 'vendedora',
    passwordHash: await argon2.hash('secreto123'),
    role: 'seller',
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'vendedora', password: 'secreto123', business: 'caja-a' },
  });
  vendedorToken = login.json().data.accessToken;
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  clearAccessCache();
  // Cada caso arranca sin caja abierta y sin movimientos previos.
  await db.delete(schema.cashRegister).where(eq(schema.cashRegister.businessId, t.businessId));
  await db.delete(schema.cashRegister).where(eq(schema.cashRegister.businessId, otro.businessId));
});

describe('abrir y cerrar', () => {
  it('sin caja abierta, /cash/current devuelve null (no es un error)', async () => {
    expect(await actual(t.adminToken)).toBeNull();
  });

  it('abre con el monto inicial y queda visible', async () => {
    const res = await abrir(t.adminToken, '100.00');
    expect(res.statusCode).toBe(201);

    const c = await actual(t.adminToken);
    expect(c.register.openingAmount).toBe('100.00');
    expect(c.breakdown.expected).toBe('100.00');
    expect(c.register.closedAt).toBeNull();
  });

  it('no deja abrir DOS cajas en la misma ubicación', async () => {
    await abrir(t.adminToken, '100.00');
    const segunda = await abrir(t.adminToken, '50.00');
    expect(segunda.statusCode).toBe(409);
  });

  it('el vendedor de la ubicación también abre y cierra: es quien está en la caja', async () => {
    const abre = await abrir(vendedorToken, '80.00');
    expect(abre.statusCode).toBe(201);
    const cierra = await cerrar(vendedorToken, '80.00');
    expect(cierra.statusCode).toBe(200);
  });

  it('cerrar sin caja abierta responde 409', async () => {
    const res = await cerrar(t.adminToken, '100.00');
    expect(res.statusCode).toBe(409);
  });

  it('tras cerrar, se puede volver a abrir', async () => {
    await abrir(t.adminToken, '100.00');
    await cerrar(t.adminToken, '100.00');
    expect(await actual(t.adminToken)).toBeNull();
    expect((await abrir(t.adminToken, '20.00')).statusCode).toBe(201);
  });

  it('quien cierra queda registrado aunque sea otra persona (los turnos se relevan)', async () => {
    await abrir(t.adminToken, '100.00');
    const res = await cerrar(vendedorToken, '100.00');
    expect(res.statusCode).toBe(200);
    expect(res.json().data.register.closedBy).not.toBe(res.json().data.register.userId);
  });
});

describe('qué cuenta y qué no cuenta como efectivo', () => {
  it('las ventas en EFECTIVO suman al esperado', async () => {
    await abrir(t.adminToken, '100.00');
    await sembrarVenta({ tenant: t, total: '250.00', method: 'cash', receipt: 101 });

    const c = await actual(t.adminToken);
    expect(c.breakdown.cashSales).toBe('250.00');
    expect(c.breakdown.expected).toBe('350.00');
  });

  it('la TARJETA no suma: ese dinero no está en el cajón', async () => {
    await abrir(t.adminToken, '100.00');
    await sembrarVenta({ tenant: t, total: '500.00', method: 'card', receipt: 102 });

    const c = await actual(t.adminToken);
    expect(c.breakdown.expected).toBe('100.00');
    // Pero sí aparece en el desglose del turno, que es la lectura Z.
    expect(c.breakdown.byPaymentMethod.find((r: any) => r.paymentMethod === 'card').total).toBe(
      '500.00',
    );
  });

  it('el FIADO no suma: no entró efectivo', async () => {
    await abrir(t.adminToken, '100.00');
    await sembrarVenta({ tenant: t, total: '300.00', method: 'credit', receipt: 103 });
    expect((await actual(t.adminToken)).breakdown.expected).toBe('100.00');
  });

  it('una venta ANULADA sigue sumando: el billete entró al cajón', async () => {
    /*
      Esto decía lo contrario, y era el agujero.

      Se razonaba que una anulada no cuenta porque "el dinero se devolvió". Pero el
      sistema no sabe si se devolvió: sólo sabe que alguien la marcó como anulada. Y
      como el esperado retrocedía con ella, quedaba una salida limpia: cobrar en
      efectivo, anular, quedarse el billete y cerrar la caja cuadrada. El único control
      que tiene el dueño sobre el cajón borraba su propia prueba.

      Ahora lo que entró se cuenta, y devolverlo es un retiro de caja como cualquier
      otro: registrado, con quién y por qué. El siguiente test lo recorre entero.
    */
    await abrir(t.adminToken, '100.00');
    await sembrarVenta({
      tenant: t,
      total: '400.00',
      method: 'cash',
      status: 'cancelled',
      receipt: 104,
    });
    expect((await actual(t.adminToken)).breakdown.expected).toBe('500.00');
  });

  it('una venta ANTERIOR a la apertura no entra en este turno', async () => {
    await abrir(t.adminToken, '100.00');
    await sembrarVenta({
      tenant: t,
      total: '900.00',
      method: 'cash',
      cuando: new Date(Date.now() - 3 * 3_600_000),
      receipt: 105,
    });
    expect((await actual(t.adminToken)).breakdown.expected).toBe('100.00');
  });

  it('los abonos de fiado en efectivo SÍ suman: ese billete entró al cajón', async () => {
    await abrir(t.adminToken, '100.00');
    await db.insert(schema.customerPayment).values({
      businessId: t.businessId,
      customerId: t.customerId,
      userId: t.adminId,
      amount: '75.00',
      method: 'cash',
    });
    const c = await actual(t.adminToken);
    expect(c.breakdown.cashPayments).toBe('75.00');
    expect(c.breakdown.expected).toBe('175.00');
  });

  it('un abono por transferencia no suma', async () => {
    await abrir(t.adminToken, '100.00');
    await db.insert(schema.customerPayment).values({
      businessId: t.businessId,
      customerId: t.customerId,
      userId: t.adminId,
      amount: '75.00',
      method: 'transfer',
    });
    expect((await actual(t.adminToken)).breakdown.expected).toBe('100.00');
  });
});

describe('movimientos de efectivo', () => {
  async function movimiento(type: 'in' | 'out', amount: string, reason = 'motivo de prueba') {
    return app.inject({
      method: 'POST',
      url: '/api/v1/cash/movements',
      headers: auth(t.adminToken),
      payload: { type, amount, reason },
    });
  }

  it('un RETIRO baja el esperado: si no, saldría como faltante', async () => {
    await abrir(t.adminToken, '500.00');
    const res = await movimiento('out', '200.00', 'Pago al proveedor de llantas');
    expect(res.statusCode).toBe(201);

    const c = await actual(t.adminToken);
    expect(c.breakdown.movementsOut).toBe('200.00');
    expect(c.breakdown.expected).toBe('300.00');
  });

  it('un INGRESO sube el esperado', async () => {
    await abrir(t.adminToken, '100.00');
    await movimiento('in', '50.00', 'Cambio traído del banco');
    expect((await actual(t.adminToken)).breakdown.expected).toBe('150.00');
  });

  it('sin caja abierta no se registran movimientos', async () => {
    const res = await movimiento('out', '10.00');
    expect(res.statusCode).toBe(409);
  });

  it('exige un motivo: un movimiento sin motivo es indistinguible de un faltante', async () => {
    await abrir(t.adminToken, '100.00');
    const res = await movimiento('out', '10.00', 'x');
    expect(res.statusCode).toBe(400);
  });

  it('no admite montos de cero o negativos', async () => {
    await abrir(t.adminToken, '100.00');
    expect((await movimiento('out', '0.00')).statusCode).toBe(400);
    expect((await movimiento('out', '-5.00')).statusCode).toBe(400);
  });
});

describe('un vendedor no cuadra su caja anulando su venta', () => {
  /**
   * El recorrido entero del agujero, con la venta y la anulación pasando por el API de
   * verdad: cobrar 280 en efectivo, anular, y ver qué le queda al dueño.
   */
  async function venderPorApi(token: string, total: string) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: auth(token),
      payload: {
        id: crypto.randomUUID(),
        locationId: t.locationId,
        total,
        subtotal: total,
        discount: '0.00',
        paymentMethod: 'cash',
        clientCreatedAt: new Date().toISOString(),
        items: [
          {
            productId: t.productId,
            productNameSnapshot: 'Producto',
            unitPriceSnapshot: total,
            quantity: 1,
            lineTotal: total,
          },
        ],
      },
    });
  }

  it('anular NO le devuelve el esperado: si se queda el billete, sale el faltante', async () => {
    await abrir(vendedorToken, '5410.00');
    const venta = await venderPorApi(vendedorToken, '280.00');
    expect(venta.statusCode).toBe(201);
    const saleId = venta.json().data.saleId;

    expect((await actual(vendedorToken)).breakdown.expected).toBe('5690.00');

    const anula = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${saleId}/cancel`,
      headers: auth(vendedorToken),
      payload: { reason: 'me equivoqué de producto' },
    });
    expect(anula.statusCode).toBe(200);

    // Antes esto volvía a 5410.00 y la caja cerraba cuadrada con el billete en el
    // bolsillo. Ahora el esperado no se mueve.
    expect((await actual(vendedorToken)).breakdown.expected).toBe('5690.00');

    /*
      Y al cerrar contando lo que hay de verdad, el faltante aparece. Tanto, que el
      propio API se niega a cerrar sin una explicación (`falta_motivo`): antes esto
      cerraba en silencio con diferencia cero.
    */
    const sinMotivo = await cerrar(vendedorToken, '5410.00');
    expect(sinMotivo.statusCode).toBe(400);
    expect(sinMotivo.json().code).toBe('falta_motivo');

    const cierre = await cerrar(vendedorToken, '5410.00', 'anulé una venta y no devolví el dinero');
    expect(cierre.statusCode, cierre.body).toBe(200);
    expect(cierre.json().data.difference).toBe('-280.00');
  });

  it('si devuelve el dinero de verdad y lo registra, el turno cuadra', async () => {
    // La otra mitad: el arreglo no puede castigar a quien hace lo correcto.
    await abrir(vendedorToken, '5410.00');
    const venta = await venderPorApi(vendedorToken, '280.00');
    const saleId = venta.json().data.saleId;

    await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${saleId}/cancel`,
      headers: auth(vendedorToken),
      payload: { reason: 'el cliente se arrepintió' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/cash/movements',
      headers: auth(vendedorToken),
      payload: { type: 'out', amount: '280.00', reason: 'Devolución de la venta anulada' },
    });

    expect((await actual(vendedorToken)).breakdown.expected).toBe('5410.00');
    const cierre = await cerrar(vendedorToken, '5410.00');
    expect(cierre.json().data.difference).toBe('0.00');
  });

  it('la anulación de una venta en efectivo avisa de que hay que devolver', async () => {
    // Para que el POS lo ofrezca en el mismo gesto y no dependa de la memoria.
    await abrir(vendedorToken, '100.00');
    const venta = await venderPorApi(vendedorToken, '55.00');
    const saleId = venta.json().data.saleId;

    const anula = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${saleId}/cancel`,
      headers: auth(vendedorToken),
      payload: { reason: 'producto equivocado' },
    });
    expect(anula.json().data.devolverEfectivo).toBe(true);
    expect(anula.json().data.montoADevolver).toBe('55.00');
  });
});

describe('el cierre y su diferencia', () => {
  it('cuadra: contado = esperado -> diferencia 0', async () => {
    await abrir(t.adminToken, '100.00');
    await sembrarVenta({ tenant: t, total: '150.00', method: 'cash', receipt: 201 });

    const res = await cerrar(t.adminToken, '250.00');
    expect(res.statusCode).toBe(200);
    expect(res.json().data.register.expectedAmount).toBe('250.00');
    expect(res.json().data.difference).toBe('0.00');
  });

  it('FALTA plata: la diferencia sale negativa', async () => {
    await abrir(t.adminToken, '100.00');
    await sembrarVenta({ tenant: t, total: '150.00', method: 'cash', receipt: 202 });

    const res = await cerrar(t.adminToken, '230.00', 'Faltaron 20, se revisa mañana');
    expect(res.json().data.difference).toBe('-20.00');
    expect(res.json().data.register.notes).toContain('Faltaron 20');
  });

  it('SOBRA plata: diferencia positiva', async () => {
    await abrir(t.adminToken, '100.00');
    const res = await cerrar(t.adminToken, '130.00', 'Sobraron 30, se revisa');
    expect(res.json().data.difference).toBe('30.00');
  });

  it('no deja cerrar un descuadre sin explicarlo', async () => {
    await abrir(t.adminToken, '100.00');
    const res = await cerrar(t.adminToken, '130.00');
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('falta_motivo');
  });

  it('cuadrando exacto no hace falta motivo', async () => {
    await abrir(t.adminToken, '100.00');
    expect((await cerrar(t.adminToken, '100.00')).statusCode).toBe(200);
  });

  it('el esperado queda CONGELADO: una venta que llega tarde no reescribe el arqueo', async () => {
    await abrir(t.adminToken, '100.00');
    await sembrarVenta({ tenant: t, total: '50.00', method: 'cash', receipt: 203 });
    const cierre = await cerrar(t.adminToken, '150.00');
    const cajaId = cierre.json().data.register.id;
    expect(cierre.json().data.register.expectedAmount).toBe('150.00');

    // Llega tarde una venta con fecha DENTRO del turno (venta offline que sincroniza
    // después). El cierre de hoy debe seguir diciendo lo mismo que dijo al contarse.
    await sembrarVenta({ tenant: t, total: '999.00', method: 'cash', receipt: 204 });

    const detalle = await app.inject({
      method: 'GET',
      url: `/api/v1/cash/registers/${cajaId}`,
      headers: auth(t.adminToken),
    });
    expect(detalle.json().data.register.expectedAmount).toBe('150.00');
    expect(detalle.json().data.difference).toBe('0.00');
  });
});

describe('historial y aislamiento', () => {
  it('el historial trae los cierres con su diferencia', async () => {
    await abrir(t.adminToken, '100.00');
    await cerrar(t.adminToken, '90.00', 'faltaron 10');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cash/registers',
      headers: auth(t.adminToken),
    });
    expect(res.statusCode).toBe(200);
    const filas = res.json().data;
    expect(filas.length).toBeGreaterThan(0);
    expect(filas[0].difference).toBe('-10.00');
    expect(filas[0].locationName).toContain('caja-a');
  });

  it('un turno abierto aparece en el historial sin diferencia', async () => {
    await abrir(t.adminToken, '100.00');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cash/registers',
      headers: auth(t.adminToken),
    });
    expect(res.json().data[0].difference).toBeNull();
  });

  it('un negocio NO ve las cajas de otro', async () => {
    await abrir(t.adminToken, '111.11');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cash/registers',
      headers: auth(otro.adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json().data)).not.toContain('111.11');
  });

  it('la caja de un negocio no se abre desde otro por id', async () => {
    const abre = await abrir(t.adminToken, '100.00');
    const cajaId = abre.json().data.id;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/cash/registers/${cajaId}`,
      headers: auth(otro.adminToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('la ubicación que venga en el cuerpo se IGNORA: la caja se abre donde está uno', async () => {
    // Antes esto se rechazaba con un 400 comprobando que la ubicación fuera del negocio.
    // Ahora el cuerpo ni se mira: una caja se abre donde está la persona que tiene el
    // dinero delante, igual que una venta se registra donde ocurre. La garantía es más
    // fuerte que antes — no depende de acordarse de validar — y de paso cierra el caso
    // de abrirle un turno a otra sucursal del propio negocio, que sí se podía.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cash/open',
      headers: auth(t.adminToken),
      payload: { openingAmount: '10.00', locationId: otro.locationId },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.locationId).toBe(t.locationId);
    // Lo que de verdad importaba: el otro negocio sigue sin ninguna caja abierta.
    expect(await actual(otro.adminToken)).toBeNull();
  });

  it('cada negocio abre la suya sin estorbarse', async () => {
    expect((await abrir(t.adminToken, '10.00')).statusCode).toBe(201);
    expect((await abrir(otro.adminToken, '20.00')).statusCode).toBe(201);
  });
});
