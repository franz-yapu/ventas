import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createTenant, makeApp, resetDb, type Tenant } from './helpers.js';

/**
 * Endurecimiento del API: cabeceras, CORS y límites de peticiones.
 *
 * El límite del login se prueba en su propia app: agotar la cuota es justamente el
 * objetivo, y el contador vive en memoria por instancia, así que aislarlo evita
 * estropear otras pruebas.
 */

let app: FastifyInstance;
let t: Tenant;

beforeAll(async () => {
  app = await makeApp();
  await resetDb();
  t = await createTenant(app, 'seguridad');
});

afterAll(async () => {
  await app?.close();
});

describe('cabeceras de seguridad (helmet)', () => {
  it('el API responde con las cabeceras de helmet', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['referrer-policy']).toBeDefined();
  });

  it('no revela la tecnología del servidor', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('límite general de peticiones', () => {
  it('anuncia la cuota en las cabeceras', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: { authorization: `Bearer ${t.adminToken}` },
    });
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(Number(res.headers['x-ratelimit-remaining'])).toBeGreaterThanOrEqual(0);
  });

  it('el tope general no estorba el uso normal de una tienda', async () => {
    // Varias cajas detrás de una misma IP: una ráfaga corta no puede dar 429.
    for (let i = 0; i < 40; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/products',
        headers: { authorization: `Bearer ${t.adminToken}` },
      });
      expect(res.statusCode).not.toBe(429);
    }
  });
});

describe('límite del login (fuerza bruta)', () => {
  it('corta los intentos repetidos y responde 429', async () => {
    const solo = await buildApp({ logger: false });
    await solo.ready();
    try {
      const intentar = () =>
        solo.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { username: 'admin', password: 'incorrecta', business: 'seguridad' },
        });

      let bloqueado = false;
      let intentos = 0;
      // Con el tope por defecto (20 / 5 min) debe cortar bastante antes de 60.
      for (let i = 0; i < 60 && !bloqueado; i++) {
        intentos++;
        const res = await intentar();
        if (res.statusCode === 429) {
          bloqueado = true;
          expect(res.json().error).toMatch(/demasiadas/i);
        } else {
          // Mientras no bloquee, la contraseña mala sigue dando 401 (nunca 200).
          expect(res.statusCode).toBe(401);
        }
      }

      expect(bloqueado, 'el login nunca corto: se puede probar contraseñas sin limite').toBe(true);
      expect(intentos).toBeLessThanOrEqual(25);
    } finally {
      await solo.close();
    }
  });

  it('agotado el límite, tampoco pasa la contraseña correcta', async () => {
    // Si no fuera así, bastaría con acertar dentro de la ventana ya bloqueada.
    const solo = await buildApp({ logger: false });
    await solo.ready();
    try {
      for (let i = 0; i < 25; i++) {
        await solo.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { username: 'admin', password: 'incorrecta', business: 'seguridad' },
        });
      }
      const res = await solo.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'admin', password: 'secreto123', business: 'seguridad' },
      });
      expect(res.statusCode).toBe(429);
    } finally {
      await solo.close();
    }
  });
});

describe('CORS', () => {
  it('responde al preflight del origen permitido', async () => {
    // Fuera de producción no hay lista fija, así que el origen se refleja.
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/products',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
      },
    });
    expect(res.statusCode).toBeLessThan(400);
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });
});
