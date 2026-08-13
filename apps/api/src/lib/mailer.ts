import type { FastifyBaseLogger } from 'fastify';
import { env } from '../env.js';

/**
 * Envío de correo transaccional (verificación y recuperación de contraseña).
 *
 * Tres drivers, elegidos por configuración (ver `correoDriver` en `env.ts`):
 *
 *   · **Resend** cuando hay `RESEND_API_KEY`. Es una llamada HTTP, sin dependencias.
 *   · **Gmail** cuando hay las cuatro `GMAIL_*`. También por HTTP: se cambia el refresh
 *     token por uno de acceso y se llama a la API de Gmail. Existe para PROBAR el
 *     circuito entero del correo sin dominio verificado ni cuenta de pago — una cuenta
 *     personal de Gmail tiene un tope de unos cientos de envíos al día y manda siempre
 *     desde su propia dirección, así que no es un remitente transaccional serio.
 *   · **Consola** cuando no hay ninguna: el correo se escribe en el log del API, con el
 *     enlace entero. Así el flujo completo se prueba en local y en staging sin cuenta
 *     ni dominio verificado — y sin mandar correos de verdad a nadie por accidente
 *     mientras se prueba.
 *
 * Los fallos NO se propagan al usuario. Si el correo no sale, el alta ya está hecha y
 * la persona no puede arreglar nada reintentando; se registra el error y se sigue. La
 * alternativa —romper el registro porque el proveedor tuvo un mal minuto— es peor.
 */

export interface Correo {
  to: string;
  subject: string;
  /** Texto plano. El HTML se genera a partir de él si no se indica otro. */
  text: string;
  html?: string;
}

export type ResultadoEnvio = { enviado: boolean; driver: 'resend' | 'gmail' | 'consola' };

function aHtml(text: string): string {
  const cuerpo = text
    .split('\n')
    .map((l) => (l.trim() ? `<p style="margin:0 0 12px">${escapar(l)}</p>` : ''))
    .join('');
  return `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5;color:#17171a">${cuerpo}</div>`;
}

function escapar(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function enviarPorResend(correo: Correo, log: FastifyBaseLogger): Promise<boolean> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.emailFrom,
        to: [correo.to],
        subject: correo.subject,
        text: correo.text,
        html: correo.html ?? aHtml(correo.text),
      }),
    });
    if (!res.ok) {
      // El cuerpo de Resend explica el motivo (dominio sin verificar, clave mala…).
      log.error({ status: res.status, body: await res.text() }, 'Resend rechazó el correo');
      return false;
    }
    return true;
  } catch (e) {
    log.error({ err: e }, 'No se pudo contactar con Resend');
    return false;
  }
}

// ── Driver de Gmail ──────────────────────────────────────────────────────────
/*
  Google da tokens de acceso de una hora a cambio del refresh token. Se guarda el que
  está vigente en memoria: pedir uno nuevo en cada envío son dos viajes de red en vez de
  uno, y Google acaba limitando esas peticiones. Al reiniciar el proceso se pide otro,
  que es exactamente lo que debe pasar.
*/
let accesoGmail: { token: string; caducaMs: number } | null = null;

/** Sólo para los tests: obliga a pedir un token nuevo. */
export function olvidarTokenGmail(): void {
  accesoGmail = null;
}

async function tokenDeGmail(log: FastifyBaseLogger): Promise<string | null> {
  // Un minuto de margen: un token que caduca en camino da un 401 que no explica nada.
  if (accesoGmail && accesoGmail.caducaMs - 60_000 > Date.now()) return accesoGmail.token;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.gmail.clientId,
        client_secret: env.gmail.clientSecret,
        refresh_token: env.gmail.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const cuerpo = await res.text();
    if (!res.ok) {
      /*
        El motivo habitual es `invalid_grant`: el refresh token se revocó, o caducó por
        estar la aplicación de Google en modo de prueba (siete días). Se dice entero
        porque «no se pudo enviar el correo» mandaría a mirar al sitio equivocado.
      */
      log.error({ status: res.status, body: cuerpo }, 'Google rechazó el refresh token de Gmail');
      return null;
    }
    const datos = JSON.parse(cuerpo) as { access_token?: string; expires_in?: number };
    if (!datos.access_token) {
      log.error({ body: cuerpo }, 'Google respondió 200 sin access_token');
      return null;
    }
    accesoGmail = {
      token: datos.access_token,
      caducaMs: Date.now() + (datos.expires_in ?? 3600) * 1000,
    };
    return accesoGmail.token;
  } catch (e) {
    log.error({ err: e }, 'No se pudo contactar con Google para renovar el token de Gmail');
    return null;
  }
}

/**
 * Cabecera con acentos, codificada según RFC 2047.
 *
 * El ASCII puro se deja tal cual, que se lee mejor en los logs. Lo demás va en palabras
 * codificadas de menos de 75 caracteres, y el corte se hace por CARACTER y no por byte:
 * partir una «á» por la mitad deja dos palabras que no decodifican.
 */
function cabecera(texto: string): string {
  if (/^[\x20-\x7e]*$/.test(texto)) return texto;
  const trozos: string[] = [];
  let actual = '';
  for (const caracter of texto) {
    if (Buffer.byteLength(actual + caracter, 'utf8') > 45) {
      trozos.push(actual);
      actual = '';
    }
    actual += caracter;
  }
  trozos.push(actual);
  return trozos
    .map((t) => `=?UTF-8?B?${Buffer.from(t, 'utf8').toString('base64')}?=`)
    .join('\r\n ');
}

/** Base64 en líneas de 76, como pide el MIME. */
function base64Mime(texto: string): string {
  return (
    Buffer.from(texto, 'utf8')
      .toString('base64')
      .match(/.{1,76}/g) ?? []
  ).join('\r\n');
}

/** Caracteres que obligan a entrecomillar un nombre en una cabecera de dirección. */
const ESPECIALES_RFC5322 = /[()<>@,;:\\".[\]]/;

/**
 * Remitente listo para la cabecera `From`, con el nombre y la dirección tratados aparte.
 *
 * Codificar la cabecera ENTERA es lo que se hacía al principio, y estaba mal: una
 * palabra codificada RFC 2047 vale para el nombre y sólo para el nombre. Metida
 * alrededor de `<direccion>`, el resultado no contiene ninguna dirección que un servidor
 * pueda leer. Gmail no se queja —responde 200— y manda el correo con la identidad de la
 * cuenta, así que el remitente configurado desaparece en silencio. Se vio mirando la
 * cabecera del correo recibido; ni el 200 ni los tests del asunto lo delataban.
 */
function remitente(de: string): string {
  const partes = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(de);
  if (!partes) return de.trim(); // Dirección pelada, sin nombre: nada que codificar.
  const [, nombre, direccion] = partes;
  if (!nombre) return `<${direccion}>`;
  if (!/^[\x20-\x7e]*$/.test(nombre)) return `${cabecera(nombre)} <${direccion}>`;
  // ASCII con paréntesis, comas o comillas: hay que entrecomillarlo o el nombre se
  // interpreta como comentario y se pierde («VentaFácil (pruebas)» es justo ese caso).
  const listo = ESPECIALES_RFC5322.test(nombre)
    ? `"${nombre.replace(/(["\\])/g, '\\$1')}"`
    : nombre;
  return `${listo} <${direccion}>`;
}

/*
  El separador es fijo a propósito. Un separador sólo puede chocar con el contenido, y
  aquí las dos partes van en base64 —alfabeto A-Z a-z 0-9 + / =—, así que un texto con
  guiones no puede aparecer dentro. Fijo, además, hace el mensaje reproducible y el test
  legible.
*/
const SEPARADOR = '----ventafacil-mime-alternative';

function mensajeRfc822(correo: Correo, de: string): string {
  return [
    `From: ${remitente(de)}`,
    `To: ${correo.to}`,
    `Subject: ${cabecera(correo.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${SEPARADOR}"`,
    '',
    `--${SEPARADOR}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Mime(correo.text),
    `--${SEPARADOR}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Mime(correo.html ?? aHtml(correo.text)),
    `--${SEPARADOR}--`,
    '',
  ].join('\r\n');
}

async function enviarPorGmail(
  correo: Correo,
  log: FastifyBaseLogger,
  reintento = false,
): Promise<boolean> {
  const token = await tokenDeGmail(log);
  if (!token) return false;
  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raw: Buffer.from(mensajeRfc822(correo, env.emailFrom), 'utf8').toString('base64url'),
      }),
    });
    if (res.status === 401 && !reintento) {
      /*
        El token cacheado ya no vale —revocado, o la cuenta cambió de contraseña— y el
        reloj no lo sabía. Se tira y se prueba una vez con uno nuevo. Una sola vez: si el
        refresh token es el que está muerto, reintentar en bucle sólo alarga el fallo.
      */
      log.warn('Gmail devolvió 401; se renueva el token y se reintenta una vez');
      accesoGmail = null;
      return enviarPorGmail(correo, log, true);
    }
    if (!res.ok) {
      log.error({ status: res.status, body: await res.text() }, 'Gmail rechazó el correo');
      return false;
    }
    return true;
  } catch (e) {
    log.error({ err: e }, 'No se pudo contactar con la API de Gmail');
    return false;
  }
}

export async function enviarCorreo(
  correo: Correo,
  log: FastifyBaseLogger,
): Promise<ResultadoEnvio> {
  if (env.correoDriver === 'resend') {
    return { enviado: await enviarPorResend(correo, log), driver: 'resend' };
  }
  if (env.correoDriver === 'gmail') {
    return { enviado: await enviarPorGmail(correo, log), driver: 'gmail' };
  }
  // Driver de consola. `info` y no `debug` para que se vea sin tocar el nivel de log:
  // en local y en staging, éste ES el buzón.
  log.info(
    { para: correo.to, asunto: correo.subject, cuerpo: correo.text },
    '📧 Correo (driver de consola — define RESEND_API_KEY o las GMAIL_* para enviarlo de verdad)',
  );
  /*
    `enviado: false`, y el `driver` dice por qué.

    Devolvía `true`, y eso hacía mentir a quien lo consultara: el rescate de contraseña
    del panel respondía `correoEnviado: true` y el operador colgaba el teléfono tranquilo
    mientras el cliente esperaba un correo que nunca salió de esta máquina. Escribirlo en
    el log es un buzón para desarrollar, no un envío.

    Quien llama tiene los dos datos y puede decir la verdad: "se envió", o "no hay correo
    configurado, dicta tú la contraseña".
  */
  return { enviado: false, driver: 'consola' };
}

/**
 * URL de la app del negocio. `APP_URL_TEMPLATE` lleva `{slug}` donde va el subdominio,
 * y así el mismo código sirve para `http://mi-negocio.localhost:5173` en local y para
 * `https://mi-negocio.vertexweb.lat` en producción.
 */
export function urlDelNegocio(slug: string, ruta = ''): string {
  const base = env.appUrlTemplate.replace('{slug}', slug).replace(/\/+$/, '');
  return base + ruta;
}
