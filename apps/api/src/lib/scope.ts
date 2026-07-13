import type { AuthUser } from '../types.js';

/**
 * Ubicación por la que se filtra la VISTA. `undefined` = ve todas (usuario de la central).
 * Un usuario de sucursal ve sólo su ubicación.
 */
export function viewScope(user: AuthUser): string | undefined {
  if (user.isCentral) return undefined; // ve todo
  return user.locationId ?? '__none__'; // sin ubicación -> no ve nada
}

/**
 * ¿Puede ACTUAR (crear/editar/cancelar) sobre recursos de esta ubicación?
 * Sólo admin. La central actúa sobre cualquier ubicación (es dueña del catálogo);
 * la sucursal sólo sobre la suya.
 */
export function canActOnLocation(user: AuthUser, locationId: string | null | undefined): boolean {
  if (user.role !== 'admin') return false;
  return user.isCentral || (!!locationId && user.locationId === locationId);
}

/**
 * ¿Puede AJUSTAR inventario de esta ubicación?
 * Excepción del plan: la central puede ajustar el de cualquier ubicación; la sucursal sólo la suya.
 */
export function canAdjustInventory(user: AuthUser, locationId: string): boolean {
  if (user.role !== 'admin') return false;
  return user.isCentral || user.locationId === locationId;
}
