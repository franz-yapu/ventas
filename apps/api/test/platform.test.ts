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
    // PRINCIPAL: es quien administra a los demás operadores. Los tests de abajo crean
    // uno normal aparte para comprobar que a ése sí se le cierra esa puerta.
    .values({
      email: EMAIL,
      name: 'Operador',
      passwordHash: await argon2.hash(CLAVE),
      isOwner: true,
    })
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
      url: '/api/v1/reports/dashboard',
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
      url: '/api/v1/reports/dashboard',
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

/**
 * Operadores del panel.
 *
 * El rango de PRINCIPAL es lo único que separa "administra clientes" de "administra a
 * quien administra clientes". Lo que se prueba aquí no es el CRUD, sino que esa puerta
 * no se pueda abrir desde fuera ni cerrarse sobre sí misma.
 */
describe('operadores del panel', () => {
  const EMAIL2 = 'segundo@ventafacil.test';
  const CLAVE2 = 'otra-clave-bien-larga';
  let id2 = '';
  let token2 = '';

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/admins',
      headers: auth(token()),
      payload: { email: EMAIL2, name: 'Segundo', password: CLAVE2 },
    });
    id2 = res.json().data.id;
    token2 = (await entrar(EMAIL2, CLAVE2)).json().data.accessToken;
  });

  it('el principal crea operadores, y nacen SIN rango', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/admins',
      headers: auth(token()),
    });
    expect(res.statusCode).toBe(200);
    const segundo = res.json().data.find((o: { id: string }) => o.id === id2);
    expect(segundo.isOwner).toBe(false);
    expect(segundo.isActive).toBe(true);
  });

  it('un operador normal NO administra operadores', async () => {
    for (const [method, url] of [
      ['GET', '/api/v1/platform/admins'],
      ['POST', '/api/v1/platform/admins'],
      ['PATCH', `/api/v1/platform/admins/${id2}`],
    ] as const) {
      const res = await app.inject({
        method,
        url,
        headers: auth(token2),
        payload: { email: 'x@y.test', name: 'X', password: 'clave-larga-12345' },
      });
      expect(res.statusCode, url).toBe(403);
    }
  });

  it('pero sí administra clientes: el rango no le quita lo demás', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/tenants',
      headers: auth(token2),
    });
    expect(res.statusCode).toBe(200);
  });

  /**
   * Suspender a un negocio no es dar soporte.
   *
   * El rescate de contraseña sigue abierto a cualquier operador, porque atender el
   * teléfono lo exige. Cambiarle el plan a un cliente —o suspenderlo, que es cortarle la
   * venta— es una decisión comercial, y quien responde por ella es el principal.
   */
  it('un operador normal no le cambia el plan a un cliente', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/tenants/${a.businessId}/subscription`,
      headers: auth(token2),
      payload: { planCode: 'basico' },
    });
    expect(res.statusCode).toBe(403);

    const delPrincipal = await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/tenants/${a.businessId}/subscription`,
      headers: auth(token()),
      payload: { planCode: 'basico' },
    });
    expect(delPrincipal.statusCode).toBe(200);
  });

  /**
   * Y al que se da de baja se le cierra la puerta EN EL MOMENTO.
   *
   * `requirePlatform` sólo verificaba la firma, así que un operador dado de baja seguía
   * ocho horas con la cartera de clientes en la mano: podía verlos, cambiarles el plan y
   * generar contraseñas temporales de cualquier negocio. Se había construido la puerta
   * para crear operadores desde el panel sin construir la de revocarlos.
   *
   * El test se deja el mundo como lo encontró: da de alta otra vez al operador y renueva
   * su token, porque los casos siguientes cuentan con él.
   */
  it('al operador dado de baja se le cae el token vivo, no a las 8 horas', async () => {
    const antes = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/tenants',
      headers: auth(token2),
    });
    expect(antes.statusCode).toBe(200);

    const baja = await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/admins/${id2}`,
      headers: auth(token()),
      payload: { isActive: false },
    });
    expect(baja.statusCode).toBe(200);

    // Con el MISMO token de antes: ya no vale para nada del panel.
    for (const [method, url] of [
      ['GET', '/api/v1/platform/tenants'],
      ['GET', '/api/v1/platform/metrics'],
      ['GET', '/api/v1/platform/audit'],
      ['POST', `/api/v1/platform/tenants/${a.businessId}/users/${a.adminId}/password`],
    ] as const) {
      const res = await app.inject({ method, url, headers: auth(token2) });
      expect(res.statusCode, url).toBe(401);
    }

    // Y de vuelta: el token viejo sigue muerto aunque se le reactive (se firmó antes),
    // así que se pide uno nuevo para los casos que vienen detrás.
    const alta = await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/admins/${id2}`,
      headers: auth(token()),
      payload: { isActive: true },
    });
    expect(alta.statusCode).toBe(200);
    token2 = (await entrar(EMAIL2, CLAVE2)).json().data.accessToken;
  });

  it('no se puede repetir el correo de otro operador', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/admins',
      headers: auth(token()),
      payload: { email: EMAIL2, name: 'Duplicado', password: 'clave-larga-12345' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('la contraseña de un operador no baja de 12 caracteres', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/admins',
      headers: auth(token()),
      payload: { email: 'corta@ventafacil.test', name: 'Corta', password: 'corta123' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('el principal no puede desactivarse a sí mismo', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/admins/${adminId}`,
      headers: auth(token()),
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(400);
  });

  it('el ÚLTIMO principal no puede quitarse el rango: dejaría la puerta cerrada para todos', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/admins/${adminId}`,
      headers: auth(token()),
      payload: { isOwner: false },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/único operador principal/i);
  });

  it('con otro principal activo, sí puede ceder el rango (y recuperarlo)', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/admins/${id2}`,
      headers: auth(token()),
      payload: { isOwner: true },
    });
    const cede = await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/admins/${adminId}`,
      headers: auth(token()),
      payload: { isOwner: false },
    });
    expect(cede.statusCode).toBe(200);

    // Se devuelve el rango con el token del segundo, que ahora es el principal.
    const vuelve = await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/admins/${adminId}`,
      headers: auth(token2),
      payload: { isOwner: true },
    });
    expect(vuelve.statusCode).toBe(200);
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/admins/${id2}`,
      headers: auth(token()),
      payload: { isOwner: false },
    });
  });

  it('desactivar a un operador le cierra la puerta en la siguiente petición, sin esperar a que caduque su token', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/admins/${id2}`,
      headers: auth(token()),
      payload: { isActive: false },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/me',
      headers: auth(token2),
    });
    expect(res.statusCode).toBe(401);

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/admins/${id2}`,
      headers: auth(token()),
      payload: { isActive: true },
    });
  });

  it('el alta queda en la bitácora, sin la contraseña', async () => {
    const [fila] = await db
      .select()
      .from(schema.platformAuditLog)
      .where(eq(schema.platformAuditLog.action, 'platform_admin_create'))
      .orderBy(desc(schema.platformAuditLog.createdAt))
      .limit(1);
    expect(fila?.adminEmail).toBe(EMAIL);
    expect(JSON.stringify(fila?.afterJson)).not.toContain(CLAVE2);
  });
});

describe('mi cuenta de operador', () => {
  it('cambiar la contraseña exige la actual', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/platform/me/password',
      headers: auth(token()),
      payload: { actual: 'no-es-mi-clave', nueva: 'una-clave-nueva-larga' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('con la actual correcta, la cambia y la anterior deja de servir', async () => {
    const NUEVA = 'clave-de-plataforma-nueva';
    const cambio = await app.inject({
      method: 'PATCH',
      url: '/api/v1/platform/me/password',
      headers: auth(token()),
      payload: { actual: CLAVE, nueva: NUEVA },
    });
    expect(cambio.statusCode).toBe(200);
    expect((await entrar(EMAIL, CLAVE)).statusCode).toBe(401);
    expect((await entrar(EMAIL, NUEVA)).statusCode).toBe(200);

    // Se deja como estaba: los demás casos entran con CLAVE.
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/platform/me/password',
      headers: auth(token()),
      payload: { actual: NUEVA, nueva: CLAVE },
    });
  });

  it('/me dice si soy principal', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/me',
      headers: auth(token()),
    });
    expect(res.json().data.isOwner).toBe(true);
  });
});

describe('días que faltan para el corte', () => {
  it('el listado dice cuántos días quedan de prueba', async () => {
    await db
      .update(schema.subscription)
      .set({ status: 'trial', trialEndsAt: new Date(Date.now() + 3 * 86_400_000) })
      .where(eq(schema.subscription.businessId, b.businessId));
    clearAccessCache();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/tenants',
      headers: auth(token()),
    });
    const fila = res.json().data.find((t: { id: string }) => t.id === b.businessId);
    expect(fila.vence.concepto).toBe('prueba');
    expect(fila.vence.dias).toBe(3);
  });

  it('una prueba vencida da días negativos, no null', async () => {
    await db
      .update(schema.subscription)
      .set({ status: 'trial', trialEndsAt: new Date(Date.now() - 2 * 86_400_000) })
      .where(eq(schema.subscription.businessId, b.businessId));
    clearAccessCache();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/platform/tenants/${b.businessId}`,
      headers: auth(token()),
    });
    expect(res.json().data.vence.dias).toBeLessThan(0);
    expect(res.json().data.subscription.status).toBe('trial_expired');

    await darPlan(b.businessId, 'pro', 'active');
  });
});

describe('renombrar un negocio', () => {
  it('cambia el nombre', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/tenants/${a.businessId}`,
      headers: auth(token()),
      payload: { name: 'Nombre Cambiado' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.name).toBe('Nombre Cambiado');
  });

  it('no deja mudarse a un subdominio ocupado', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/tenants/${a.businessId}`,
      headers: auth(token()),
      payload: { slug: b.slug },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rechaza un subdominio con formato inválido', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/tenants/${a.businessId}`,
      headers: auth(token()),
      payload: { slug: 'Con Mayúsculas Y Espacios' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('el cambio queda en la bitácora con el valor anterior', async () => {
    const [fila] = await db
      .select()
      .from(schema.platformAuditLog)
      .where(eq(schema.platformAuditLog.action, 'tenant_update'))
      .orderBy(desc(schema.platformAuditLog.createdAt))
      .limit(1);
    expect((fila?.beforeJson as { name: string }).name).toBe(`Negocio ${a.slug}`);
  });
});

describe('rescate del acceso de un cliente', () => {
  it('lista los usuarios del negocio para poder decirle cuál era el suyo', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/platform/tenants/${a.businessId}/users`,
      headers: auth(token()),
    });
    expect(res.statusCode).toBe(200);
    const admin = res.json().data.find((u: { id: string }) => u.id === a.adminId);
    expect(admin.username).toBe('admin');
    expect(admin.role).toBe('admin');
    // Ni rastro de la contraseña, ni siquiera del hash.
    expect(JSON.stringify(res.json().data)).not.toContain('passwordHash');
    expect(JSON.stringify(res.json().data)).not.toContain('$argon2');
  });

  it('no mezcla los usuarios de dos negocios', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/platform/tenants/${a.businessId}/users`,
      headers: auth(token()),
    });
    const ids = res.json().data.map((u: { id: string }) => u.id);
    expect(ids).toContain(a.adminId);
    expect(ids).not.toContain(b.adminId);
  });

  it('la contraseña temporal sirve para entrar, y la anterior deja de servir', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/platform/tenants/${a.businessId}/users/${a.adminId}/password`,
      headers: auth(token()),
    });
    expect(res.statusCode).toBe(200);
    const temporal = res.json().data.tempPassword;
    expect(temporal).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);

    const vieja = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'secreto123', business: a.slug },
    });
    expect(vieja.statusCode).toBe(401);

    const nueva = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: temporal, business: a.slug },
    });
    expect(nueva.statusCode).toBe(200);
  });

  it('echa al usuario de las sesiones que tuviera abiertas', async () => {
    const antes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: auth(a.adminToken),
    });
    expect(antes.statusCode).toBe(401);
  });

  it('no toca a un usuario de OTRO negocio aunque se acierte el id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/platform/tenants/${a.businessId}/users/${b.adminId}/password`,
      headers: auth(token()),
    });
    expect(res.statusCode).toBe(404);
  });

  it('queda en la bitácora el hecho, nunca la contraseña', async () => {
    // Se genera una aquí mismo para poder comparar contra la clave EXACTA: buscarla por
    // su forma no sirve, porque un UUID también son grupos separados por guiones.
    const reset = await app.inject({
      method: 'POST',
      url: `/api/v1/platform/tenants/${a.businessId}/users/${a.adminId}/password`,
      headers: auth(token()),
    });
    const temporal = reset.json().data.tempPassword;

    const [fila] = await db
      .select()
      .from(schema.platformAuditLog)
      .where(eq(schema.platformAuditLog.action, 'tenant_user_password_reset'))
      .orderBy(desc(schema.platformAuditLog.createdAt))
      .limit(1);
    expect(fila?.businessId).toBe(a.businessId);
    expect((fila?.afterJson as { username: string }).username).toBe('admin');
    expect(JSON.stringify(fila)).not.toContain(temporal);
  });

  it('un token de NEGOCIO no puede resetear contraseñas de nadie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/platform/tenants/${b.businessId}/users/${b.adminId}/password`,
      headers: auth(b.adminToken),
    });
    expect(res.statusCode).toBe(401);
  });
});
