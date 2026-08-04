import type { FastifyBaseLogger } from 'fastify';
import { env } from '../env.js';

/**
 * Envío de correo transaccional (verificación y recuperación de contraseña).
 *
 * Dos drivers, elegidos por configuración:
 *
 *   · **Resend** cuando hay `RESEND_API_KEY`. Es una llamada HTTP, sin dependencias.
 *   · **Consola** cuando no la hay: el correo se escribe en el log del API, con el
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

export type ResultadoEnvio = { enviado: boolean; driver: 'resend' | 'consola' };

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

export async function enviarCorreo(
  correo: Correo,
  log: FastifyBaseLogger,
): Promise<ResultadoEnvio> {
  if (env.resendApiKey) {
    return { enviado: await enviarPorResend(correo, log), driver: 'resend' };
  }
  // Driver de consola. `info` y no `debug` para que se vea sin tocar el nivel de log:
  // en local y en staging, éste ES el buzón.
  log.info(
    { para: correo.to, asunto: correo.subject, cuerpo: correo.text },
    '📧 Correo (driver de consola — define RESEND_API_KEY para enviarlo de verdad)',
  );
  return { enviado: true, driver: 'consola' };
}

/**
 * URL de la app del negocio. `APP_URL_TEMPLATE` lleva `{slug}` donde va el subdominio,
 * y así el mismo código sirve para `http://mi-negocio.localhost:5174` en local y para
 * `https://mi-negocio.vertexweb.lat` en producción.
 */
export function urlDelNegocio(slug: string, ruta = ''): string {
  const base = env.appUrlTemplate.replace('{slug}', slug).replace(/\/+$/, '');
  return base + ruta;
}
