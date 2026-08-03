#!/bin/sh
# Prueba de restauración: restaura un backup en una base NUEVA y comprueba que los datos
# están. Es lo que convierte un archivo en un backup de verdad.
#
#   ./scripts/restore-test.sh ./backups/ventafacil-20260803-120000.dump vf-staging-db
#
# Restaura SIEMPRE en una base desechable (<db>_restore_test), nunca encima de la
# original: una prueba de restauración que puede destruir el original no es una prueba.
set -e

DUMP="$1"
CONTAINER="${2:-vf-staging-db}"
DB_USER="${3:-ventafacil}"
SRC_DB="${4:-ventafacil}"
TEST_DB="${SRC_DB}_restore_test"

if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "Uso: $0 <archivo.dump> [contenedor] [usuario] [base]"
  exit 1
fi

echo "[restore] Recreando la base de prueba $TEST_DB…"
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$TEST_DB\"" >/dev/null
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE \"$TEST_DB\"" >/dev/null

echo "[restore] Restaurando $DUMP…"
# --no-owner: la base de prueba puede no tener los mismos roles que el original.
docker exec -i "$CONTAINER" pg_restore -U "$DB_USER" -d "$TEST_DB" --no-owner < "$DUMP"

echo "[restore] Comprobando el contenido:"
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$TEST_DB" -c "
  SELECT 'negocios' AS tabla, count(*) FROM business
  UNION ALL SELECT 'usuarios',  count(*) FROM app_user
  UNION ALL SELECT 'productos', count(*) FROM product
  UNION ALL SELECT 'ventas',    count(*) FROM sale
  UNION ALL SELECT 'lineas',    count(*) FROM sale_item
  UNION ALL SELECT 'auditoria', count(*) FROM audit_log;"

# Que las politicas de RLS viajen en el backup es parte de lo que hay que verificar:
# restaurar los datos sin las politicas dejaria la copia sin aislamiento.
echo "[restore] Politicas de RLS restauradas:"
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$TEST_DB" -tc \
  "SELECT count(*) || ' politicas tenant_isolation' FROM pg_policies WHERE policyname='tenant_isolation';"

VENTAS=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$TEST_DB" -tAc "SELECT count(*) FROM sale")
if [ "$VENTAS" -eq 0 ]; then
  echo "[restore] ERROR: la base restaurada no tiene ventas. El backup no sirve."
  exit 1
fi

echo "[restore] OK: la restauracion contiene datos ($VENTAS ventas)."
echo "[restore] Limpiando $TEST_DB…"
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE \"$TEST_DB\"" >/dev/null
echo "[restore] Listo."
