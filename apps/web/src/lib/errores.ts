import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';

/**
 * Aviso global de errores de consulta.
 *
 * El problema que resuelve: TanStack Query devuelve `data` vacío cuando la petición
 * falla, y las pantallas dibujan "Sin resultados". Un servidor caído, un corte de red
 * o un fallo del API se veían **exactamente igual que un negocio sin datos**. Así fue
 * como un error 500 en todos los endpoints pasó por "tienda recién creada".
 *
 * En vez de tocar las 17 pantallas una por una, se engancha el `QueryCache`, que es el
 * único punto por el que pasan todas.
 */

export interface ErrorGlobal {
  mensaje: string;
  /** 0 = no hubo respuesta (sin red o servidor caído). */
  status: number;
}

let actual: ErrorGlobal | null = null;
const escuchas = new Set<() => void>();

function avisar() {
  for (const fn of escuchas) fn();
}

export function suscribirError(fn: () => void): () => void {
  escuchas.add(fn);
  return () => escuchas.delete(fn);
}

export function errorActual(): ErrorGlobal | null {
  return actual;
}

export function limpiarError() {
  if (actual === null) return;
  actual = null;
  avisar();
}

function reportar(e: ErrorGlobal) {
  actual = e;
  avisar();
}

/**
 * Qué hacer cuando falla una consulta.
 *
 * Dos códigos NO levantan el aviso, a propósito:
 *
 *   · **401** — el cliente ya intenta refrescar la sesión y, si no puede, acaba en el
 *     login. Un aviso encima sería ruido durante una transición normal.
 *   · **402** — la suscripción cambió bajo los pies (suspendida, prueba vencida, cupo
 *     agotado). En vez de un aviso genérico se RELEE la suscripción, con lo que la app
 *     pasa sola a la pantalla que corresponde. Sin esto, suspender a un negocio no
 *     hacía nada en la pestaña que ya estaba abierta: el menú seguía completo y las
 *     listas salían vacías, así que el cajero seguía intentando cobrar.
 *
 * Si el aviso saltara también con esos dos, se volvería ruido y la gente dejaría de
 * leerlo, que es la forma habitual de que un aviso deje de servir para nada.
 */
export function manejarErrorDeConsulta(error: unknown, qc: QueryClient) {
  if (error instanceof ApiError) {
    if (error.status === 401) return;
    if (error.status === 402) {
      void qc.invalidateQueries({ queryKey: ['subscription'] });
      return;
    }
    reportar({ mensaje: error.message, status: error.status });
    return;
  }
  reportar({
    mensaje: 'No se pudo conectar con el servidor.',
    status: 0,
  });
}
