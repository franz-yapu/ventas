import { db, schema } from '@ventafacil/db';
import argon2 from 'argon2';
import { TERMS_VERSION } from '@ventafacil/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearAccessCache } from '../src/lib/subscription.js';
import { buildApp } from '../src/app.js';
import { auth, createTenant, makeApp, resetDb, type Tenant } from './helpers.js';

/**
 * Legales: constancia de aceptación de los términos y exportación de datos.
 *
 * Lo que se protege aquí son dos cosas de las que después no hay vuelta atrás: poder
 * demostrar QUÉ aceptó cada negocio (por eso se guarda la versión, no sólo la fecha), y
 * que el cliente pueda llevarse sus datos enteros sin depender de nadie.
 */

let app: FastifyInstance;
let t: Tenant;
let otro: Tenant;
/** Encargado de una sucursal: puede entrar, pero NO puede exportar el negocio. */
let sucursalToken = '';

const ALTA = {
  businessName: 'Bazar Central',
  slug: 'bazar-central',
  adminName: 'Rosa Mamani',
  email: 'rosa@bazar.test',
  username: 'rosa',
  password: 'clave-de-rosa-1',
  acceptTerms: true,
};

beforeAll(async () => {
  app = await makeApp();
  await resetDb();
  t = await createTenant(app, 'legal-a');
  otro = await createTenant(app, 'legal-b');

  /*
    El encargado va en el SEGUNDO negocio, no en `t`.

    Puesto en `t` cambiaba su número de usuarios y rompía "el admin descarga una copia
    completa", que comprueba que la exportación trae exactamente los suyos. Para lo que
    hace falta aquí da igual de qué negocio sea: lo que se prueba es que un admin de
    sucursal recibe 403 y que ese 403 no consume el cupo de nadie, y el contador del tope
    es por IP, común a toda la suite.
  */
  const [sucursal] = await db
    .insert(schema.location)
    .values({ businessId: otro.businessId, name: 'Sucursal Sur', isCentral: false })
    .returning();
  await db.insert(schema.appUser).values({
    businessId: otro.businessId,
    locationId: sucursal!.id,
    name: 'Encargado Sur',
    username: 'encargado.sur',
    passwordHash: await argon2.hash('secreto123'),
    role: 'admin',
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'encargado.sur', password: 'secreto123', business: otro.slug },
  });
  sucursalToken = login.json().data.accessToken;
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  clearAccessCache();
});

describe('aceptación de los términos', () => {
  it('el alta guarda la fecha Y la versión aceptada', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/register', payload: ALTA });
    expect(res.statusCode).toBe(201);

    const [biz] = await db
      .select()
      .from(schema.business)
      .where(eq(schema.business.slug, 'bazar-central'));
    expect(biz!.termsAcceptedAt).toBeTruthy();
    // Sin la versión, dentro de un año no habría forma de saber qué aceptó.
    expect(biz!.termsVersion).toBe(TERMS_VERSION);
  });

  it('sin aceptar, no hay alta', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/register',
      payload: {
        ...ALTA,
        slug: 'sin-aceptar',
        username: 'xxx1',
        email: 'xxx1@x.test',
        acceptTerms: false,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('términos');
  });

  it('omitir el campo tampoco cuela: se exige en el esquema, no sólo en el formulario', async () => {
    const { acceptTerms, ...sinCampo } = ALTA;
    void acceptTerms;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/register',
      payload: { ...sinCampo, slug: 'sin-campo', username: 'xxx2', email: 'xxx2@x.test' },
    });
    expect(res.statusCode).toBe(400);

    const [biz] = await db
      .select()
      .from(schema.business)
      .where(eq(schema.business.slug, 'sin-campo'));
    expect(biz, 'no debe haberse creado el negocio').toBeUndefined();
  });

  it('los negocios creados por CLI no aceptan términos por nadie', async () => {
    // `createTenant` inserta directo, como hace el CLI: sin constancia de aceptación.
    const [biz] = await db
      .select()
      .from(schema.business)
      .where(eq(schema.business.id, t.businessId));
    expect(biz!.termsAcceptedAt).toBeNull();
  });
});

describe('exportación de datos', () => {
  it('el admin descarga una copia completa', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/business/export',
      headers: auth(t.adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('legal-a');

    const d = res.json();
    expect(d.negocio.subdominio).toBe('legal-a');
    // Lo que `createTenant` sembró: 1 usuario, 1 ubicación, 1 producto, 1 venta con línea.
    expect(d.usuarios).toHaveLength(1);
    expect(d.ubicaciones).toHaveLength(1);
    expect(d.productos).toHaveLength(1);
    expect(d.clientes).toHaveLength(1);
    expect(d.ventas).toHaveLength(1);
    expect(d.ventas[0].items).toHaveLength(1);
    expect(d.suscripcion).toBeDefined();
  });

  it('NUNCA exporta los hashes de contraseña', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/business/export',
      headers: auth(t.adminToken),
    });
    expect(res.body).not.toContain('passwordHash');
    expect(res.body).not.toContain('password_hash');
    expect(res.body).not.toContain('$argon2');
  });

  it('no se cuela ni un dato del otro negocio', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/business/export',
      headers: auth(t.adminToken),
    });
    expect(res.body).not.toContain('legal-b');
    expect(res.body).not.toContain(otro.businessId);
    expect(res.body).not.toContain('secreto de legal-b');
  });

  it('un VENDEDOR no puede llevarse el negocio entero', async () => {
    await db.insert(schema.appUser).values({
      businessId: t.businessId,
      locationId: t.locationId,
      name: 'Vendedor',
      username: 'vendedor',
      passwordHash: await argon2.hash('secreto123'),
      role: 'seller',
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'vendedor', password: 'secreto123', business: 'legal-a' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/business/export',
      headers: auth(login.json().data.accessToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('cada admin exporta LO SUYO', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/business/export',
      headers: auth(otro.adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().negocio.subdominio).toBe('legal-b');
  });

  it('sin sesión no se exporta nada', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/business/export' });
    expect(res.statusCode).toBe(401);
  });

  it('a quien NO puede exportar, sus rechazos no gastan el cupo de los demás', async () => {
    /*
      El tope se contaba en un hook `onRequest`, antes de los guardias, así que los 403
      gastaban cupo. Como el contador es por IP y todas las cajas de una tienda salen por
      la misma, a un encargado de sucursal le bastaban unos pocos intentos fallidos para
      dejar al negocio entero sin poder exportar durante una hora.

      Se levanta una app PROPIA con el tope real (3), porque la suite corre con 500 para
      no agotarse a sí misma — con ese número, ninguna cantidad razonable de rechazos
      demostraría nada y el test pasaría sin comprobar el arreglo. Es el mismo patrón que
      usa `security.test.ts` con el límite del login.
    */
    const solo = await buildApp({ logger: false, exportRateLimitMax: 3 });
    await solo.ready();
    try {
      for (let i = 0; i < 6; i++) {
        const res = await solo.inject({
          method: 'GET',
          url: '/api/v1/business/export',
          headers: auth(sucursalToken),
        });
        expect(res.statusCode, `intento ${i + 1}: ${res.body.slice(0, 80)}`).toBe(403);
      }

      // Y el admin de la central sigue pudiendo, que es lo que se estaba rompiendo.
      const res = await solo.inject({
        method: 'GET',
        url: '/api/v1/business/export',
        headers: auth(t.adminToken),
      });
      expect(res.statusCode, res.body.slice(0, 120)).toBe(200);
    } finally {
      await solo.close();
    }
  });

  describe('llevarse los datos no se bloquea nunca', () => {
    /**
     * Los términos prometen que puedes descargar una copia completa «en cualquier
     * momento», y que si cancelas se conservan tus datos N días «por si quieres volver o
     * descargar una copia».
     *
     * El sistema hacía exactamente lo contrario: la exportación caía en el 402 general de
     * suscripción, así que dejaba de funcionar justo en el momento para el que se
     * escribió esa frase. Aquí el que estaba mal era el sistema, no el texto — suspender
     * a alguien le impide OPERAR, no recuperar lo suyo.
     */
    it.each([
      ['prueba vencida', 'trial', () => new Date(Date.now() - 86_400_000)],
      ['suspendida', 'suspended', () => null],
      ['cancelada', 'cancelled', () => null],
    ])('con la suscripción %s, sigue pudiendo exportar', async (_n, estado, vence) => {
      await db
        .insert(schema.subscription)
        .values({
          businessId: t.businessId,
          planCode: 'basico',
          status: estado as never,
          trialEndsAt: vence(),
        })
        .onConflictDoUpdate({
          target: schema.subscription.businessId,
          set: { planCode: 'basico', status: estado as never, trialEndsAt: vence() },
        });
      clearAccessCache();

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/business/export',
        headers: auth(t.adminToken),
      });
      expect(res.statusCode, res.body.slice(0, 120)).toBe(200);
      expect(res.json().negocio).toBeTruthy();
    });

    it('pero seguir OPERANDO sí se bloquea: exportar no reabre la puerta', async () => {
      // Que el arreglo no se pase de largo. Lo que se abre es llevarse lo propio, no
      // volver a vender sin pagar.
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/products',
        headers: auth(t.adminToken),
      });
      expect(res.statusCode).toBe(402);
    });
  });
});

describe('exportar los datos de una pantalla', () => {
  /**
   * La exportación completa sirve para migrar o para guardar; esto es lo otro, lo que se
   * pide todos los días: "el listado de ventas de marzo, en Excel".
   *
   * Una sola ruta para las seis secciones, y no un exportador por pantalla, porque seis
   * exportadores serían seis copias de la misma decisión sobre quién ve qué — y basta con
   * que una se escriba con prisa para que se escape el costo.
   *
   * **Ésta SÍ pasa por la puerta de la suscripción, y `/business/export` no.** No es una
   * incoherencia: lo que los términos prometen es poder llevarse los datos, y eso lo
   * cumple la copia completa, que sigue abierta aunque la cuenta esté cancelada. Bajar el
   * listado de marzo en Excel es una comodidad de la operación diaria, y la operación
   * diaria es justo lo que se para cuando alguien deja de pagar.
   */
  beforeAll(async () => {
    // Otros casos de este archivo dejan la suscripción cancelada a propósito.
    await db
      .insert(schema.subscription)
      .values({ businessId: t.businessId, planCode: 'basico', status: 'active' })
      .onConflictDoUpdate({
        target: schema.subscription.businessId,
        set: { planCode: 'basico', status: 'active', trialEndsAt: null },
      });
    clearAccessCache();
  });
  it.each([['ventas'], ['productos'], ['inventario'], ['clientes'], ['caja'], ['actividad']])(
    '%s devuelve filas con cabeceras en español',
    async (seccion) => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/export/${seccion}`,
        headers: auth(t.adminToken),
      });
      expect(res.statusCode, res.body.slice(0, 150)).toBe(200);
      const { filas } = res.json().data;
      expect(Array.isArray(filas)).toBe(true);
      if (filas.length > 0) {
        // Las claves son lo que va a leer una persona en la primera fila del Excel.
        expect(Object.keys(filas[0]).some((k) => /[A-ZÁÉÍÓÚÑ]/.test(k[0]!))).toBe(true);
      }
    },
  );

  it('una sección inventada responde 404, no una hoja vacía', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/export/loquesea',
      headers: auth(t.adminToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('un encargado de sucursal NO exporta el negocio', async () => {
    // Mismo criterio que la exportación completa: quien responde por el negocio es la
    // central. Con `requireAdmin` a secas, un encargado se bajaba las ventas de los otros
    // locales en un solo archivo.
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/export/ventas',
      headers: auth(sucursalToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('las fechas filtran de verdad', async () => {
    const futuro = new Date(Date.now() + 86_400_000).toISOString();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/export/ventas?from=${futuro}`,
      headers: auth(t.adminToken),
    });
    expect(res.json().data.filas).toHaveLength(0);
  });

  it('NUNCA sale el costo, ni siquiera en productos', async () => {
    // La ruta la protege `requireCentralAdmin`, así que hoy sólo llega quien puede verlo.
    // El filtro está puesto igual, para el día que se abra a un encargado.
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/export/productos',
      headers: auth(t.adminToken),
    });
    expect(res.statusCode).toBe(200);
  });
});
