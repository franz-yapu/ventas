/**
 * Prepara una base para RLS: crea el rol de aplicación y activa las políticas.
 *
 *   pnpm --filter @ventafacil/db setup-rls            # sólo informa qué haría
 *   pnpm --filter @ventafacil/db setup-rls --apply    # lo ejecuta
 *
 * ⚠️  NO lo ejecutes en producción hasta que TODOS los módulos del API consulten
 *     mediante `withTenant()`. RLS falla cerrado: si la app no fija el negocio en la
 *     transacción, Postgres no devuelve ninguna fila y el sistema queda vacío.
 *     Orden correcto: migrar los módulos → verificar con los tests → activar aquí.
 *
 * Este script debe correr con el DUEÑO de las tablas (DATABASE_URL de siempre), no con
 * el rol de la app.
 */
import postgres from 'postgres';
import { enableRlsStatements } from './rls.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL no esta definida');

const appRole = process.env.APP_DB_ROLE ?? 'ventafacil_app';
const appPassword = process.env.APP_DB_PASSWORD;
const apply = process.argv.includes('--apply');

const sqlClient = postgres(url, { max: 1 });
const dbName = new URL(url).pathname.slice(1);

async function main() {
  const rows = await sqlClient<{ usesuper: boolean }[]>`
    select usesuper from pg_user where usename = current_user
  `;

  if (rows[0]?.usesuper) {
    console.log(
      `\n⚠️  El usuario actual es SUPERUSUARIO. Postgres ignora RLS para superusuarios,\n` +
        `   así que la app NO debe conectarse con él. Este script creará el rol "${appRole}"\n` +
        `   y a partir de ahí DATABASE_URL del API debe apuntar a ese rol.\n`,
    );
  }

  const roleStatements = appPassword
    ? [
        `do $$ begin
           if not exists (select 1 from pg_roles where rolname = '${appRole}') then
             create role ${appRole} login password '${appPassword}';
           end if;
         end $$`,
        `grant connect on database "${dbName}" to ${appRole}`,
        `grant usage on schema public to ${appRole}`,
        `grant select, insert, update, delete on all tables in schema public to ${appRole}`,
        `grant usage, select on all sequences in schema public to ${appRole}`,
        // Las tablas que se creen luego (nuevas migraciones) heredan los permisos.
        `alter default privileges in schema public grant select, insert, update, delete on tables to ${appRole}`,
      ]
    : [];

  if (!appPassword) {
    console.log(
      '· APP_DB_PASSWORD no está definida: se omite la creación del rol de aplicación.\n' +
        '  Defínela para crear/actualizar el rol con el que se conectará el API.\n',
    );
  }

  const all = [...roleStatements, ...enableRlsStatements];

  if (!apply) {
    console.log(`Se ejecutarían ${all.length} sentencias sobre "${dbName}":\n`);
    for (const s of all) console.log(`  ${s.replace(/\s+/g, ' ').slice(0, 110)}`);
    console.log('\nVuelve a correrlo con --apply para ejecutarlas.');
    return;
  }

  await sqlClient.unsafe('set client_min_messages to warning');
  for (const stmt of all) await sqlClient.unsafe(stmt);
  console.log(`✓ RLS activado en "${dbName}" (${all.length} sentencias).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sqlClient.end());
