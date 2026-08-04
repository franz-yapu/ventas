import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { originPermitido } from '../src/env.js';
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

describe('comodín de CORS por subdominio', () => {
  // Con un subdominio por cliente los orígenes no se pueden enumerar, así que
  // CORS_ORIGINS admite comodín. Un error aquí abriría el API a cualquier web.
  const patrones = ['https://*.ventafacil.com', 'https://ventafacil.com'];

  it('acepta el subdominio de un cliente', () => {
    expect(originPermitido('https://llantas.ventafacil.com', patrones)).toBe(true);
    expect(originPermitido('https://ferre-dos.ventafacil.com', patrones)).toBe(true);
  });

  it('acepta el dominio pelado si está listado', () => {
    expect(originPermitido('https://ventafacil.com', patrones)).toBe(true);
  });

  it('RECHAZA un dominio ajeno que termine parecido', () => {
    // El fallo clásico del comodín mal escrito.
    expect(originPermitido('https://ventafacil.com.malicioso.io', patrones)).toBe(false);
    expect(originPermitido('https://maliciosoventafacil.com', patrones)).toBe(false);
  });

  it('RECHAZA otro esquema o puerto', () => {
    expect(originPermitido('http://llantas.ventafacil.com', patrones)).toBe(false);
    expect(originPermitido('https://llantas.ventafacil.com:8443', patrones)).toBe(false);
  });

  it('el comodín cubre un solo nivel', () => {
    expect(originPermitido('https://a.b.ventafacil.com', patrones)).toBe(false);
  });

  it('sin comodín, la coincidencia es exacta', () => {
    expect(originPermitido('https://otro.com', ['https://ventafacil.com'])).toBe(false);
  });
});

describe('los errores no cuentan de más', () => {
  it('un fallo no controlado NO filtra el mensaje interno', async () => {
    const solo = await buildApp({ logger: false });
    // Ruta que revienta como reventaría un error de Postgres: con detalles del esquema.
    solo.get('/boom', async () => {
      throw new Error('invalid input syntax for type uuid: "__none__" en app_user.location_id');
    });
    await solo.ready();
    try {
      const res = await solo.inject({ method: 'GET', url: '/boom' });
      expect(res.statusCode).toBe(500);
      // Antes esto llegaba entero al navegador: un mapa gratis del esquema.
      expect(res.body).not.toContain('uuid');
      expect(res.body).not.toContain('app_user');
      expect(res.json()).toEqual({ data: null, error: 'Error interno del servidor' });
    } finally {
      await solo.close();
    }
  });

  it('una ruta que no existe responde en el formato de la casa', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/no-existe-esta-ruta' });
    expect(res.statusCode).toBe(404);
    expect(res.json().data).toBeNull();
    expect(typeof res.json().error).toBe('string');
  });
});

describe('health check', () => {
  it('comprueba la BASE DE DATOS, no sólo que el proceso responda', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.status).toBe('ok');
    // Un API que contesta "ok" con la base caída es el falso positivo que vuelve
    // inútil un monitor de uptime.
    expect(d.db).toBe('ok');
    expect(typeof d.dbMs).toBe('number');
    expect(typeof d.uptimeSeg).toBe('number');
  });
})
