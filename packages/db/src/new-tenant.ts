import { DEFAULT_PLAN_CODE, TRIAL_DAYS } from '@ventafacil/shared';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { db, queryClient } from './client.js';
import * as s from './schema.js';
import { withTenant } from './tenant.js';

// Onboarding rapido de un negocio nuevo: pnpm new-tenant "Nombre" adminUser adminPass [slug]
// (Fase 4 lo conecta a una pantalla; aqui queda la base CLI para crear tenants en minutos.)
const [name, username, password, slugArg] = process.argv.slice(2);
if (!name || !username || !password) {
  console.error('Uso: pnpm new-tenant "<Nombre del negocio>" <adminUser> <adminPass> [slug]');
  process.exit(1);
}

// Slug corto y único del negocio (código de acceso multi-negocio). Por defecto,
// derivado del nombre; se puede pasar explícito como 4º argumento.
const slug = (slugArg ?? name)
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

async function main() {
  // La suscripción apunta al plan por clave foránea: sin catálogo, el alta fallaría
  // con un error de Postgres poco útil.
  const [planRow] = await db
    .select({ code: s.plan.code })
    .from(s.plan)
    .where(eq(s.plan.code, DEFAULT_PLAN_CODE))
    .limit(1);
  if (!planRow) {
    console.error(
      `No existe el plan "${DEFAULT_PLAN_CODE}". Corre primero: pnpm --filter @ventafacil/db seed-plans`,
    );
    process.exit(1);
  }

  // El ORDEN importa con RLS activo:
  //
  //   1. `business` y `subscription` van FUERA de RLS -> se insertan sin contexto.
  //   2. Todo lo demás está bajo RLS con FORCE -> hay que fijar el negocio en la
  //      transacción o Postgres rechaza el insert.
  //
  // Hoy este comando corre con el dueño, que es superusuario, y Postgres ignora RLS
  // para superusuarios: con el `db` global también pasaría. Se hace bien igualmente
  // porque es la misma secuencia que necesitará el registro self-service (#6), que sí
  // correrá con el rol de la app, y porque el día que el dueño deje de ser
  // superusuario esto seguirá funcionando en vez de romperse sin aviso.
  const [biz] = await db.insert(s.business).values({ name: name!, slug }).returning();
  const businessId = biz!.id;

  // Suscripción en prueba. Sin ella el negocio no podría operar: el API bloquea a
  // quien no tiene un estado válido.
  await db.insert(s.subscription).values({
    businessId,
    planCode: DEFAULT_PLAN_CODE,
    status: 'trial',
    trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
  });

  const hash = await argon2.hash(password!);
  await withTenant(businessId, async (tx) => {
    await tx.insert(s.businessCounter).values({ businessId, lastReceiptNumber: 0 });
    // Ubicación central por defecto para que pueda vender de inmediato.
    const [loc] = await tx
      .insert(s.location)
      .values({ businessId, name: 'Principal', isCentral: true })
      .returning();
    await tx.insert(s.appUser).values({
      businessId,
      locationId: loc!.id,
      name: 'Administrador',
      username: username!,
      passwordHash: hash,
      role: 'admin',
    });
  });

  console.log(`✓ Negocio "${name}" creado con ubicación "Principal". Admin: ${username}`);
  console.log(`  Plan ${DEFAULT_PLAN_CODE}, en prueba por ${TRIAL_DAYS} días. Slug: ${slug}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => queryClient.end());
