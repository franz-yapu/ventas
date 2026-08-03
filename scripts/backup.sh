#!/bin/sh
# Backup de la base de VentaFácil desde un contenedor Postgres.
#
#   ./scripts/backup.sh vf-staging-db ventafacil ventafacil ./backups
#
# Usa el formato custom de pg_dump (-Fc): comprimido y restaurable con pg_restore de
# forma selectiva. Guarda la salida FUERA del contenedor: un backup que vive en el mismo
# volumen que la base no protege de perder ese volumen, que es el caso más probable.
set -e

CONTAINER="${1:-vf-staging-db}"
DB_USER="${2:-ventafacil}"
DB_NAME="${3:-ventafacil}"
OUT_DIR="${4:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$OUT_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="$OUT_DIR/${DB_NAME}-${STAMP}.dump"

echo "[backup] Volcando $DB_NAME desde $CONTAINER…"
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$FILE"

# Un volcado que falló a medias puede quedar como archivo pequeño pero existente.
SIZE=$(wc -c < "$FILE")
if [ "$SIZE" -lt 1000 ]; then
  echo "[backup] ERROR: el volcado pesa $SIZE bytes, demasiado poco. Se descarta."
  rm -f "$FILE"
  exit 1
fi

echo "[backup] OK -> $FILE ($SIZE bytes)"

# Rotación: no acumular volcados para siempre en un disco de 50 GB.
find "$OUT_DIR" -name "${DB_NAME}-*.dump" -type f -mtime "+$KEEP_DAYS" -print -delete 2>/dev/null || true
echo "[backup] Conservando los últimos $KEEP_DAYS días."
