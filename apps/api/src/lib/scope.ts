import { schema, withTenant } from '@ventafacil/db';
import { and, eq, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
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
 * El filtro de alcance ya montado sobre una columna de ubicación.
 *
 * Es `viewScope` más el `eq` que venía detrás. La cuenta no es difícil —por eso estaba
 * copiada literal en siete módulos—, y precisamente por eso se olvidaba: las tres fugas de
 * costo que hubo que cerrar eran tres sitios donde alguien no repitió el patrón. Un
 * `undefined` significa lo mismo que en Drizzle: no filtres.
 *
 * Sirve tanto dentro de un `and(...)` como empujado a una lista de filtros.
 */
export function filtroDeUbicacion(user: AuthUser, columna: PgColumn): SQL | undefined {
  const scope = viewScope(user);
  return scope === undefined ? undefined : eq(columna, scope);
}

/**
 * ¿Esa ubicación es de ESTE negocio?
 *
 * La pregunta que hay que hacerse SIEMPRE que un `locationId` llegue de fuera, porque
 * ninguna de las funciones de aquí abajo la hace: comparan ubicaciones y miran roles,
 * pero no comprueban de quién son. Para un admin de la central, `canActOnLocation` y
 * `canAdjustInventory` devuelven `true` sin mirar el id — y eso es correcto dentro de su
 * negocio y catastrófico fuera de él.
 *
 * Ha mordido dos veces por separado:
 *
 * 1. `POST /users` aceptaba el `locationId` de otro negocio y dejaba al usuario con el
 *    `business_id` de uno y la ubicación de otro; al entrar recibía un token con
 *    `isCentral: true` heredado de una sucursal ajena.
 * 2. `POST /inventory/transfer` comprobaba el origen y **no el destino**: se podía mandar
 *    stock al inventario de otro negocio. La unidad se destruía —ni el dueño ni el
 *    receptor podían venderla—, el nombre de la sucursal ajena se filtraba en
 *    `GET /inventory`, y las filas fantasma salían en la exportación del negocio.
 *
 * Las dos veces la causa fue la misma y el arreglo también, así que vive aquí, junto al
 * resto de las decisiones de alcance, y no copiada en cada módulo.
 */
export async function esUbicacionDelNegocio(
  businessId: string,
  locationId: string,
): Promise<boolean> {
  const [loc] = await withTenant(businessId, (tx) =>
    tx
      .select({ id: schema.location.id })
      .from(schema.location)
      .where(and(eq(schema.location.id, locationId), eq(schema.location.businessId, businessId)))
      .limit(1),
  );
  return !!loc;
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
