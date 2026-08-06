import type { AuthUser } from '../types.js';

/**
 * UUID nulo. Es un uuid VÁLIDO que ninguna fila puede tener, así que sirve para decir
 * "no coincide con nada" en una comparación con una columna `uuid`.
 *
 * Antes aquí había el centinela `'__none__'`, que no es un uuid: Postgres lo rechazaba
 * con 22P02 y la app entera respondía 500. Y como el frontend enseña una lista vacía
 * cuando la petición falla, el usuario veía un negocio sin datos en vez de un error —
 * roto y silencioso a la vez, que es el peor de los dos mundos.
 */
export const NINGUNA_UBICACION = '00000000-0000-0000-0000-000000000000';

/**
 * Ubicación por la que se filtra la VISTA. `undefined` = ve todas las sucursales.
 *
 * Ver el negocio entero es cosa de ADMINISTRAR, no de estar en la central. Antes
 * bastaba con `isCentral`, así que un vendedor asignado a la sucursal central veía el
 * historial de ventas de todas las demás: podía auditar el turno de otro local desde su
 * caja. Un vendedor vende donde está; no supervisa a nadie.
 *
 * Un usuario sin ubicación no debería existir (ver `users.ts`), pero si aparece uno
 * —creado antes de esa validación, o por CLI— ve una lista vacía y no un error.
 */
export function viewScope(user: AuthUser): string | undefined {
  if (user.role === 'admin' && user.isCentral) return undefined; // ve todo
  return user.locationId ?? NINGUNA_UBICACION;
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
 * ¿Puede ANULAR una venta de esta ubicación?
 * Admin: central anula cualquiera, sucursal la suya (igual que canActOnLocation).
 * Vendedor: sólo ventas de SU propia ubicación (para corregir errores en su caja).
 * Queda auditado con motivo + autor; nunca se borra la venta.
 */
export function canCancelSale(user: AuthUser, saleLocationId: string | null | undefined): boolean {
  if (user.role === 'admin') return canActOnLocation(user, saleLocationId);
  return !!saleLocationId && user.locationId === saleLocationId;
}

/**
 * ¿Puede AJUSTAR inventario de esta ubicación?
 * Excepción del plan: la central puede ajustar el de cualquier ubicación; la sucursal sólo la suya.
 */
export function canAdjustInventory(user: AuthUser, locationId: string): boolean {
  if (user.role !== 'admin') return false;
  return user.isCentral || user.locationId === locationId;
}
