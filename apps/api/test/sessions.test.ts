import { db, schema } from '@ventafacil/db';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearUserCache } from '../src/lib/sessions.js';
import { clearAccessCache } from '../src/lib/subscription.js';
import { auth, createTenant, makeApp, resetDb, type Tenant } from './helpers.js';

/**
 * Revocación de sesiones.
 *
 * Antes, los tokens eran autosuficientes y esto no se cumplía: dar de baja a un
 * empleado no lo echaba de ningún lado —seguía renovando su sesión durante los 30 días
 * del refresh—, restablecer la contraseña no cerraba las sesiones abiertas, y "cerrar
 * sesión" sólo borraba los tokens del navegador de quien lo pulsaba.
 */

let app: FastifyInstance;
let t: Tenant;

interface Sesion {
  accessToken: string;
  refreshToken: string;
}

async function entrar(username = 'empleado', password = 'secreto123'): Promise<Sesion> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password, business: t.slug },
  });
  const d = res.json().data;
  return { accessToken: d.accessToken, refreshToken: d.refreshToken };
}

async function usar(token: string) {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/products',
    headers: auth(token),
  });
  return res.statusCode;
}

async function renovar(refreshToken: string) {
  return app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });
}

async function empleadoId() {
  const [u] = await db
    .select({ id: schema.appUser.id })
    .from(schema.appUser)
    .where(eq(schema.appUser.username, 'empleado'));
  return u!.id;
}

beforeAll(async () => {
  app = await makeApp();
  await resetDb();
  t = await createTenant(app, 'sesiones');
  await db.insert(schema.appUser).values({
    businessId: t.businessId,
    locationId: t.locationId,
    name: 'Empleado',
    username: 'empleado',
    passwordHash: await argon2.hash('secreto123'),
    role: 'seller',
  });
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  clearAccessCache();
  clearUserCache();
  // Cada caso arranca con el empleado activo, con su contraseña original y sin
  // revocaciones: varios casos le cambian la clave o lo dan de baja.
  await db
    .update(schema.appUser)
    .set({ isActive: true, tokenVersion: 0, passwordHash: await argon2.hash('secreto123') })
    .where(eq(schema.appUser.username, 'empleado'));
  clearUserCache();
});

describe('el refresh deja de ser autosuficiente', () => {
  it('con una sesión viva, renueva', async () => {
    const s = await entrar();
    expect((await renovar(s.refreshToken)).statusCode).toBe(200);
  });

  it('un refresh con firma válida pero SIN sesión en la base no vale', async () => {
    const s = await entrar();
    // Se borra la fila: el token sigue firmado y sin caducar, pero ya no apunta a nada.
    await db
      .delete(schema.refreshSession)
      .where(eq(schema.refreshSession.businessId, t.businessId));
    expect((await renovar(s.refreshToken)).statusCode).toBe(401);
  });

  it('un refresh revocado no vale', async () => {
    const s = await entrar();
    await db
      .update(schema.refreshSession)
      .set({ revokedAt: new Date() })
      .where(eq(schema.refreshSession.businessId, t.businessId));
    expect((await renovar(s.refreshToken)).statusCode).toBe(401);
  });

  it('un access token no sirve como refresh', async () => {
    const s = await entrar();
    expect((await renovar(s.accessToken)).statusCode).toBe(401);
  });
});

describe('dar de baja a un empleado lo echa de verdad', () => {
  it('el access token deja de valer', async () => {
    const s = await entrar();
    expect(await usar(s.accessToken)).toBe(200);

    await db
      .update(schema.appUser)
      .set({ isActive: false })
      .where(eq(schema.appUser.username, 'empleado'));
    clearUserCache(); // en producción lo hace el TTL de 60 s

    expect(await usar(s.accessToken)).toBe(401);
  });

  it('y ya no puede renovar: antes seguía 30 días', async () => {
    const s = await entrar();
    await db
      .update(schema.appUser)
      .set({ isActive: false })
      .where(eq(schema.appUser.username, 'empleado'));
    clearUserCache();
    expect((await renovar(s.refreshToken)).statusCode).toBe(401);
  });

  it('desactivarlo desde /users lo echa sin tocar la base a mano', async () => {
    const s = await entrar();
    expect(await usar(s.accessToken)).toBe(200);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${await empleadoId()}`,
      headers: auth(t.adminToken),
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(200);

    expect(await usar(s.accessToken)).toBe(401);
    expect((await renovar(s.refreshToken)).statusCode).toBe(401);
  });

  it('cambiarle la contraseña desde /users también lo echa', async () => {
    const s = await entrar();
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${await empleadoId()}`,
      headers: auth(t.adminToken),
      payload: { password: 'otra-clave-9' },
    });
    expect(await usar(s.accessToken)).toBe(401);
  });

  it('el admin sigue trabajando: echar a uno no echa a los demás', async () => {
    const s = await entrar();
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${await empleadoId()}`,
      headers: auth(t.adminToken),
      payload: { isActive: false },
    });
    expect(await usar(s.accessToken)).toBe(401);
    expect(await usar(t.adminToken)).toBe(200);
  });
});

describe('cerrar sesión', () => {
  it('cierra la sesión EN EL SERVIDOR, no sólo en el navegador', async () => {
    const s = await entrar();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      payload: { refreshToken: s.refreshToken },
    });
    expect(res.statusCode).toBe(200);
    expect((await renovar(s.refreshToken)).statusCode).toBe(401);
  });

  it('cerrar una sesión no toca las otras del mismo usuario', async () => {
    const movil = await entrar();
    const caja = await entrar();
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      payload: { refreshToken: movil.refreshToken },
    });
    expect((await renovar(movil.refreshToken)).statusCode).toBe(401);
    expect((await renovar(caja.refreshToken)).statusCode).toBe(200);
  });

  it('cerrar sesión con un token ilegible no rompe nada', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      payload: { refreshToken: 'esto-no-es-un-token' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('cerrar en todos los dispositivos', () => {
  it('echa de todas las sesiones, incluida la actual', async () => {
    const movil = await entrar();
    const caja = await entrar();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sessions/revoke-all',
      headers: auth(caja.accessToken),
    });
    expect(res.statusCode).toBe(200);
    clearUserCache();

    expect((await renovar(movil.refreshToken)).statusCode).toBe(401);
    expect((await renovar(caja.refreshToken)).statusCode).toBe(401);
    // También los access tokens que estaban en uso.
    expect(await usar(caja.accessToken)).toBe(401);
  });

  it('las sesiones abiertas se pueden listar', async () => {
    await entrar();
    const s = await entrar();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: auth(s.accessToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThanOrEqual(2);
  });

  it('un usuario sólo ve SUS sesiones, no las del admin', async () => {
    const s = await entrar();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: auth(s.accessToken),
    });
    const admin = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: auth(t.adminToken),
    });
    const idsEmpleado = res.json().data.map((r: { id: string }) => r.id);
    const idsAdmin = admin.json().data.map((r: { id: string }) => r.id);
    expect(idsEmpleado.some((id: string) => idsAdmin.includes(id))).toBe(false);
  });
});

describe('cambiarse uno la contraseña echa a los demás', () => {
  /**
   * El hueco que faltaba cerrar, y era el que más se usa.
   *
   * Cuando un admin te cambiaba la clave, o cuando la restablecías por correo, sí se
   * echaba a quien estuviera dentro. Pero cuando te la cambiabas TÚ desde Mi perfil —que
   * es exactamente lo que hace alguien que sospecha que otro entró con su cuenta— no se
   * revocaba nada: el refresh del intruso seguía renovando durante 30 días.
   */
  it('el refresh de otro dispositivo deja de valer', async () => {
    const movil = await entrar();
    const caja = await entrar();

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me',
      headers: auth(caja.accessToken),
      payload: { currentPassword: 'secreto123', newPassword: 'nuevaclave456' },
    });
    expect(res.statusCode).toBe(200);
    clearUserCache();

    // El otro dispositivo se queda fuera, ahora mismo y no en 30 días.
    expect((await renovar(movil.refreshToken)).statusCode).toBe(401);
    expect(await usar(movil.accessToken)).toBe(401);
  });

  it('pero a quien la cambia no lo echa: recibe una sesión nueva', async () => {
    /*
      El detalle que hace utilizable el arreglo. `revocarTodo` sube `token_version`, así
      que también mata la sesión de quien está haciendo el cambio; si no se devolviera
      una pareja nueva, cambiarse la contraseña te sacaría de la aplicación en mitad de
      una venta.
    */
    const caja = await entrar();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me',
      headers: auth(caja.accessToken),
      payload: { currentPassword: 'secreto123', newPassword: 'nuevaclave456' },
    });
    expect(res.statusCode).toBe(200);
    clearUserCache();

    const d = res.json().data;
    expect(d.accessToken, 'no devolvió sesión nueva').toBeTruthy();
    expect(d.refreshToken).toBeTruthy();
    expect(await usar(d.accessToken)).toBe(200);
    expect((await renovar(d.refreshToken)).statusCode).toBe(200);
  });

  it('cambiar sólo el nombre no echa a nadie', async () => {
    // Que el remedio no se pase de largo: esto no es un cambio de credenciales.
    const movil = await entrar();
    const caja = await entrar();

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me',
      headers: auth(caja.accessToken),
      payload: { name: 'Empleado Renombrado' },
    });
    expect(res.statusCode).toBe(200);
    clearUserCache();

    expect((await renovar(movil.refreshToken)).statusCode).toBe(200);
  });
});

describe('restablecer la contraseña echa de todas partes', () => {
  function tokenDelLog(spy: ReturnType<typeof vi.spyOn>): string | null {
    for (let i = spy.mock.calls.length - 1; i >= 0; i--) {
      const arg = spy.mock.calls[i]?.[0] as { cuerpo?: string } | undefined;
      const m = arg?.cuerpo?.match(/token=([A-Za-z0-9_-]+)/);
      if (m) return m[1]!;
    }
    return null;
  }

  it('quien entró con la contraseña vieja se queda fuera', async () => {
    await db
      .update(schema.appUser)
      .set({ email: 'empleado@sesiones.test' })
      .where(eq(schema.appUser.username, 'empleado'));

    const intruso = await entrar();
    expect(await usar(intruso.accessToken)).toBe(200);

    const spy = vi.spyOn(app.log, 'info');
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'empleado@sesiones.test', business: t.slug },
    });
    const token = tokenDelLog(spy)!;
    spy.mockRestore();

    const reset = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: 'clave-recuperada-1' },
    });
    expect(reset.statusCode).toBe(200);
    clearUserCache();

    // Lo que hace útil el restablecimiento: la sesión del intruso muere con él.
    expect(await usar(intruso.accessToken)).toBe(401);
    expect((await renovar(intruso.refreshToken)).statusCode).toBe(401);

    // Y el dueño entra con la nueva.
    const nueva = await entrar('empleado', 'clave-recuperada-1');
    expect(await usar(nueva.accessToken)).toBe(200);
  });
});
