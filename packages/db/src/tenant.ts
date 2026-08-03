import { sql } from 'drizzle-orm';
import { db } from './client.js';

/** Transacción de Drizzle: lo que reciben las funciones dentro de withTenant. */
export type TenantTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Ejecuta `fn` con el negocio fijado en la sesión de Postgres, para que las políticas
 * de RLS sepan quién consulta.
 *
 * El tercer argumento `true` de `set_config` es lo importante: hace la variable LOCAL
 * a la transacción. Postgres la descarta al hacer commit o rollback, así que la
 * conexión vuelve al pool sin rastro del tenant anterior. Con una variable de sesión
 * normal, la siguiente petición que reutilizara esa conexión heredaría el negocio
 * equivocado — que es exactamente la fuga que se busca evitar.
 *
 *   const productos = await withTenant(user.businessId, (tx) =>
 *     tx.select().from(schema.product),   // sin where: RLS filtra por el tenant
 *   );
 */
export async function withTenant<T>(businessId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.business_id', ${businessId}, true)`);
    return fn(tx);
  });
}

/**
 * Para tareas de plataforma que legítimamente no tienen tenant (migraciones, alta de
 * un negocio nuevo, panel super-admin). Es un escape explícito: si aparece en un
 * módulo de negocio, es un error.
 */
export async function withoutTenant<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return db.transaction((tx) => fn(tx));
}
