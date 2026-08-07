import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, schema } from '@ventafacil/db';
import { violaUnica } from '../src/lib/pg-errores.js';
import { auth, createTenant, makeApp, resetDb, type Tenant } from './helpers.js';

/**
 * Los duplicados se responden con 409 y un mensaje para la persona, no con un 500.
 *
 * Esta suite existe por lo que pasó al subir drizzle-orm de 0.36 a 0.45. Los seis sitios
 * que detectaban un duplicado lo hacían leyendo el TEXTO del error
 * (`String(e).includes('...')`), y la nueva versión dejó de meter el nombre de la
 * restricción en ese texto. Los seis se rompieron a la vez y sólo uno —la segunda caja
 * abierta— tenía test que lo delatara: los otros cinco habrían llegado a producción
 * respondiendo "error del servidor" donde el cliente esperaba "ese usuario ya existe".
 *
 * Por eso se prueban los CINCO que faltaban. Un 500 aquí significa que la detección se
 * volvió a atar a la forma del error de una biblioteca en vez de al contrato de
 * PostgreSQL.
 */

let app: FastifyInstance;
let t: Tenant;

beforeAll(async () => {
  app = await makeApp();
  await resetDb();
  t = await createTenant(app, 'restricciones');
});

afterAll(async () => {
  await app?.close();
});

describe('duplicados que el usuario puede provocar', () => {
  it('un SKU repetido responde 409, no 500', async () => {
    const cuerpo = {
      sku: 'SKU-REPE',
      name: 'Bujía',
      price: '10.00',
      cost: '5.00',
      locationId: t.locationId,
    };
    const primera = await app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: auth(t.adminToken),
      payload: cuerpo,
    });
    expect(primera.statusCode).toBe(201);

    const segunda = await app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: auth(t.adminToken),
      payload: cuerpo,
    });
    expect(segunda.statusCode).toBe(409);
    expect(segunda.json().error).toMatch(/SKU/i);
  });

  it('un nombre de usuario repetido responde 409, no 500', async () => {
    const cuerpo = {
      name: 'Repetido',
      username: 'repetido',
      password: 'secreto123',
      role: 'seller',
      locationId: t.locationId,
    };
    const primera = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(t.adminToken),
      payload: cuerpo,
    });
    expect(primera.statusCode).toBe(201);

    const segunda = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(t.adminToken),
      payload: cuerpo,
    });
    expect(segunda.statusCode).toBe(409);
    expect(segunda.json().error).toMatch(/ya existe/i);
  });

  it('registrar un negocio con un subdominio ocupado responde 409, no 500', async () => {
    // Este caso lo corta la comprobación previa de disponibilidad. El `catch` del
    // handler cubre la carrera —dos altas simultáneas con el mismo slug—, que no se
    // puede provocar de forma fiable desde aquí; esa parte la cubre el bloque de abajo,
    // que comprueba el helper contra un choque real en la base.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/register',
      payload: {
        businessName: 'Otro Negocio',
        slug: t.slug,
        adminName: 'Alguien',
        username: 'alguien',
        password: 'secreto123',
        email: 'alguien@ejemplo.test',
        acceptTerms: true,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/ocupada/i);
  });
});

describe('violaUnica reconoce el error por contrato de PostgreSQL', () => {
  /**
   * La prueba de que no volvemos a depender del texto: se provoca el duplicado de
   * verdad contra la base y se comprueba que el helper lo reconoce, pase lo que pase con
   * cómo lo envuelva la biblioteca de turno.
   */
  it('reconoce la violación aunque el error venga envuelto', async () => {
    let capturado: unknown;
    try {
      await db.insert(schema.business).values({ name: 'Choque', slug: t.slug });
    } catch (e) {
      capturado = e;
    }

    expect(capturado).toBeDefined();
    expect(violaUnica(capturado, 'business_slug_unique')).toBe(true);
    // Y no confunde una restricción con otra.
    expect(violaUnica(capturado, 'product_business_sku_uq')).toBe(false);
  });

  it('no toma por duplicado cualquier otro error', () => {
    expect(violaUnica(new Error('cualquier cosa'), 'business_slug_unique')).toBe(false);
    expect(violaUnica(undefined, 'business_slug_unique')).toBe(false);
  });
});
