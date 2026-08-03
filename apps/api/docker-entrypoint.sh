#!/bin/sh
# Arranque del contenedor del API: migra, siembra (si vacío) y levanta el API.
# Las variables (DATABASE_URL, JWT_*, etc.) llegan por el entorno de Docker,
# así que invocamos tsx directamente (sin --env-file).
set -e
cd /app

echo "[deploy] Aplicando migraciones…"
pnpm --filter @ventafacil/db exec tsx src/migrate.ts

echo "[deploy] Sembrando datos demo si la base está vacía…"
pnpm --filter @ventafacil/db exec tsx src/seed-if-empty.ts

echo "[deploy] Iniciando API…"
exec pnpm --filter @ventafacil/api exec tsx src/index.ts
