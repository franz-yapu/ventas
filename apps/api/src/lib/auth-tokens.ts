import { db, schema } from '@ventafacil/db';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Enlaces de un solo uso que viajan por correo.
 *
 * Lo que se guarda es el **hash**, nunca el token. El valor que llega al correo son
 * 256 bits aleatorios; en la base queda su sha256. Quien leyera la tabla `auth_token`
 * no podría entrar en ninguna cuenta con lo que ve.
 *
 * sha256 pelado y no argon2: aquí no hay contraseña que adivinar. Un valor aleatorio
 * de 256 bits no se ataca por fuerza bruta, así que el coste de un hash lento no
 * compraría nada y sí retrasaría cada petición.
 */

export type Purpose = 'password_reset' | 'email_verify';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface TokenEmitido {
  /** El valor que va en el enlace del correo. No se guarda en ningún sitio. */
  token: string;
}

/**
 * Emite un token e invalida los anteriores del mismo tipo para ese usuario.
 *
 * Invalidar los viejos importa: si alguien pide restablecer tres veces, sólo debe
 * valer el último enlace. Si no, un correo antiguo interceptado seguiría abriendo la
 * cuenta días después.
 */
export async function emitirToken(
  userId: string,
  businessId: string,
  purpose: Purpose,
  ttlMs: number,
): Promise<TokenEmitido> {
  const token = randomBytes(32).toString('base64url');

  await db
    .update(schema.authToken)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(schema.authToken.userId, userId),
        eq(schema.authToken.purpose, purpose),
        isNull(schema.authToken.usedAt),
      ),
    );

  await db.insert(schema.authToken).values({
    businessId,
    userId,
    purpose,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + ttlMs),
  });

  return { token };
}

export interface TokenValido {
  id: string;
  userId: string;
  businessId: string;
}

/**
 * Busca un token vigente. Devuelve `null` si no existe, ya se usó o caducó — el mismo
 * `null` para los tres casos, porque distinguirlos por fuera no ayuda a nadie salvo a
 * quien esté probando tokens.
 */
export async function buscarToken(token: string, purpose: Purpose): Promise<TokenValido | null> {
  const [fila] = await db
    .select({
      id: schema.authToken.id,
      userId: schema.authToken.userId,
      businessId: schema.authToken.businessId,
    })
    .from(schema.authToken)
    .where(
      and(
        eq(schema.authToken.tokenHash, hashToken(token)),
        eq(schema.authToken.purpose, purpose),
        isNull(schema.authToken.usedAt),
        gt(schema.authToken.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return fila ?? null;
}

/** Marca el token como gastado. Se llama DENTRO de la operación que lo consume. */
export async function marcarUsado(id: string): Promise<void> {
  await db.update(schema.authToken).set({ usedAt: new Date() }).where(eq(schema.authToken.id, id));
}

/**
 * Limpia tokens viejos. Se llama de forma oportunista al emitir, no por un cron: la
 * tabla crece despacio y un cron es una pieza más que puede dejar de correr.
 */
export async function limpiarTokensViejos(): Promise<void> {
  const hace30dias = new Date(Date.now() - 30 * 86_400_000);
  await db
    .delete(schema.authToken)
    .where(
      or(
        lt(schema.authToken.expiresAt, hace30dias),
        and(
          eq(schema.authToken.purpose, 'password_reset'),
          lt(schema.authToken.createdAt, hace30dias),
        ),
      ),
    );
}
