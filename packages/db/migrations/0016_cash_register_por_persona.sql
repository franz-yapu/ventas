-- Índices para "los turnos que abrí o cerré yo".
--
-- El historial de caja de un vendedor filtra ahora por las dos columnas —el cajón es de la
-- ubicación y los turnos se relevan, así que quien cierra puede no ser quien abrió— y ese
-- filtro corre en cada carga de la pantalla. La tabla es pequeña hoy; con un año de turnos
-- de varias sucursales deja de serlo.
CREATE INDEX IF NOT EXISTS "cash_register_user_idx" ON "cash_register" ("user_id");
CREATE INDEX IF NOT EXISTS "cash_register_closed_by_idx" ON "cash_register" ("closed_by");
