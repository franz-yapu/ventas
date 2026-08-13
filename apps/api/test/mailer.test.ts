import type { FastifyBaseLogger } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/env.js';
import { enviarCorreo, olvidarTokenGmail } from '../src/lib/mailer.js';

/*
  Tests del correo transaccional. No sale ni una petición de verdad: `fetch` está
  suplantado y lo que se comprueba es lo que se le pide a Google — que es justo donde
  estaba el riesgo, porque un mensaje MIME mal formado se acepta con un 200 y llega
  ilegible, o no llega.
*/

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as FastifyBaseLogger;

/** Respuesta mínima con la forma que consume el mailer. */
function respuesta(status: number, cuerpo: unknown): Response {
  const texto = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => texto,
  } as Response;
}

const TOKEN_OK = respuesta(200, { access_token: 'ya29.token-de-prueba', expires_in: 3599 });

/** El cuerpo `raw` que se le mandó a Gmail, ya decodificado a texto. */
function mensajeEnviado(fetchMock: ReturnType<typeof vi.fn>, llamada: number): string {
  const body = JSON.parse(fetchMock.mock.calls[llamada][1].body as string) as { raw: string };
  return Buffer.from(body.raw, 'base64url').toString('utf8');
}

/**
 * Decodifica una parte base64 del multipart (las dos van así).
 *
 * El `-+$` del final quita los dos guiones con los que arranca el separador siguiente:
 * colados dentro del base64 no dan error, decodifican un byte de basura y el test falla
 * por una diferencia invisible al leerla.
 */
function parte(mensaje: string, tipo: 'text/plain' | 'text/html'): string {
  const bloque = mensaje.split('----ventafacil-mime-alternative').find((b) => b.includes(tipo));
  const b64 = (bloque ?? '').split('\r\n\r\n')[1] ?? '';
  return Buffer.from(b64.replace(/\r\n/g, '').replace(/-+$/, ''), 'base64').toString('utf8');
}

const CORREO = {
  to: 'cliente@ejemplo.test',
  subject: 'Verificá tu cuenta en VentaFácil',
  text: 'Hola.\nEntrá aquí: http://mi-negocio.localhost:5173/verificar?token=abc',
};

describe('mailer: driver de Gmail', () => {
  const original = { driver: env.correoDriver, gmail: env.gmail, from: env.emailFrom };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.mocked(log.error).mockClear();
    vi.mocked(log.warn).mockClear();
    olvidarTokenGmail();
    Object.assign(env, {
      correoDriver: 'gmail',
      gmail: {
        clientId: 'id-de-prueba',
        clientSecret: 'secreto-de-prueba',
        refreshToken: 'refresh-de-prueba',
        user: 'pruebas@gmail.test',
      },
      emailFrom: 'VentaFácil (pruebas) <pruebas@gmail.test>',
    });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.assign(env, {
      correoDriver: original.driver,
      gmail: original.gmail,
      emailFrom: original.from,
    });
    olvidarTokenGmail();
  });

  it('cambia el refresh token por uno de acceso y envía por la API de Gmail', async () => {
    fetchMock.mockResolvedValueOnce(TOKEN_OK).mockResolvedValueOnce(respuesta(200, { id: '18f' }));

    const r = await enviarCorreo(CORREO, log);

    expect(r).toEqual({ enviado: true, driver: 'gmail' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [urlToken, optToken] = fetchMock.mock.calls[0];
    expect(urlToken).toBe('https://oauth2.googleapis.com/token');
    expect(String(optToken.body)).toContain('grant_type=refresh_token');
    expect(String(optToken.body)).toContain('refresh_token=refresh-de-prueba');

    const [urlEnvio, optEnvio] = fetchMock.mock.calls[1];
    expect(urlEnvio).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    expect(optEnvio.headers.Authorization).toBe('Bearer ya29.token-de-prueba');
  });

  it('deja la dirección del remitente FUERA de la palabra codificada', async () => {
    /*
      La primera versión codificaba el `From` entero, dirección incluida, y el correo
      llegaba firmado por la cuenta de Gmail en vez de por VentaFácil: sin una dirección
      legible en la cabecera, el servidor pone la suya. Respondía 200 igualmente.
    */
    fetchMock.mockResolvedValueOnce(TOKEN_OK).mockResolvedValueOnce(respuesta(200, { id: '18f' }));

    await enviarCorreo(CORREO, log);

    const from = /^From: (.+)$/m.exec(mensajeEnviado(fetchMock, 1))?.[1] ?? '';
    expect(from).toMatch(/^=\?UTF-8\?B\?[^?]+\?= <pruebas@gmail\.test>$/);
    const nombre = Buffer.from(/\?B\?([^?]+)\?=/.exec(from)?.[1] ?? '', 'base64').toString('utf8');
    expect(nombre).toBe('VentaFácil (pruebas)');
  });

  it('entrecomilla un nombre ASCII con paréntesis en vez de dejarlo suelto', async () => {
    // Sin comillas, «(pruebas)» es un comentario RFC 5322 y el nombre llega a medias.
    fetchMock.mockResolvedValueOnce(TOKEN_OK).mockResolvedValueOnce(respuesta(200, { id: '18f' }));
    env.emailFrom = 'VentaFacil (pruebas) <pruebas@gmail.test>';

    await enviarCorreo(CORREO, log);

    const from = /^From: (.+)$/m.exec(mensajeEnviado(fetchMock, 1))?.[1] ?? '';
    expect(from).toBe('"VentaFacil (pruebas)" <pruebas@gmail.test>');
  });

  it('acepta un remitente sin nombre, sólo la dirección', async () => {
    fetchMock.mockResolvedValueOnce(TOKEN_OK).mockResolvedValueOnce(respuesta(200, { id: '18f' }));
    env.emailFrom = 'pruebas@gmail.test';

    await enviarCorreo(CORREO, log);

    expect(mensajeEnviado(fetchMock, 1)).toContain('From: pruebas@gmail.test\r\n');
  });

  it('arma un mensaje MIME con el texto y el HTML intactos', async () => {
    fetchMock.mockResolvedValueOnce(TOKEN_OK).mockResolvedValueOnce(respuesta(200, { id: '18f' }));

    await enviarCorreo(CORREO, log);
    const mensaje = mensajeEnviado(fetchMock, 1);

    expect(mensaje).toContain('To: cliente@ejemplo.test');
    expect(mensaje).toContain('Content-Type: multipart/alternative');
    // El enlace es lo único que de verdad tiene que sobrevivir al viaje.
    expect(parte(mensaje, 'text/plain')).toBe(CORREO.text);
    expect(parte(mensaje, 'text/html')).toContain('token=abc');
  });

  it('codifica los acentos del asunto en vez de mandarlos crudos', async () => {
    fetchMock.mockResolvedValueOnce(TOKEN_OK).mockResolvedValueOnce(respuesta(200, { id: '18f' }));

    await enviarCorreo(CORREO, log);
    const mensaje = mensajeEnviado(fetchMock, 1);

    const asunto = /^Subject: (.+)$/m.exec(mensaje)?.[1] ?? '';
    expect(asunto).toMatch(/^=\?UTF-8\?B\?/);
    // Y al decodificarlo vuelve a ser el asunto original, acentos incluidos.
    const trozos = [...asunto.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].map((m) =>
      Buffer.from(m[1], 'base64').toString('utf8'),
    );
    expect(trozos.join('')).toBe(CORREO.subject);
    // Ni una cabecera con bytes fuera de ASCII: es lo que rompe a los servidores viejos.
    const cabeceras = mensaje.split('\r\n\r\n')[0];
    expect(/[^\x00-\x7f]/.test(cabeceras)).toBe(false);
  });

  it('parte el asunto largo sin romper un carácter por la mitad', async () => {
    fetchMock.mockResolvedValueOnce(TOKEN_OK).mockResolvedValueOnce(respuesta(200, { id: '18f' }));

    const largo = 'ñ'.repeat(60);
    await enviarCorreo({ ...CORREO, subject: largo }, log);

    const asunto = /^Subject: ((?:.|\r\n )+)$/m.exec(mensajeEnviado(fetchMock, 1))?.[1] ?? '';
    const trozos = [...asunto.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].map((m) =>
      Buffer.from(m[1], 'base64').toString('utf8'),
    );
    expect(trozos.length).toBeGreaterThan(1);
    // Si el corte cayera dentro de una «ñ» (dos bytes), esto saldría con U+FFFD.
    expect(trozos.join('')).toBe(largo);
  });

  it('reutiliza el token de acceso en el segundo envío', async () => {
    fetchMock
      .mockResolvedValueOnce(TOKEN_OK)
      .mockResolvedValueOnce(respuesta(200, { id: '1' }))
      .mockResolvedValueOnce(respuesta(200, { id: '2' }));

    await enviarCorreo(CORREO, log);
    await enviarCorreo(CORREO, log);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('oauth2'))).toHaveLength(1);
  });

  it('ante un 401 renueva el token y reintenta una sola vez', async () => {
    fetchMock
      .mockResolvedValueOnce(TOKEN_OK)
      .mockResolvedValueOnce(respuesta(401, { error: 'invalid credentials' }))
      .mockResolvedValueOnce(TOKEN_OK)
      .mockResolvedValueOnce(respuesta(401, { error: 'invalid credentials' }));

    const r = await enviarCorreo(CORREO, log);

    expect(r).toEqual({ enviado: false, driver: 'gmail' });
    // Cuatro llamadas: token, envío, token nuevo, envío. Ni una quinta.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(log.error).toHaveBeenCalled();
  });

  it('no intenta enviar si Google rechaza el refresh token', async () => {
    fetchMock.mockResolvedValueOnce(respuesta(400, { error: 'invalid_grant' }));

    const r = await enviarCorreo(CORREO, log);

    expect(r).toEqual({ enviado: false, driver: 'gmail' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // El motivo tiene que llegar al log: «invalid_grant» manda a renovar el token, y
    // cualquier otro texto manda a mirar donde no es.
    const registrado = JSON.stringify(vi.mocked(log.error).mock.calls);
    expect(registrado).toContain('invalid_grant');
  });

  it('no propaga el fallo si Google no contesta', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(enviarCorreo(CORREO, log)).resolves.toEqual({ enviado: false, driver: 'gmail' });
  });
});

describe('mailer: elección de driver', () => {
  const original = env.correoDriver;
  afterEach(() => {
    env.correoDriver = original;
    vi.unstubAllGlobals();
  });

  it('con driver de consola no envía nada y lo dice', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    env.correoDriver = 'consola';

    const r = await enviarCorreo(CORREO, log);

    expect(r).toEqual({ enviado: false, driver: 'consola' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con Resend configurado va a Resend, no a Gmail', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta(200, { id: 'x' }));
    vi.stubGlobal('fetch', fetchMock);
    env.correoDriver = 'resend';

    const r = await enviarCorreo(CORREO, log);

    expect(r).toEqual({ enviado: true, driver: 'resend' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('api.resend.com');
  });
});

describe('env: comprobaciones del correo al arrancar', () => {
  const GMAIL_OK = {
    GMAIL_CLIENT_ID: 'id',
    GMAIL_CLIENT_SECRET: 'secreto',
    GMAIL_REFRESH_TOKEN: 'refresh',
    GMAIL_USER: 'pruebas@gmail.test',
  };

  /** Reimporta `env.ts` desde cero con el entorno indicado. */
  async function cargarEnv(vars: Record<string, string | undefined>) {
    vi.resetModules();
    for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
    return import('../src/env.js');
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('con las cuatro GMAIL_* elige Gmail y firma con esa cuenta', async () => {
    const { env: e } = await cargarEnv({ ...GMAIL_OK, RESEND_API_KEY: '', EMAIL_FROM: undefined });
    expect(e.correoDriver).toBe('gmail');
    expect(e.emailFrom).toBe('VentaFácil <pruebas@gmail.test>');
  });

  it('una EMAIL_FROM vacía cae al remitente por defecto, no a la nada', async () => {
    // Es el caso de Docker: `EMAIL_FROM: ${EMAIL_FROM:-}` declara la variable sin valor.
    const { env: e } = await cargarEnv({ ...GMAIL_OK, RESEND_API_KEY: '', EMAIL_FROM: '' });
    expect(e.emailFrom).toBe('VentaFácil <pruebas@gmail.test>');
  });

  it('Resend gana si están las dos', async () => {
    const { env: e } = await cargarEnv({ ...GMAIL_OK, RESEND_API_KEY: 're_algo' });
    expect(e.correoDriver).toBe('resend');
  });

  it('no arranca con la configuración de Gmail a medias', async () => {
    await expect(cargarEnv({ ...GMAIL_OK, GMAIL_REFRESH_TOKEN: '' })).rejects.toThrow(
      /GMAIL_REFRESH_TOKEN/,
    );
  });

  it('no arranca si EMAIL_FROM no es la cuenta de Gmail', async () => {
    await expect(
      cargarEnv({ ...GMAIL_OK, RESEND_API_KEY: '', EMAIL_FROM: 'VentaFácil <otra@dominio.test>' }),
    ).rejects.toThrow(/no coincide con GMAIL_USER/);
  });

  it('acepta EMAIL_FROM con otro nombre si la dirección es la misma', async () => {
    const { env: e } = await cargarEnv({
      ...GMAIL_OK,
      RESEND_API_KEY: '',
      EMAIL_FROM: 'VentaFácil (pruebas) <Pruebas@Gmail.test>',
    });
    expect(e.correoDriver).toBe('gmail');
  });

  it('en producción no arranca sin ningún driver de correo', async () => {
    await expect(
      cargarEnv({
        NODE_ENV: 'production',
        RESEND_API_KEY: '',
        GMAIL_CLIENT_ID: '',
        GMAIL_CLIENT_SECRET: '',
        GMAIL_REFRESH_TOKEN: '',
        GMAIL_USER: '',
        JWT_ACCESS_SECRET: 'un_secreto_de_produccion_bastante_largo_1',
        JWT_REFRESH_SECRET: 'un_secreto_de_produccion_bastante_largo_2',
        JWT_PLATFORM_SECRET: 'un_secreto_de_produccion_bastante_largo_3',
        CORS_ORIGINS: 'https://ejemplo.test',
      }),
    ).rejects.toThrow(/Falta configurar el correo/);
  });

  it('en producción sí arranca con Gmail y sin Resend', async () => {
    const { env: e } = await cargarEnv({
      ...GMAIL_OK,
      NODE_ENV: 'production',
      RESEND_API_KEY: '',
      EMAIL_FROM: undefined,
      JWT_ACCESS_SECRET: 'un_secreto_de_produccion_bastante_largo_1',
      JWT_REFRESH_SECRET: 'un_secreto_de_produccion_bastante_largo_2',
      JWT_PLATFORM_SECRET: 'un_secreto_de_produccion_bastante_largo_3',
      CORS_ORIGINS: 'https://ejemplo.test',
    });
    expect(e.correoDriver).toBe('gmail');
  });
});
