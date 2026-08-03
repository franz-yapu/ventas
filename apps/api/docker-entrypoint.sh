#!/bin/sh
# Arranque del contenedor del API: migra, siembra (si vacío), prepara RLS y levanta.
# Las variables (DATABASE_URL, JWT_*, etc.) llegan por el entorno de Docker, así que
# invocamos tsx directamente (sin --env-file).
#
# DOS IDENTIDADES DE BASE DE DATOS, a propósito:
#
#   OWNER_DATABASE_URL -> dueño de las tablas. Migra, siembra y administra RLS.
#   DATABASE_URL       -> rol de la aplicación, SIN privilegios. Con el que corre el API.
#
# La separación es el requisito para que RLS sirva de algo: Postgres ignora las políticas
# para superusuarios y para el dueño de la tabla, así que si el API se conectara con el
# dueño, las políticas quedarían de adorno. Si no se define OWNER_DATABASE_URL se usa
# DATABASE_URL para todo, que es el comportamiento de siempre (sin RLS).
set -e
cd /app

OWNER_URL="${OWNER_DATABASE_URL:-$DATABASE_URL}"

echo "[deploy] Aplicando migraciones…"
DATABASE_URL="$OWNER_URL" pnpm --filter @ventafacil/db exec tsx src/migrate.ts

# El seed va ANTES de activar RLS: con FORCE ROW LEVEL SECURITY las políticas aplican
# también al dueño, así que sembrar después sería rechazado.
echo "[deploy] Sembrando datos iniciales si la base está vacía…"
DATABASE_URL="$OWNER_URL" pnpm --filter @ventafacil/db exec tsx src/seed-if-empty.ts

if [ "${ENABLE_RLS}" = "1" ]; then
  echo "[deploy] Creando el rol de aplicación y activando RLS…"
  DATABASE_URL="$OWNER_URL" pnpm --filter @ventafacil/db exec tsx src/setup-rls.ts --apply
else
  echo "[deploy] ENABLE_RLS no está en 1: se omite la activación de RLS."
fi

echo "[deploy] Iniciando API…"
exec pnpm --filter @ventafacil/api exec tsx src/index.ts
