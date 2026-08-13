import { db, schema } from '@ventafacil/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOGINS_CON_TOUR, ofrecerTour } from '../src/modules/auth.js';
import { auth, createTenant, makeApp, resetDb, type Tenant } from './helpers.js';

/*
  El tour guiado sale solo las dos primeras veces que alguien entra, y deja de salir en
  cuanto lo despacha. Lo que se prueba aquí es esa regla y su contabilidad, que es lo
  único de lo que el servidor es responsable: los pasos y los recuadros son de la web.
*/

let app: FastifyInstance;
let t: Tenant;

beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  t = await createTenant(app, 'tour');
});

afterAll(async () => {
  await app.close();
  await resetDb();
});

/** Entra de verdad por la puerta, que es lo único que cuenta como inicio de sesión. */
async function entrar() {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { slug: t.slug, username: 'admin', password: 'secreto123' },
  });
  expect(res.statusCode).toBe(200);
  return res.json().data.accessToken as string;
}

async function yo(token: string) {
  const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(token) });
  expect(res.statusCode).toBe(200);
  return res.json().data as { mostrarTour: boolean };
}

function contador() {
  return db
    .select({ n: schema.appUser.loginCount, visto: schema.appUser.tourDismissedAt })
    .from(schema.appUser)
    .where(eq(schema.appUser.id, t.adminId))
    .then((f) => f[0]!);
}

describe('la regla, sin base de datos de por medio', () => {
  it('se ofrece en las dos primeras entradas y no en la tercera', () => {
    expect(ofrecerTour(1, null)).toBe(true);
    expect(ofrecerTour(LOGINS_CON_TOUR, null)).toBe(true);
    expect(ofrecerTour(LOGINS_CON_TOUR + 1, null)).toBe(false);
  });

  it('una vez despachado no vuelve, aunque sea la primera entrada', () => {
    // El caso de quien se lo salta el primer día: la cuenta ya no importa.
    expect(ofrecerTour(1, new Date())).toBe(false);
  });
});

describe('contador de entradas', () => {
  it('un usuario recién creado empieza en cero y sin tour despachado', async () => {
    // Se mira una fila nueva y no la del admin: `createTenant` inicia sesión para
    // conseguir su token, así que esa ya viene con una entrada contada.
    const [nuevo] = await db
      .insert(schema.appUser)
      .values({
        businessId: t.businessId,
        locationId: t.locationId,
        name: 'Recién llegada',
        username: 'nueva',
        passwordHash: 'no-se-usa',
      })
      .returning({ n: schema.appUser.loginCount, visto: schema.appUser.tourDismissedAt });

    expect(nuevo!.n).toBe(0);
    expect(nuevo!.visto).toBeNull();
  });

  it('sube una por inicio de sesión', async () => {
    const antes = (await contador()).n;
    await entrar();
    expect((await contador()).n).toBe(antes + 1);
    await entrar();
    expect((await contador()).n).toBe(antes + 2);
  });

  it('refrescar el token NO cuenta como entrar', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { slug: t.slug, username: 'admin', password: 'secreto123' },
    });
    const antes = (await contador()).n;
    const { refreshToken } = login.json().data;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });

    expect(res.statusCode).toBe(200);
    // Refrescar pasa solo y muchas veces al día: si contara, gastaría las dos
    // oportunidades del tour en la primera tarde.
    expect((await contador()).n).toBe(antes);
  });

  it('una contraseña equivocada no cuenta', async () => {
    const antes = (await contador()).n;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { slug: t.slug, username: 'admin', password: 'no-es-esta' },
    });
    expect(res.statusCode).toBe(401);
    expect((await contador()).n).toBe(antes);
  });
});

describe('/auth/me dice si el tour sale solo', () => {
  it('sale en las dos primeras entradas y deja de salir en la tercera', async () => {
    await db
      .update(schema.appUser)
      .set({ loginCount: 0, tourDismissedAt: null })
      .where(eq(schema.appUser.id, t.adminId));

    expect((await yo(await entrar())).mostrarTour).toBe(true);
    expect((await yo(await entrar())).mostrarTour).toBe(true);
    expect((await yo(await entrar())).mostrarTour).toBe(false);
  });
});

describe('«no mostrar más»', () => {
  it('apaga el tour para siempre, en la misma sesión', async () => {
    await db
      .update(schema.appUser)
      .set({ loginCount: 0, tourDismissedAt: null })
      .where(eq(schema.appUser.id, t.adminId));
    const token = await entrar();
    expect((await yo(token)).mostrarTour).toBe(true);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/tour-seen',
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.mostrarTour).toBe(false);
    expect((await yo(token)).mostrarTour).toBe(false);
    // Y sigue apagado al volver a entrar, que es lo que la persona pidió.
    expect((await yo(await entrar())).mostrarTour).toBe(false);
  });

  it('repetirlo no mueve el día en que se despachó', async () => {
    const primera = (await contador()).visto;
    expect(primera).not.toBeNull();

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/tour-seen',
      headers: auth(await entrar()),
    });

    expect((await contador()).visto?.getTime()).toBe(primera?.getTime());
  });

  it('sin sesión no se puede apagar el de nadie', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/tour-seen' });
    expect(res.statusCode).toBe(401);
  });
});
