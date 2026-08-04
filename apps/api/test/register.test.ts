import { db, schema } from '@ventafacil/db';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashToken } from '../src/lib/auth-tokens.js';
import { clearAccessCache } from '../src/lib/subscription.js';
import { auth, makeApp, resetDb } from './helpers.js';

/**
 * Registro self-service y recuperación de contraseña.
 *
 * Los dos puntos delicados:
 *   · El alta corre SIN tenant y tiene que dejar el negocio listo para vender —
 *     incluido el contador de recibos, sin el cual la primera venta falla.
 *   · La recuperación no puede revelar quién tiene cuenta, y el enlace debe valer una
 *     sola vez. En la base sólo se guarda el hash del token.
 */

let app: FastifyInstance;

const ALTA = {
  businessName: 'Ferretería Nueva',
  slug: 'ferreteria-nueva',
  adminName: 'Ana Quispe',
  email: 'ana@ferreteria.test',
  username: 'ana',
  password: 'clave-segura-1',
};

async function registrar(cambios: Partial<typeof ALTA> = {}) {
  return app.inject({ method: 'POST', url: '/api/v1/register', payload: { ...ALTA, ...cambios } });
}

/** Último token emitido a un usuario. Sólo existe su hash, así que se busca por él. */
async function tokenDe(userId: string, purpose: 'password_reset' | 'email_verify', token: string) {
  const [fila] = await db
    .select()
    .from(schema.authToken)
    .where(and(eq(schema.authToken.userId, userId), eq(schema.authToken.purpose, purpose)))
    .orderBy(desc(schema.authToken.createdAt))
    .limit(1);
  return fila && fila.tokenHash === hashToken(token) ? fila : null;
}

/** Saca el token del enlace que el driver de consola escribió en el log. */
function tokenDelLog(spy: ReturnType<typeof vi.spyOn>): string | null {
  for (let i = spy.mock.calls.length - 1; i >= 0; i--) {
    const arg = spy.mock.calls[i]?.[0] as { cuerpo?: string } | undefined;
    const m = arg?.cuerpo?.match(/token=([A-Za-z0-9_-]+)/);
    if (m) return m[1]!;
  }
  return null;
}

beforeAll(async () => {
  app = await makeApp();
  await resetDb();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  clearAccessCache();
});

describe('comprobación del subdominio', () => {
  it('acepta uno libre y con formato válido', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/register/slug?slug=mi-tienda' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.disponible).toBe(true);
  });

  it('rechaza los reservados de la plataforma', async () => {
    for (const slug of ['admin', 'api', 'www', 'plataforma']) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/register/slug?slug=${slug}` });
      expect(res.json().data.disponible, slug).toBe(false);
    }
  });

  it('rechaza formatos que no valen como subdominio', async () => {
    for (const slug of ['ab', 'mi tienda', 'mi_tienda', '-tienda', 'tienda-', 'mi--tienda']) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/register/slug?slug=${encodeURIComponent(slug)}`,
      });
      expect(res.json().data.disponible, slug).toBe(false);
    }
  });

  it('normaliza las mayúsculas en vez de rechazarlas: un hostname no las distingue', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/register/slug?slug=Mi-Tienda' });
    expect(res.json().data.disponible).toBe(true);
    expect(res.json().data.slug, 'devuelve la dirección que va a quedar').toBe('mi-tienda');
  });
});

describe('alta de un negocio', () => {
  it('crea el negocio y dice a dónde entrar', async () => {
    const res = await registrar();
    expect(res.statusCode).toBe(201);
    const d = res.json().data;
    expect(d.slug).toBe('ferreteria-nueva');
    expect(d.url).toContain('ferreteria-nueva');
    expect(d.trialDays).toBe(14);
  });

  it('deja el negocio LISTO PARA VENDER: sucursal, admin, contador y suscripción', async () => {
    const [biz] = await db
      .select()
      .from(schema.business)
      .where(eq(schema.business.slug, 'ferreteria-nueva'))
      .limit(1);
    expect(biz).toBeTruthy();

    const [contador] = await db
      .select()
      .from(schema.businessCounter)
      .where(eq(schema.businessCounter.businessId, biz!.id));
    // Sin contador, la primera venta falla al pedir número de recibo.
    expect(contador, 'el contador de recibos es imprescindible').toBeTruthy();

    const [sub] = await db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.businessId, biz!.id));
    expect(sub?.status).toBe('trial');
    expect(sub?.trialEndsAt).toBeTruthy();

    const locs = await db
      .select()
      .from(schema.location)
      .where(eq(schema.location.businessId, biz!.id));
    expect(locs).toHaveLength(1);
    expect(locs[0]!.isCentral).toBe(true);

    const users = await db
      .select()
      .from(schema.appUser)
      .where(eq(schema.appUser.businessId, biz!.id));
    expect(users).toHaveLength(1);
    expect(users[0]!.role).toBe('admin');
    expect(users[0]!.email).toBe('ana@ferreteria.test');
    expect(users[0]!.emailVerifiedAt, 'no verificado hasta que abra el enlace').toBeNull();
  });

  it('el admin recién registrado puede iniciar sesión y vender', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'ana', password: 'clave-segura-1', business: 'ferreteria-nueva' },
    });
    expect(login.statusCode).toBe(200);
    const token = login.json().data.accessToken;

    const productos = await app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: auth(token),
    });
    expect(productos.statusCode).toBe(200);
  });

  it('el subdominio ocupado se rechaza con 409', async () => {
    const res = await registrar({ username: 'otro', email: 'otro@x.test' });
    expect(res.statusCode).toBe(409);
  });

  it('un subdominio reservado se rechaza aunque esté libre en la base', async () => {
    const res = await registrar({ slug: 'admin', username: 'x', email: 'x@x.test' });
    expect(res.statusCode).toBe(400);
  });

  it('contraseña corta: 400 con el motivo', async () => {
    const res = await registrar({ slug: 'otra-tienda', password: 'corta1' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('8 caracteres');
  });

  it('correo inválido: 400', async () => {
    const res = await registrar({ slug: 'otra-tienda-2', email: 'no-es-correo' });
    expect(res.statusCode).toBe(400);
  });
});

describe('verificación del correo', () => {
  it('el enlace del alta confirma el correo, y sólo una vez', async () => {
    const spy = vi.spyOn(app.log, 'info');
    await registrar({
      slug: 'tienda-verifica',
      username: 'vero',
      email: 'vero@tienda.test',
    });
    const token = tokenDelLog(spy);
    spy.mockRestore();
    expect(token, 'el correo con el enlace debe salir por el log').toBeTruthy();

    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { token },
    });
    expect(ok.statusCode).toBe(200);

    const [user] = await db
      .select()
      .from(schema.appUser)
      .where(eq(schema.appUser.email, 'vero@tienda.test'));
    expect(user!.emailVerifiedAt).toBeTruthy();

    // Reutilizar el mismo enlace ya no vale.
    const repetido = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { token },
    });
    expect(repetido.statusCode).toBe(400);
    expect(repetido.json().code).toBe('token_invalido');
  });

  it('un token inventado no confirma nada', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { token: 'a'.repeat(43) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('/auth/me dice si el correo está confirmado', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'ana', password: 'clave-segura-1', business: 'ferreteria-nueva' },
    });
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: auth(login.json().data.accessToken),
    });
    expect(me.json().data.email).toBe('ana@ferreteria.test');
    expect(me.json().data.emailVerified).toBe(false);
  });
});

describe('recuperación de contraseña', () => {
  it('no revela si el correo existe: misma respuesta siempre', async () => {
    const existe = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'ana@ferreteria.test', business: 'ferreteria-nueva' },
    });
    const noExiste = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'nadie@ninguna.test', business: 'ferreteria-nueva' },
    });
    const negocioMalo = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'ana@ferreteria.test', business: 'no-existe' },
    });
    expect(existe.statusCode).toBe(200);
    expect(noExiste.statusCode).toBe(200);
    expect(negocioMalo.statusCode).toBe(200);
    expect(noExiste.json()).toEqual(existe.json());
    expect(negocioMalo.json()).toEqual(existe.json());
  });

  it('el enlace cambia la contraseña y deja entrar con la nueva', async () => {
    const spy = vi.spyOn(app.log, 'info');
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'ana@ferreteria.test', business: 'ferreteria-nueva' },
    });
    const token = tokenDelLog(spy);
    spy.mockRestore();
    expect(token).toBeTruthy();

    const reset = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: 'clave-nueva-2' },
    });
    expect(reset.statusCode).toBe(200);

    const conNueva = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'ana', password: 'clave-nueva-2', business: 'ferreteria-nueva' },
    });
    expect(conNueva.statusCode).toBe(200);

    const conVieja = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'ana', password: 'clave-segura-1', business: 'ferreteria-nueva' },
    });
    expect(conVieja.statusCode).toBe(401);
  });

  it('el mismo enlace no sirve dos veces', async () => {
    const spy = vi.spyOn(app.log, 'info');
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'ana@ferreteria.test', business: 'ferreteria-nueva' },
    });
    const token = tokenDelLog(spy)!;
    spy.mockRestore();

    const primera = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: 'clave-nueva-3' },
    });
    const segunda = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: 'clave-de-otro-4' },
    });
    expect(primera.statusCode).toBe(200);
    expect(segunda.statusCode).toBe(400);
  });

  it('pedir un enlace nuevo invalida el anterior', async () => {
    const spy = vi.spyOn(app.log, 'info');
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'ana@ferreteria.test', business: 'ferreteria-nueva' },
    });
    const viejo = tokenDelLog(spy)!;
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'ana@ferreteria.test', business: 'ferreteria-nueva' },
    });
    const nuevo = tokenDelLog(spy)!;
    spy.mockRestore();
    expect(nuevo).not.toBe(viejo);

    const conViejo = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: viejo, password: 'no-deberia-1' },
    });
    expect(conViejo.statusCode).toBe(400);
  });

  it('en la base sólo queda el HASH del token, nunca el token', async () => {
    const spy = vi.spyOn(app.log, 'info');
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'ana@ferreteria.test', business: 'ferreteria-nueva' },
    });
    const token = tokenDelLog(spy)!;
    spy.mockRestore();

    const [user] = await db
      .select({ id: schema.appUser.id })
      .from(schema.appUser)
      .where(eq(schema.appUser.email, 'ana@ferreteria.test'));
    const fila = await tokenDe(user!.id, 'password_reset', token);
    expect(fila, 'el hash guardado debe corresponder al token emitido').toBeTruthy();
    expect(fila!.tokenHash).not.toBe(token);
    expect(fila!.tokenHash).toHaveLength(64); // sha256 en hexadecimal
  });

  it('un usuario sin correo no recibe nada, y la respuesta es la de siempre', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: '', business: 'ferreteria-nueva' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('correo en el perfil', () => {
  it('añadir un correo lo deja SIN verificar', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'ana', password: 'clave-nueva-3', business: 'ferreteria-nueva' },
    });
    const token = login.json().data.accessToken;

    // Ana ya estaba verificada? No: sólo se verificó "vero". Se cambia el correo.
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me',
      headers: auth(token),
      payload: { email: 'ana.nueva@ferreteria.test' },
    });
    expect(patch.statusCode).toBe(200);

    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(token) });
    expect(me.json().data.email).toBe('ana.nueva@ferreteria.test');
    expect(me.json().data.emailVerified).toBe(false);
  });
});
