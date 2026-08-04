/**
 * Siembra el catálogo de planes y da de alta la suscripción de los negocios que ya
 * existían antes del SaaS.
 *
 *   pnpm --filter @ventafacil/db seed-plans
 *
 * Es idempotente: se puede correr en cada despliegue. Actualiza los planes que ya
 * están (precios y límites salen de `PLAN_CATALOG`) y sólo inserta suscripciones
 * para los negocios que todavía no tienen.
 *
 * Los negocios preexistentes entran al plan interno `propietario`: ilimitado, sin
 * fecha de corte y sin precio. Ya te pagan por otra vía y no se enteraron de que
 * ahora hay planes — el paso a SaaS tiene que ser invisible para ellos.
 *
 * Corre con el DUEÑO de las tablas, igual que las migraciones y el seed.
 */
import { PLAN_CATALOG } from '@ventafacil/shared';
import { eq, isNull } from 'drizzle-orm';
import { db, queryClient } from './client.js';
import * as s from './schema.js';

/** Plan con el que se migra a los negocios anteriores al SaaS. */
const PLAN_LEGADO = 'propietario';

async function main() {
  for (const p of PLAN_CATALOG) {
    const row = {
      code: p.code,
      name: p.name,
      description: p.description,
      priceMonthly: p.priceMonthly,
      currency: p.currency,
      maxLocations: p.maxLocations,
      maxUsers: p.maxUsers,
      maxProducts: p.maxProducts,
      features: p.features,
      isPublic: p.isPublic,
      sortOrder: p.sortOrder,
    };
    await db
      .insert(s.plan)
      .values(row)
      .onConflictDoUpdate({ target: s.plan.code, set: row });
  }
  console.log(`✓ Catálogo de planes al día (${PLAN_CATALOG.length} planes).`);

  // Negocios sin suscripción -> son los de antes del SaaS.
  const huerfanos = await db
    .select({ id: s.business.id, name: s.business.name })
    .from(s.business)
    .leftJoin(s.subscription, eq(s.business.id, s.subscription.businessId))
    .where(isNull(s.subscription.businessId));

  if (huerfanos.length === 0) {
    console.log('✓ Todos los negocios ya tienen suscripción.');
    return;
  }

  await db.insert(s.subscription).values(
    huerfanos.map((b) => ({
      businessId: b.id,
      planCode: PLAN_LEGADO,
      status: 'active' as const,
    })),
  );
  for (const b of huerfanos) {
    console.log(`  · "${b.name}" -> plan ${PLAN_LEGADO} (activa)`);
  }
  console.log(`✓ ${huerfanos.length} negocio(s) migrado(s) al plan ${PLAN_LEGADO}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => queryClient.end());
