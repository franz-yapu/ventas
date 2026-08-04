import { schema, withTenant } from '@ventafacil/db';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';

/**
 * Revocación de sesiones.
 *
 * Antes de esto, los tokens eran autosuficientes: dar de baja a un empleado no lo
 * echaba de ningún lado, seguía renovando su sesión durante los 30 días de vida del
 * refresh. Ahora hay dos frenos, uno para cada tipo de token:
 *
 *   · **Refresh** — apunta a una fila de `refresh_session`. Si no está o está revocada,
 *     no vale. El corte es INMEDIATO.
 *   · **Access** — sigue siendo autosuficiente (dura 15 min), pero lleva dentro la
 *     versión de tokens del usuario (`tv`). Subirla en uno invalida todos los que
 *     estaban en circulación, sin guardar ni uno solo de ellos.
 */

// ── Caché de validez del usuario ───────────────────────────────
//
// Se consulta en CADA petición autenticada, igual que la suscripción. Con 60 s de
// vida, echar a alguien tarda como mucho un minuto en surtir efecto sobre un access
// token que ya tenía en la mano — y es inmediato en cuanto intente renovar.
const TTL_MS = 60_000;

interface Vigencia {
  isActive: boolean;
  /** Versión vigente. Un token con otra versión ya no vale. */
  tokenVersion: number;
  existe: boolean;
}

const cache = new Map<string, { value: Vigencia; expiresAt: number }>();

export function invalidateUser(userId: string) {
  cache.delete(userId);
}

/** Sólo para los tests. */
export function clearUserCache() {
  cache.clear();
}

async function leerVigencia(businessId: string, userId: string): Promise<Vigencia> {
  const [row] = await withTenant(businessId, (tx) =>
    tx
      .select({
        isActive: schema.appUser.isActive,
        tokenVersion: schema.appUser.tokenVersion,
      })
      .from(schema.appUser)
      .where(and(eq(schema.appUser.id, userId), eq(schema.appUser.businessId, businessId)))
      .limit(1),
  );
  if (!row) return { existe: false, isActive: false, tokenVersion: -1 };
  return { existe: true, isActive: row.isActive, tokenVersion: row.tokenVersion };
}

export async function vigenciaDelUsuario(
  businessId: string,
  userId: string,
): Promise<Vigencia> {
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await leerVigencia(businessId, userId);
  cache.set(userId, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

/**
 * ¿Sigue valiendo este token?
 *
 * Los tokens viejos (anteriores a esta función) no llevan `tv`; se tratan como
 * versión 0, que es la que tiene todo usuario al que nadie ha revocado nada. Así
 * desplegar esto no echa a nadie de golpe.
 */
export function tokenSigueValiendo(v: Vigencia, tv: number | undefined): boolean {
  if (!v.existe || !v.isActive) return false;
  return (tv ?? 0) === v.tokenVersion;
}

/** Versión actual del usuario, para meterla en los tokens que se firman. */
export async function versionDeTokens(businessId: string, userId: string): Promise<number> {
  return (await vigenciaDelUsuario(businessId, userId)).tokenVersion;
}

// ── Sesiones (refresh tokens) ──────────────────────────────────

export async function crearSesion(
  businessId: string,
  userId: string,
  ttlMs: number,
  userAgent?: string,
): Promise<string> {
  const [row] = await withTenant(businessId, (tx) =>
    tx
      .insert(schema.refreshSession)
      .values({
        businessId,
        userId,
        expiresAt: new Date(Date.now() + ttlMs),
        userAgent: userAgent?.slice(0, 200) ?? null,
      })
      .returning({ id: schema.refreshSession.id }),
  );
  return row!.id;
}

/** Sesión viva, o `null` si no existe, fue revocada o caducó. */
export async function sesionViva(businessId: string, jti: string) {
  const [row] = await withTenant(businessId, (tx) =>
    tx
      .select()
      .from(schema.refreshSession)
      .where(
        and(
          eq(schema.refreshSession.id, jti),
          eq(schema.refreshSession.businessId, businessId),
          isNull(schema.refreshSession.revokedAt),
        ),
      )
      .limit(1),
  );
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

export async function marcarUso(businessId: string, jti: string) {
  await withTenant(businessId, (tx) =>
    tx
      .update(schema.refreshSession)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.refreshSession.id, jti)),
  );
}

/** Cierra una sesión concreta (el "salir" de un dispositivo). */
export async function revocarSesion(businessId: string, jti: string) {
  await withTenant(businessId, (tx) =>
    tx
      .update(schema.refreshSession)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(schema.refreshSession.id, jti), isNull(schema.refreshSession.revokedAt)),
      ),
  );
}

/**
 * Echa al usuario de TODAS partes: revoca sus sesiones y sube la versión de sus
 * tokens, con lo que los access tokens que tenga en la mano dejan de valer también.
 *
 * Se llama al restablecer la contraseña, al desactivar al usuario y cuando la persona
 * pide cerrar sesión en todos los dispositivos.
 */
export async function revocarTodo(businessId: string, userId: string) {
  await withTenant(businessId, async (tx) => {
    await tx
      .update(schema.refreshSession)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.refreshSession.userId, userId),
          isNull(schema.refreshSession.revokedAt),
        ),
      );
    await tx
      .update(schema.appUser)
      .set({ tokenVersion: sql`${schema.appUser.tokenVersion} + 1` })
      .where(eq(schema.appUser.id, userId));
  });
  invalidateUser(userId);
}

/** Sesiones abiertas del usuario, para que pueda verlas y cerrarlas. */
export async function sesionesDe(businessId: string, userId: string) {
  return withTenant(businessId, (tx) =>
    tx
      .select({
        id: schema.refreshSession.id,
        userAgent: schema.refreshSession.userAgent,
        createdAt: schema.refreshSession.createdAt,
        lastUsedAt: schema.refreshSession.lastUsedAt,
        expiresAt: schema.refreshSession.expiresAt,
      })
      .from(schema.refreshSession)
      .where(
        and(
          eq(schema.refreshSession.userId, userId),
          isNull(schema.refreshSession.revokedAt),
        ),
      ),
  );
}

/**
 * Barrido oportunista de sesiones muertas, al iniciar sesión. Sin cron: una pieza que
 * puede dejar de correr, para una tabla que crece despacio.
 */
export async function limpiarSesionesViejas(businessId: string) {
  const hace30dias = new Date(Date.now() - 30 * 86_400_000);
  await withTenant(businessId, (tx) =>
    tx
      .delete(schema.refreshSession)
      .where(
        or(
          lt(schema.refreshSession.expiresAt, new Date()),
          lt(schema.refreshSession.revokedAt, hace30dias),
        ),
      ),
  );
}
