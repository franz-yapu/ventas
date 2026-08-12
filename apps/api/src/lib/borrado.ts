import { schema, withTenant, type TenantTx } from '@ventafacil/db';
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
 * - `sale.user_id` y `cash_register.user_id` → RESTRICT. Bien.
 * - `cash_register.closed_by` y `sale.cancelled_by` → **SET NULL**. Un turno cerrado sin
 *   saber quién lo cerró, y una venta anulada sin saber quién la anuló. Precisamente las
 *   dos acciones sobre las que un dueño querría preguntar. Y no las cubren los RESTRICT de
 *   arriba, porque quien cierra un turno no suele ser quien lo abrió — que es justamente
 *   el caso interesante.
 * - `cash_movement` → **SET NULL**. El retiro sobrevive pero **pierde quién lo hizo**, que
 *   es justo el dato por el que existe el registro.
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

/**
 * Qué cuelga de un COMPRADOR.
 *
 * Sólo sus ventas, y basta: `sale.customer_id` cuelga en **SET NULL**, así que borrar a
 * un comprador con historial no rompe nada… se lleva por delante a quién se le vendió.
 * Y eso es justo lo que un recibo necesita responder seis meses después, cuando alguien
 * vuelve con una llanta y hay que mirar qué se le vendió y cuándo.
 */
export async function colgandoDeComprador(
  businessId: string,
  customerId: string,
): Promise<Colgando> {
  return withTenant(businessId, (tx) => colgandoDeCompradorEn(tx, customerId));
}

/**
 * Lo mismo, pero dentro de una transacción que ya está abierta.
 *
 * Existe porque contar y borrar tienen que ser la MISMA operación. Cuando cada una abría
 * su transacción, entre las dos cabía una venta: un admin borra a «Recién llegado» (0
 * compras) justo cuando un cajero cierra su primera venta — la cuenta ya devolvió 0, el
 * comprador se borra en duro y `sale.customer_id` cae a NULL. El recibo recién emitido
 * pierde para siempre a quién iba dirigido, y el API contesta «se eliminó» sin decir que
 * dejó algo huérfano.
 *
 * Es la misma razón que estaba escrita en la ruta de abonos que se fue con el fiado:
 * «comprobar el cliente y registrar el abono en la misma transacción, para que no pueda
 * colarse un abono si el cliente desaparece entre una consulta y la otra».
 */
export async function colgandoDeCompradorEn(tx: TenantTx, customerId: string): Promise<Colgando> {
  const [ventas] = await tx
    .select({ n: count() })
    .from(schema.sale)
    .where(eq(schema.sale.customerId, customerId));

  const n = ventas?.n ?? 0;
  return {
    detalle: n ? [plural(n, 'compra registrada', 'compras registradas')] : [],
    total: n,
  };
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

    const [movimientos] = await tx
      .select({ n: count() })
      .from(schema.cashMovement)
      .where(eq(schema.cashMovement.userId, userId));

    const [bitacora] = await tx
      .select({ n: count() })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.userId, userId));

    /*
      Los dos que faltaban, y son los que peor se pierden.

      `cash_register.closed_by` y `sale.cancelled_by` cuelgan también en SET NULL, así que
      un borrado físico dejaba turnos cerrados sin saber QUIÉN los cerró y ventas anuladas
      sin saber QUIÉN las anuló. Justo esas dos: firmar un descuadre y anular una venta son
      las dos acciones sobre las que un dueño querría preguntar, y el nombre es la respuesta.

      No los cubrían los RESTRICT de `user_id` porque quien cierra un turno o anula una
      venta no suele ser quien la abrió o la hizo — de hecho, ése es justamente el caso
      interesante.
    */
    /*
      Un turno que esta persona abrió Y cerró es UN turno, no dos.

      Contar las dos columnas por separado y sumarlas decía "2 turnos de caja" donde había
      uno — y el mensaje que devuelve esta función es lo único que le explica a alguien por
      qué no puede borrar. Un número inflado hace dudar de todo el mensaje.
    */
    const [cerroTurnos] = await tx
      .select({ n: count() })
      .from(schema.cashRegister)
      .where(and(eq(schema.cashRegister.closedBy, userId), ne(schema.cashRegister.userId, userId)));

    const [anulo] = await tx
      .select({ n: count() })
      .from(schema.sale)
      .where(eq(schema.sale.cancelledBy, userId));

    const n = {
      ventas: ventas?.n ?? 0,
      turnos: (turnos?.n ?? 0) + (cerroTurnos?.n ?? 0),
      movimientos: movimientos?.n ?? 0,
      anuladas: anulo?.n ?? 0,
      bitacora: bitacora?.n ?? 0,
    };

    const detalle: string[] = [];
    if (n.ventas) detalle.push(plural(n.ventas, 'venta registrada', 'ventas registradas'));
    if (n.turnos) detalle.push(plural(n.turnos, 'turno de caja', 'turnos de caja'));
    if (n.movimientos)
      detalle.push(plural(n.movimientos, 'movimiento de caja', 'movimientos de caja'));
    if (n.anuladas) detalle.push(plural(n.anuladas, 'venta anulada', 'ventas anuladas'));
    if (n.bitacora)
      detalle.push(plural(n.bitacora, 'acción en la bitácora', 'acciones en la bitácora'));

    return {
      detalle,
      total: n.ventas + n.turnos + n.movimientos + n.anuladas + n.bitacora,
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
