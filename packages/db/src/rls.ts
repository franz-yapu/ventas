import { sql } from 'drizzle-orm';
import type { Database } from './client.js';

/**
 * Row-Level Security: el aislamiento entre negocios deja de depender de que cada
 * consulta recuerde su `where business_id = ...` y pasa a garantizarlo Postgres.
 *
 * Cómo funciona
 * -------------
 * Cada política compara `business_id` contra la variable de sesión `app.business_id`,
 * que `withTenant()` fija DENTRO de la transacción (`set_config(..., true)`). Al ser
 * local a la transacción se limpia sola al terminar, así que una conexión reutilizada
 * del pool nunca arrastra el tenant de la petición anterior.
 *
 * Falla cerrado: si nadie fijó la variable, `current_setting(..., true)` devuelve NULL,
 * la comparación es NULL (no true) y no se devuelve ninguna fila. Un descuido produce
 * "no veo nada", nunca "veo lo del vecino".
 *
 * FORCE es imprescindible
 * -----------------------
 * Postgres IGNORA las políticas para el dueño de la tabla. Como la app se conecta con
 * el mismo rol que creó el esquema, sin `FORCE ROW LEVEL SECURITY` las políticas
 * quedarían decorativas. Es el error clásico al activar RLS.
 */

/** Tablas con `business_id` propio. */
const TENANT_TABLES = [
  'business_counter',
  'location',
  'app_user',
  'category',
  'product',
  'inventory',
  'customer',
  'customer_payment',
  'sale',
  'audit_log',
  'user_dashboard_config',
  'cash_register',
  'cash_movement',
] as const;

/**
 * `business` queda fuera a propósito: es la tabla raíz y el alta de un negocio nuevo
 * (registro self-service) ocurre justamente cuando todavía no hay tenant en contexto.
 * Se sigue protegiendo con el filtro de aplicación. `sale_item` tampoco tiene
 * `business_id`; se protege heredando de su `sale`.
 */
const TENANT_VAR = 'app.business_id';

function policiesFor(table: string): string[] {
  return [
    `alter table "${table}" enable row level security`,
    `alter table "${table}" force row level security`,
    `drop policy if exists tenant_isolation on "${table}"`,
    `create policy tenant_isolation on "${table}"
       using (business_id = nullif(current_setting('${TENANT_VAR}', true), '')::uuid)
       with check (business_id = nullif(current_setting('${TENANT_VAR}', true), '')::uuid)`,
  ];
}

function saleItemPolicies(): string[] {
  return [
    `alter table "sale_item" enable row level security`,
    `alter table "sale_item" force row level security`,
    `drop policy if exists tenant_isolation on "sale_item"`,
    // Hereda el tenant de la venta a la que pertenece.
    `create policy tenant_isolation on "sale_item"
       using (exists (
         select 1 from "sale" s
         where s.id = sale_item.sale_id
           and s.business_id = nullif(current_setting('${TENANT_VAR}', true), '')::uuid
       ))
       with check (exists (
         select 1 from "sale" s
         where s.id = sale_item.sale_id
           and s.business_id = nullif(current_setting('${TENANT_VAR}', true), '')::uuid
       ))`,
  ];
}

export const enableRlsStatements: string[] = [
  ...TENANT_TABLES.flatMap(policiesFor),
  ...saleItemPolicies(),
];

export const disableRlsStatements: string[] = [...TENANT_TABLES, 'sale_item'].flatMap((t) => [
  `drop policy if exists tenant_isolation on "${t}"`,
  `alter table "${t}" no force row level security`,
  `alter table "${t}" disable row level security`,
]);

export async function enableRls(database: Database) {
  for (const stmt of enableRlsStatements) await database.execute(sql.raw(stmt));
}

export async function disableRls(database: Database) {
  for (const stmt of disableRlsStatements) await database.execute(sql.raw(stmt));
}
