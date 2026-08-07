import { schema, withTenant } from '@ventafacil/db';
import { and, count, eq, ne } from 'drizzle-orm';

/**
 * Borrar de verdad, o desactivar. Nunca las dos cosas a medias.
 *
 * La política: si no cuelga NADA de la fila, se borra físicamente y se acabó — un error
 * de tecleo al dar de alta una sucursal no tiene por qué quedarse para siempre en la
 * lista. Si cuelga algo, no se borra: se desactiva, y se dice **qué** cuelga y **cuánto**.
 *
 * Lo segundo importa más de lo que parece. Un "no se puede eliminar" a secas obliga a
 * adivinar por qué, y quien lo lee acaba probando a borrar otras cosas para ver si así se
 * destraba. "Tiene 340 ventas y 12 turnos de caja" se entiende y no invita a romper nada.
 *
 * ## Por qué se cuenta tanto
 *
 * Porque las claves foráneas NO protegen todo, y lo que no protegen es lo peligroso. Del
 * repaso hecho sobre la base en agosto de 2026:
 *
 * **De una ubicación:**
 * - `sale` → RESTRICT. La base ya se niega. Bien.
 * - `cash_register` → **CASCADE**. Borrar una sucursal **borraría su historial de
 *   arqueos**. Y una sucursal puede tener turnos sin una sola venta —se abrió y se cerró
 *   en cero—, así que el RESTRICT de las ventas no cubre este caso: es exactamente el
 *   camino por el que "borrar una sucursal vacía" se lleva por delante meses de cierres.
 * - `inventory` → CASCADE. Da igual con cantidad cero; con stock es mercadería real que
 *   desaparecería del sistema estando en la estantería.
 * - `product`, `app_user`, `audit_log` → SET NULL. No se pierden, pero quedan huérfanos.
 *
 * **De un usuario:**
 * - `sale` y `cash_register` → RESTRICT. Bien.
 * - `customer_payment` y `cash_movement` → **SET NULL**. El abono o el retiro sobreviven
 *   pero **pierden quién los hizo**, que es justo el dato por el que existe el registro.
 * - `audit_log` → SET NULL. La bitácora se queda sin autor: es el único control contra el
 *   fraude interno, y sin autor no controla nada.
 *
 * Cambiar una clave foránea es una migración con riesgo sobre datos que ya existen.
 * Contar antes de borrar es barato, se lee, y cubre los mismos casos.
 */

export interface Colgando {
  /** Qué cuelga, en palabras: `['340 ventas', '12 turnos de caja']`. */
  detalle: string[];
  total: number;
}

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

/** Qué cuelga de una UBICACIÓN. */
export async function colgandoDeUbicacion(
  businessId: string,
  locationId: string,
): Promise<Colgando> {
  return withTenant(businessId, async (tx) => {
    const [ventas] = await tx
      .select({ n: count() })
      .from(schema.sale)
      .where(eq(schema.sale.locationId, locationId));

    const [turnos] = await tx
      .select({ n: count() })
      .from(schema.cashRegister)
      .where(eq(schema.cashRegister.locationId, locationId));

    const [usuarios] = await tx
      .select({ n: count() })
      .from(schema.appUser)
      .where(eq(schema.appUser.locationId, locationId));

    // Sólo el inventario CON EXISTENCIAS: una fila en cero es contabilidad, no mercadería.
    const [conStock] = await tx
      .select({ n: count() })
      .from(schema.inventory)
      .where(and(eq(schema.inventory.locationId, locationId), ne(schema.inventory.quantity, 0)));

    const n = {
      ventas: ventas?.n ?? 0,
      turnos: turnos?.n ?? 0,
      usuarios: usuarios?.n ?? 0,
      stock: conStock?.n ?? 0,
    };

    const detalle: string[] = [];
    if (n.ventas) detalle.push(plural(n.ventas, 'venta', 'ventas'));
    if (n.turnos) detalle.push(plural(n.turnos, 'turno de caja', 'turnos de caja'));
    if (n.usuarios) detalle.push(plural(n.usuarios, 'usuario asignado', 'usuarios asignados'));
    if (n.stock) detalle.push(plural(n.stock, 'producto con stock', 'productos con stock'));

    return { detalle, total: n.ventas + n.turnos + n.usuarios + n.stock };
  });
}

/** Qué cuelga de un USUARIO. */
export async function colgandoDeUsuario(businessId: string, userId: string): Promise<Colgando> {
  return withTenant(businessId, async (tx) => {
    const [ventas] = await tx
      .select({ n: count() })
      .from(schema.sale)
      .where(eq(schema.sale.userId, userId));

    const [turnos] = await tx
      .select({ n: count() })
      .from(schema.cashRegister)
      .where(eq(schema.cashRegister.userId, userId));

    const [abonos] = await tx
      .select({ n: count() })
      .from(schema.customerPayment)
      .where(eq(schema.customerPayment.userId, userId));

    const [movimientos] = await tx
      .select({ n: count() })
      .from(schema.cashMovement)
      .where(eq(schema.cashMovement.userId, userId));

    const [bitacora] = await tx
      .select({ n: count() })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.userId, userId));

    const n = {
      ventas: ventas?.n ?? 0,
      turnos: turnos?.n ?? 0,
      abonos: abonos?.n ?? 0,
      movimientos: movimientos?.n ?? 0,
      bitacora: bitacora?.n ?? 0,
    };

    const detalle: string[] = [];
    if (n.ventas) detalle.push(plural(n.ventas, 'venta registrada', 'ventas registradas'));
    if (n.turnos) detalle.push(plural(n.turnos, 'turno de caja', 'turnos de caja'));
    if (n.abonos) detalle.push(plural(n.abonos, 'abono cobrado', 'abonos cobrados'));
    if (n.movimientos)
      detalle.push(plural(n.movimientos, 'movimiento de caja', 'movimientos de caja'));
    if (n.bitacora)
      detalle.push(plural(n.bitacora, 'acción en la bitácora', 'acciones en la bitácora'));

    return {
      detalle,
      total: n.ventas + n.turnos + n.abonos + n.movimientos + n.bitacora,
    };
  });
}

/** El mensaje para quien intentó borrar algo que ya tiene historia. */
export function mensajeDesactivado(que: string, c: Colgando): string {
  return (
    `No se eliminó porque ${que} tiene ${c.detalle.join(', ')}. ` +
    'Se desactivó en su lugar: deja de usarse y su historial se conserva.'
  );
}
