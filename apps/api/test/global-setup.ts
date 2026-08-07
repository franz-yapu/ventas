import { PLAN_CATALOG } from '@ventafacil/shared';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Conexión de dueño/superusuario: crea la base, migra y administra RLS.
 *
 * `TEST_DB_SUFFIX` permite correr dos suites A LA VEZ sin que se destruyan.
 *
 * Este setup BORRA y recrea la base al empezar, y el nombre era fijo: dos corridas
 * simultáneas —dos agentes trabajando en paralelo, o un `vitest --watch` mientras alguien
 * lanza `pnpm test`— se tiraban la base la una a la otra a mitad, con fallos que no se
 * parecen en nada a la causa. Con el sufijo, cada corrida tiene la suya:
 *
 *   TEST_DB_SUFFIX=_agente2 pnpm test
 */
const SUFIJO = process.env.TEST_DB_SUFFIX ?? '';

export const OWNER_DB_URL =
  process.env.TEST_DATABASE_URL ??
  `postgres://ventafacil:cambia_esto_en_produccion@localhost:5434/ventafacil_test${SUFIJO}`;

export const APP_ROLE = 'ventafacil_app';
export const APP_PASSWORD = 'app_test_pw';

/** URL con la que se conecta la APP en los tests: rol sin privilegios especiales. */
export function appDbUrl(): string {
  const u = new URL(OWNER_DB_URL);
  u.username = APP_ROLE;
  u.password = APP_PASSWORD;
  return u.toString();
}

const testDbName = new URL(OWNER_DB_URL).pathname.slice(1);

if (!/test/i.test(testDbName)) {
  // Salvaguarda: este setup BORRA la base. Que nunca pueda apuntar a dev o producción.
  throw new Error(
    `La base de tests debe llamarse *test* (recibida: "${testDbName}"). Abortando por seguridad.`,
  );
}

/** Recrea la base de tests, aplica migraciones y prepara el rol de aplicación. */
export async function setup() {
  const adminUrl = new URL(OWNER_DB_URL);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1 });

  try {
    await admin.unsafe(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${testDbName}' and pid <> pg_backend_pid()`,
    );
    await admin.unsafe(`drop database if exists "${testDbName}"`);
    await admin.unsafe(`create database "${testDbName}"`);
  } finally {
    await admin.end();
  }

  const owner = postgres(OWNER_DB_URL, { max: 1 });
  try {
    await migrate(drizzle(owner), { migrationsFolder: '../../packages/db/migrations' });

    // Catálogo de planes: el mismo que siembra `seed-plans` en producción, para que
    // los límites que se prueban aquí sean los que se van a cobrar. `plan` no lleva
    // business_id, así que `resetDb()` (que borra los negocios) no se la lleva.
    for (const p of PLAN_CATALOG) {
      await owner`
        insert into plan (code, name, description, price_monthly, currency,
                          max_locations, max_users, max_products, features, is_public, sort_order)
        values (${p.code}, ${p.name}, ${p.description}, ${p.priceMonthly}, ${p.currency},
                ${p.maxLocations}, ${p.maxUsers}, ${p.maxProducts},
                ${JSON.stringify(p.features)}::jsonb, ${p.isPublic}, ${p.sortOrder})
        on conflict (code) do nothing
      `;
    }

    // El rol con el que corre la app NO puede ser superusuario ni dueño de las tablas:
    // Postgres ignora las políticas de RLS para ambos. Este rol reproduce en los tests
    // la configuración que producción debería tener.
    await owner.unsafe(`
      do $$
      begin
        if not exists (select 1 from pg_roles where rolname = '${APP_ROLE}') then
          create role ${APP_ROLE} login password '${APP_PASSWORD}';
        end if;
      end $$;
    `);
    await owner.unsafe(`grant connect on database "${testDbName}" to ${APP_ROLE}`);
    await owner.unsafe(`grant usage on schema public to ${APP_ROLE}`);
    await owner.unsafe(
      `grant select, insert, update, delete on all tables in schema public to ${APP_ROLE}`,
    );
    await owner.unsafe(`grant usage, select on all sequences in schema public to ${APP_ROLE}`);
  } finally {
    await owner.end();
  }
}
