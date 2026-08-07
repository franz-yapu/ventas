import type { FastifyBaseLogger } from 'fastify';
import { env } from '../env.js';
import { enviarCorreo } from './mailer.js';

/**
 * Aviso de errores en producción.
 *
 * El problema: hoy la única forma de enterarse de que algo se rompió es que llame un
 * cliente. Los 500 ya se registran en el log del contenedor, pero nadie mira un log a
 * las 3 de la tarde de un martes.
 *
 * Se envía un correo, reutilizando el mismo mailer del registro y la recuperación de
 * contraseña. Sin dependencias nuevas y sin otra cuenta que crear: si Resend está
 * configurado para los correos de los clientes, esto ya funciona.
 *
 * **Agrupado y con freno.** Un fallo no llega solo: una consulta rota puede tirar cien
 * peticiones en un minuto. Sin agrupar, el buzón se llena de cien correos idénticos y
 * la reacción natural es filtrarlos — justo lo contrario de lo que se busca. Se manda
 * como mucho un correo por ventana, con la cuenta de lo que pasó dentro.
 */

interface Acumulado {
  primerError: string;
  rutas: Map<string, number>;
  total: number;
  desde: number;
}

let acumulado: Acumulado | null = null;
let temporizador: NodeJS.Timeout | null = null;

/** Sólo para los tests. */
export function limpiarAlertas() {
  acumulado = null;
  if (temporizador) clearTimeout(temporizador);
  temporizador = null;
}

async function despachar(log: FastifyBaseLogger) {
  const a = acumulado;
  acumulado = null;
  temporizador = null;
  if (!a || !env.alertEmail) return;

  const rutas = [...a.rutas.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([r, n]) => `  ${n}×  ${r}`)
    .join('\n');

  await enviarCorreo(
    {
      to: env.alertEmail,
      subject: `[VentaFácil] ${a.total} error${a.total === 1 ? '' : 'es'} en el servidor`,
      text:
        `Se registraron ${a.total} errores en los últimos ${Math.round((Date.now() - a.desde) / 60000)} min.\n\n` +
        `Rutas afectadas:\n${rutas}\n\n` +
        `Primer error:\n${a.primerError}\n\n` +
        `El detalle completo está en el log del contenedor:\n` +
        `  docker logs --since 1h vf-api 2>&1 | grep "error no controlado"`,
    },
    log,
  );
}

/**
 * Registra un 500 para avisar. No espera al envío: un fallo del correo no puede
 * retrasar la respuesta al usuario, que ya está teniendo un mal momento.
 */
export function avisarDeError(err: Error, ruta: string, log: FastifyBaseLogger): void {
  if (!env.alertEmail) return;

  if (!acumulado) {
    acumulado = {
      primerError: `${err.name}: ${err.message}\n${err.stack?.split('\n').slice(1, 6).join('\n') ?? ''}`,
      rutas: new Map(),
      total: 0,
      desde: Date.now(),
    };
  }
  acumulado.total++;
  acumulado.rutas.set(ruta, (acumulado.rutas.get(ruta) ?? 0) + 1);

  if (!temporizador) {
    temporizador = setTimeout(() => {
      void despachar(log).catch((e) => log.warn({ err: e }, 'no se pudo enviar la alerta'));
    }, env.alertWindowMin * 60_000);
    // Que un aviso pendiente no impida al proceso terminar cuando se le pide parar.
    temporizador.unref?.();
  }
}
