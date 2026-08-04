import { db, schema } from '@ventafacil/db';
import argon2 from 'argon2';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearAccessCache } from '../src/lib/subscription.js';
import { auth, createTenant, makeApp, resetDb, type Tenant } from './helpers.js';

/**
 * Panel de plataforma.
 *
 * Lo que más importa aquí no es que el panel funcione, sino la FRONTERA: que un token
 * de negocio no pueda mirar por encima de los demás, y que el token del panel no sirva
 * para entrar a un POS. Están firmados con secretos distintos, y estos tests lo
 * comprueban en las dos direcciones.
 */

const EMAIL = 'operador@ventafacil.test';
const CLAVE = 'clave-de-plataforma-larga';

let app: FastifyInstance;
let a: Tenant;
let b: Tenant;
let adminId: string;

async function entrar(email = EMAIL, password = CLAVE) {
  return app.inject({ method: 'POST', url: '/api/v1/platform/login', payload: { email, password } });
}

/**
 * Token del operador, pedido UNA vez. El login está limitado a 20 intentos cada 5
 * minutos por IP (igual que el de los negocios), y pedirlo en cada caso agotaría el
 * cupo y haría fallar la suite por una razón que no es la que se está probando.
 */
let tokenOperador = '';
function token() {
  return tokenOperador;
}

async function darPlan(businessId: string, planCode: string, status: string) {
  await db
    .insert(schema.subscription)
    .values({ businessId, planCode, status: status as never })
    .onConflictDoUpdate({
      target: schema.subscription.businessId,
      set: { planCode, status: status as never },
    });
  clearAccessCache();
}

beforeAll(async () => {
  app = await makeApp();
  await resetDb();
  await db.delete(schema.platformAdmin);

  const [admin] = await db
    .insert(schema.platformAdmin)
    .values({ email: EMAIL, name: 'Operador', passwordHash: await argon2.hash(CLAVE) })
    .returning();
  adminId = admin!.id;
  tokenOperador = (await entrar()).json().data.accessToken;

  a = await createTenant(app, 'plat-a');
  b = await createTenant(app, 'plat-b');
  await darPlan(a.businessId, 'basico', 'active');
  await darPlan(b.businessId, 'pro', 'active');
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  clearAccessCache();
});

describe('la frontera entre negocio y plataforma', () => {
  it('un token de NEGOCIO no entra al panel', async () => {
    for (const url of ['/api/v1/platform/tenants', '/api/v1/platform/metrics', '/api/v1/platform/me']) {
      const res = await app.inject({ method: 'GET', url, headers: auth(a.adminToken) });
      expect(res.statusCode, url).toBe(401);
    }
  });

  it('un token de PLATAFORMA no entra al POS de nadie', async () => {
    const t = token();
    for (const url of ['/api/v1/products', '/api/v1/sales', '/api/v1/auth/me']) {
      const res = await app.inject({ method: 'GET', url, headers: auth(t) });
      expect(res.statusCode, url).toBe(401);
    }
  });

  it('sin token no se entra al panel', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/platform/tenants' });
    expect(res.statusCode).toBe(401);
  });
});

describe('login del operador', () => {
  it('con credenciales correctas devuelve token', async () => {
    const res = await entrar();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.accessToken).toBeTruthy();
    expect(res.json().data.admin.email).toBe(EMAIL);
  });

  it('contraseña incorrecta -> 401', async () => {
    const res = await entrar(EMAIL, 'no-es-esta');
    expect(res.statusCode).toBe(401);
  });

  it('correo inexistente -> 401 con el MISMO mensaje (no revela si existe)', async () => {
    const malo = await entrar('nadie@ventafacil.test', CLAVE);
    const claveMala = await entrar(EMAIL, 'no-es-esta');
    expect(malo.statusCode).toBe(401);
    expect(malo.json().error).toBe(claveMala.json().error);
  });

  it('un correo mal formado tampoco delata nada: mismo 401', async () => {
    const res = await entrar('esto-no-es-un-correo', CLAVE);
    expect(res.statusCode).toBe(401);
  });

  it('operador desactivado no entra', async () => {
    await db
      .update(schema.platformAdmin)
      .set({ isActive: false })
      .where(eq(schema.platformAdmin.id, adminId));
    const res = await entrar();
    expect(res.statusCode).toBe(401);
    await db
      .update(schema.platformAdmin)
      .set({ isActive: true })
      .where(eq(schema.platformAdmin.id, adminId));
  });
});

describe('listado de negocios', () => {
  it('lista todos los tenants con su plan y estado', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/tenants',
      headers: auth(token()),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data;
    expect(rows).toHaveLength(2);
    const porSlug = Object.fromEntries(rows.map((r: { slug: string }) => [r.slug, r]));
    expect(porSlug['plat-a'].planCode).toBe('basico');
    expect(porSlug['plat-b'].planName).toBe('Pro');
  });

  it('la búsqueda filtra por nombre o slug', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/tenants?search=plat-b',
      headers: auth(token()),
    });
    expect(res.json().data).toHaveLength(1);
    expect(res.json().data[0].slug).toBe('plat-b');
  });

  it('el detalle cuenta el uso real del negocio, que vive bajo RLS', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/platform/tenants/${a.businessId}`,
      headers: auth(token()),
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.business.slug).toBe('plat-a');
    expect(d.usage.users).toBe(1);
    expect(d.usage.locations).toBe(1);
    expect(d.usage.products).toBe(1);
    expect(d.usage.sales).toBe(1);
  });

  it('un negocio inexistente da 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/tenants/00000000-0000-0000-0000-000000000000',
      headers: auth(token()),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('suspender y reactivar', () => {
  it('suspender corta al tenant AL INSTANTE, sin esperar a que caduque la caché', async () => {
    // Se calienta la caché con el negocio operando: si la invalidación no funcionara,
    // el tenant seguiría vendiendo hasta un minuto después.
    const antes = await app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: auth(a.adminToken),
    });
    expect(antes.statusCode).toBe(200);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/tenants/${a.businessId}/subscription`,
      headers: auth(token()),
      payload: { status: 'suspended', suspendedReason: 'Falta de pago de julio' },
    });
    expect(patch.statusCode).toBe(200);

    const despues = await app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: auth(a.adminToken),
    });
    expect(despues.statusCode).toBe(402);
    expect(despues.json().code).toBe('subscription_blocked');
  });

  it('suspender a uno no toca al otro', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: auth(b.adminToken),
    });
    expect(res.statusCode).toBe(200);
  });

  it('reactivar devuelve el servicio al instante y limpia el motivo', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/tenants/${a.businessId}/subscription`,
      headers: auth(token()),
      payload: { status: 'active' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.suspendedReason).toBeNull();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: auth(a.adminToken),
    });
    expect(res.statusCode).toBe(200);
  });

  it('cancelar deja fecha de baja; reactivar la borra', async () => {
    const t = token();
    const baja = await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/tenants/${a.businessId}/subscription`,
      headers: auth(t),
      payload: { status: 'cancelled' },
    });
    expect(baja.json().data.cancelledAt).toBeTruthy();

    const alta = await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/tenants/${a.businessId}/subscription`,
      headers: auth(t),
      payload: { status: 'active' },
    });
    expect(alta.json().data.cancelledAt).toBeNull();
  });
});

describe('cambio de plan', () => {
  it('subir de plan abre las funciones del plan nuevo al instante', async () => {
    await darPlan(a.businessId, 'basico', 'active');
    const cerrado = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: auth(a.adminToken),
    });
    expect(cerrado.statusCode).toBe(402);

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/tenants/${a.businessId}/subscription`,
      headers: auth(token()),
      payload: { planCode: 'pro' },
    });

    const abierto = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: auth(a.adminToken),
    });
    expect(abierto.statusCode).toBe(200);
  });

  it('un plan que no existe se rechaza con 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/tenants/${a.businessId}/subscription`,
      headers: auth(token()),
      payload: { planCode: 'plan_inventado' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('a un negocio sin suscripción se le puede asignar una', async () => {
    await db.delete(schema.subscription).where(eq(schema.subscription.businessId, b.businessId));
    clearAccessCache();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/tenants/${b.businessId}/subscription`,
      headers: auth(token()),
      payload: { planCode: 'ilimitado', status: 'active' },
    });
    expect(res.statusCode).toBe(200); // se crea la fila y se devuelve
    expect(res.json().data.planCode).toBe('ilimitado');
  });

  it('sin plan y sin suscripción previa, se pide el plan', async () => {
    await db.delete(schema.subscription).where(eq(schema.subscription.businessId, b.businessId));
    clearAccessCache();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/tenants/${b.businessId}/subscription`,
      headers: auth(token()),
      payload: { status: 'active' },
    });
    expect(res.statusCode).toBe(400);
    await darPlan(b.businessId, 'pro', 'active');
  });
});

describe('métricas', () => {
  it('el MRR suma sólo lo que está al día; lo moroso va aparte', async () => {
    await darPlan(a.businessId, 'basico', 'active'); // 149
    await darPlan(b.businessId, 'pro', 'past_due'); // 299, en riesgo

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/metrics',
      headers: auth(token()),
    });
    expect(res.statusCode).toBe(200);
    const m = res.json().data;
    expect(m.mrr).toBe('149.00');
    expect(m.mrrEnRiesgo).toBe('299.00');
    expect(m.porEstado.active).toBe(1);
    expect(m.porEstado.past_due).toBe(1);
    expect(m.totalNegocios).toBe(2);
  });

  it('una prueba vencida no cuenta como ingreso', async () => {
    await db
      .update(schema.subscription)
      .set({ status: 'trial', trialEndsAt: new Date(Date.now() - 86_400_000) })
      .where(eq(schema.subscription.businessId, a.businessId));
    clearAccessCache();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/metrics',
      headers: auth(token()),
    });
    const m = res.json().data;
    expect(m.mrr).toBe('0.00');
    expect(m.porEstado.trial_expired).toBe(1);
    await darPlan(a.businessId, 'basico', 'active');
  });
});

describe('bitácora de la plataforma', () => {
  it('cada cambio queda registrado con el operador y el negocio', async () => {
    const t = token();
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/tenants/${a.businessId}/subscription`,
      headers: auth(t),
      payload: { status: 'suspended', suspendedReason: 'prueba de bitácora' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/audit',
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const ultima = res.json().data[0];
    expect(ultima.action).toBe('subscription_update');
    expect(ultima.adminEmail).toBe(EMAIL);
    expect(ultima.businessId).toBe(a.businessId);
    expect(ultima.afterJson.status).toBe('suspended');

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/tenants/${a.businessId}/subscription`,
      headers: auth(t),
      payload: { status: 'active' },
    });
  });

  it('el login del operador también se registra', async () => {
    await entrar();
    const [fila] = await db
      .select()
      .from(schema.platformAuditLog)
      .where(eq(schema.platformAuditLog.action, 'platform_login'))
      .orderBy(desc(schema.platformAuditLog.createdAt))
      .limit(1);
    expect(fila?.adminEmail).toBe(EMAIL);
  });
});
