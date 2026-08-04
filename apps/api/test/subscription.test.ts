import { db, schema } from '@ventafacil/db';
import type { SubscriptionStatus } from '@ventafacil/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearAccessCache } from '../src/lib/subscription.js';
import { auth, createTenant, makeApp, resetDb, type Tenant } from './helpers.js';

/**
 * Suscripciones: quién puede vender, quién no, y hasta dónde llega su plan.
 *
 * Lo que se está protegiendo aquí son dos errores caros y opuestos:
 *   1. Dejar operar gratis a quien ya no paga.
 *   2. Dejar SIN VENDER a quien sí paga. En un POS eso es el día de caja del cliente,
 *      así que hay casos explícitos para la morosidad y para el negocio sin
 *      suscripción — los dos siguen vendiendo.
 */

/** Planes de laboratorio, para probar los límites sin tener que crear 500 filas. */
const PLAN_MINI = 'test_mini'; // cupos de 1
const PLAN_DOS = 'test_dos'; // cupos de 2

let app: FastifyInstance;
let a: Tenant;
let b: Tenant;

async function darPlan(
  businessId: string,
  planCode: string,
  status: SubscriptionStatus,
  trialEndsAt: Date | null = null,
) {
  await db
    .insert(schema.subscription)
    .values({ businessId, planCode, status, trialEndsAt })
    .onConflictDoUpdate({
      target: schema.subscription.businessId,
      set: { planCode, status, trialEndsAt },
    });
  clearAccessCache();
}

async function sinSuscripcion(businessId: string) {
  await db.delete(schema.subscription).where(eq(schema.subscription.businessId, businessId));
  clearAccessCache();
}

const ayer = () => new Date(Date.now() - 86_400_000);
const enUnaSemana = () => new Date(Date.now() + 7 * 86_400_000);

beforeAll(async () => {
  app = await makeApp();
  await resetDb();

  await db
    .insert(schema.plan)
    .values([
      {
        code: PLAN_MINI,
        name: 'Mini (test)',
        description: 'Plan de laboratorio',
        priceMonthly: '1.00',
        maxLocations: 1,
        maxUsers: 1,
        maxProducts: 1,
        features: [],
        isPublic: false,
        sortOrder: 100,
      },
      {
        code: PLAN_DOS,
        name: 'Dos (test)',
        description: 'Plan de laboratorio',
        priceMonthly: '2.00',
        maxLocations: 2,
        maxUsers: 2,
        maxProducts: 2,
        features: [],
        isPublic: false,
        sortOrder: 101,
      },
    ])
    .onConflictDoNothing();

  a = await createTenant(app, 'sub-a');
  b = await createTenant(app, 'sub-b');
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  clearAccessCache();
});

describe('estados que dejan operar', () => {
  it('sin fila de suscripción (negocio anterior al SaaS) vende con normalidad', async () => {
    await sinSuscripcion(a.businessId);
    const res = await app.inject({ method: 'GET', url: '/api/v1/products', headers: auth(a.adminToken) });
    expect(res.statusCode).toBe(200);
  });

  it('en prueba vigente, vende', async () => {
    await darPlan(a.businessId, 'basico', 'trial', enUnaSemana());
    const res = await app.inject({ method: 'GET', url: '/api/v1/products', headers: auth(a.adminToken) });
    expect(res.statusCode).toBe(200);
  });

  it('activa, vende', async () => {
    await darPlan(a.businessId, 'pro', 'active');
    const res = await app.inject({ method: 'GET', url: '/api/v1/products', headers: auth(a.adminToken) });
    expect(res.statusCode).toBe(200);
  });

  it('MOROSA sigue vendiendo: un pago atrasado no puede cerrar la caja del cliente', async () => {
    await darPlan(a.businessId, 'basico', 'past_due');
    const res = await app.inject({ method: 'GET', url: '/api/v1/products', headers: auth(a.adminToken) });
    expect(res.statusCode).toBe(200);
  });
});

describe('estados que bloquean', () => {
  const bloqueantes: Array<[string, () => Promise<void>]> = [
    ['prueba vencida', () => darPlan(a.businessId, 'basico', 'trial', ayer())],
    ['suspendida', () => darPlan(a.businessId, 'basico', 'suspended')],
    ['cancelada', () => darPlan(a.businessId, 'basico', 'cancelled')],
  ];

  for (const [nombre, preparar] of bloqueantes) {
    it(`${nombre}: 402 al listar productos`, async () => {
      await preparar();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/products',
        headers: auth(a.adminToken),
      });
      expect(res.statusCode).toBe(402);
      expect(res.json().code).toBe('subscription_blocked');
    });

    it(`${nombre}: 402 también al ESCRIBIR (no sólo al leer)`, async () => {
      await preparar();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/categories',
        headers: auth(a.adminToken),
        payload: { name: 'Nueva' },
      });
      expect(res.statusCode).toBe(402);
    });
  }

  it('bloqueado, el negocio SIGUE pudiendo ver por qué está bloqueado', async () => {
    await darPlan(a.businessId, 'basico', 'suspended');
    for (const url of ['/api/v1/auth/me', '/api/v1/subscription/me', '/api/v1/business/me']) {
      const res = await app.inject({ method: 'GET', url, headers: auth(a.adminToken) });
      expect(res.statusCode, url).toBe(200);
    }
  });

  it('bloqueado, todavía puede iniciar sesión', async () => {
    await darPlan(a.businessId, 'basico', 'suspended');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'secreto123', business: a.slug },
    });
    expect(res.statusCode).toBe(200);
  });

  it('402 y no 401: el frontend no debe confundirlo con sesión caducada y echar al usuario', async () => {
    await darPlan(a.businessId, 'basico', 'suspended');
    const res = await app.inject({ method: 'GET', url: '/api/v1/sales', headers: auth(a.adminToken) });
    expect(res.statusCode).toBe(402);
    expect(res.statusCode).not.toBe(401);
  });

  it('bloquear a un negocio no afecta al otro', async () => {
    await darPlan(a.businessId, 'basico', 'suspended');
    await darPlan(b.businessId, 'pro', 'active');
    const bloqueado = await app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: auth(a.adminToken),
    });
    const sano = await app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: auth(b.adminToken),
    });
    expect(bloqueado.statusCode).toBe(402);
    expect(sano.statusCode).toBe(200);
  });
});

describe('límites del plan', () => {
  it('el plan mini (1 sucursal) rechaza la segunda con 402 y el cupo concreto', async () => {
    await darPlan(a.businessId, PLAN_MINI, 'active');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/locations',
      headers: auth(a.adminToken),
      payload: { name: 'Sucursal 2' },
    });
    expect(res.statusCode).toBe(402);
    const body = res.json();
    expect(body.code).toBe('plan_limit');
    expect(body.limit).toMatchObject({ key: 'locations', used: 1, max: 1 });
  });

  it('el plan mini (1 producto) rechaza el segundo', async () => {
    await darPlan(a.businessId, PLAN_MINI, 'active');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: auth(a.adminToken),
      payload: { name: 'Producto 2', price: '10.00' },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe('plan_limit');
  });

  it('el plan mini (1 usuario) rechaza el segundo', async () => {
    await darPlan(a.businessId, PLAN_MINI, 'active');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(a.adminToken),
      payload: {
        name: 'Vendedor',
        username: 'vendedor1',
        password: 'secreto123',
        role: 'seller',
        locationId: a.locationId,
      },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe('plan_limit');
  });

  it('con cupo disponible, el alta pasa', async () => {
    await darPlan(a.businessId, 'basico', 'active'); // 3 usuarios, el negocio tiene 1
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(a.adminToken),
      payload: {
        name: 'Vendedor',
        username: 'vendedor2',
        password: 'secreto123',
        role: 'seller',
        locationId: a.locationId,
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it('el plan ilimitado no pone ningún tope', async () => {
    await darPlan(a.businessId, 'ilimitado', 'active');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/locations',
      headers: auth(a.adminToken),
      payload: { name: 'Sucursal ilimitada' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('desactivar libera cupo: lo que no está activo no ocupa plaza', async () => {
    // Se parte de un estado conocido en vez de heredar el de las pruebas anteriores:
    // sólo la central activa, más una sucursal extra -> 2 activas, justo el tope.
    await db
      .update(schema.location)
      .set({ isActive: false })
      .where(and(eq(schema.location.businessId, a.businessId), eq(schema.location.isCentral, false)));
    const [extra] = await db
      .insert(schema.location)
      .values({ businessId: a.businessId, name: 'Sucursal cupo' })
      .returning({ id: schema.location.id });

    await darPlan(a.businessId, PLAN_DOS, 'active');
    const lleno = await app.inject({
      method: 'POST',
      url: '/api/v1/locations',
      headers: auth(a.adminToken),
      payload: { name: 'Sucursal de más' },
    });
    expect(lleno.statusCode, 'con el cupo lleno no debería dejar').toBe(402);

    await db
      .update(schema.location)
      .set({ isActive: false })
      .where(eq(schema.location.id, extra!.id));
    clearAccessCache();

    const conHueco = await app.inject({
      method: 'POST',
      url: '/api/v1/locations',
      headers: auth(a.adminToken),
      payload: { name: 'Sucursal que sí cabe' },
    });
    expect(conHueco.statusCode).toBe(201);
  });
});

describe('funciones por plan', () => {
  it('básico no abre el panel de análisis', async () => {
    await darPlan(a.businessId, 'basico', 'active');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/dashboard',
      headers: auth(a.adminToken),
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe('plan_feature');
  });

  it('básico SÍ abre la bitácora: es el control contra el fraude interno', async () => {
    // Va en todos los planes a propósito. El negocio con empleados es justo el de
    // plan Básico; cobrarle por poder auditarlos sería vender la cerradura aparte.
    await darPlan(a.businessId, 'basico', 'active');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: auth(a.adminToken),
    });
    expect(res.statusCode).toBe(200);
  });

  it('pro sí los abre', async () => {
    await darPlan(a.businessId, 'pro', 'active');
    for (const url of ['/api/v1/reports/dashboard', '/api/v1/audit']) {
      const res = await app.inject({ method: 'GET', url, headers: auth(a.adminToken) });
      expect(res.statusCode, url).toBe(200);
    }
  });

  it('la lectura Z NUNCA se limita: es el cierre de caja, no un extra', async () => {
    await darPlan(a.businessId, 'basico', 'active');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/cash-z',
      headers: auth(a.adminToken),
    });
    expect(res.statusCode).toBe(200);
  });

  it('el negocio sin suscripción conserva todas las funciones', async () => {
    await sinSuscripcion(a.businessId);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: auth(a.adminToken),
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /subscription/me y GET /plans', () => {
  it('devuelve plan, estado, días de prueba y uso de cada cupo', async () => {
    await darPlan(a.businessId, 'basico', 'trial', enUnaSemana());
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/subscription/me',
      headers: auth(a.adminToken),
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.plan.code).toBe('basico');
    expect(d.status).toBe('trial');
    expect(d.blocked).toBe(false);
    expect(d.trialDaysLeft).toBeGreaterThan(0);
    expect(d.usage.users.limit).toBe(3);
    expect(d.usage.locations.used).toBeGreaterThanOrEqual(1);
  });

  it('con la prueba vencida informa trial_expired y bloqueado', async () => {
    await darPlan(a.businessId, 'basico', 'trial', ayer());
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/subscription/me',
      headers: auth(a.adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('trial_expired');
    expect(res.json().data.blocked).toBe(true);
  });

  it('sin suscripción devuelve plan nulo y sin límites', async () => {
    await sinSuscripcion(a.businessId);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/subscription/me',
      headers: auth(a.adminToken),
    });
    const d = res.json().data;
    expect(d.plan).toBeNull();
    expect(d.blocked).toBe(false);
    expect(d.usage.products.limit).toBeNull();
  });

  it('/plans es público y no filtra los planes internos', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/plans' });
    expect(res.statusCode).toBe(200);
    const codes = res.json().data.map((p: { code: string }) => p.code);
    expect(codes).toContain('basico');
    expect(codes).not.toContain('propietario');
    expect(codes).not.toContain(PLAN_MINI);
  });
});
