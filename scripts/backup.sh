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

# ── Las fotos de producto ─────────────────────────────────────────────────────
#
# Esto NO está en el volcado de arriba, y es fácil no darse cuenta: `pg_dump` salva la
# base entera y da la sensación de salvarlo todo. Pero `product.image_url` sólo guarda la
# RUTA — el archivo vive en el volumen `media`. Restaurar únicamente la base dejaría cada
# producto apuntando a una foto que ya no existe.
#
# Es el único dato del sistema que se pierde para siempre si se pierde el disco: una venta
# se puede reconstruir de un recibo, y una foto de un producto ya vendido no la tiene nadie.
#
# Se salta si no hay contenedor de API (instalaciones sin fotos, o el script corriendo
# contra una base suelta): no tener fotos no puede hacer fallar el respaldo de la base.
API_CONTAINER="${API_CONTAINER:-vf-api}"
MEDIA_DIR_EN_CONTENEDOR="${MEDIA_DIR_EN_CONTENEDOR:-/datos/media}"

if docker inspect "$API_CONTAINER" >/dev/null 2>&1; then
  MEDIA_FILE="$OUT_DIR/media-${STAMP}.tar.gz"
  echo "[backup] Volcando las fotos desde $API_CONTAINER:$MEDIA_DIR_EN_CONTENEDOR…"
  if docker exec "$API_CONTAINER" tar -czf - -C "$MEDIA_DIR_EN_CONTENEDOR" . > "$MEDIA_FILE" 2>/dev/null; then
    echo "[backup] OK -> $MEDIA_FILE ($(wc -c < "$MEDIA_FILE") bytes)"
    find "$OUT_DIR" -name 'media-*.tar.gz' -type f -mtime "+$KEEP_DAYS" -print -delete 2>/dev/null || true
  else
    # Que falle NO tumba el respaldo de la base, pero tiene que verse: un aviso que nadie
    # lee es lo mismo que no avisar, así que sale por stderr y con código distinto de cero
    # al final no — la base ya está salvada, que es lo prioritario.
    echo "[backup] AVISO: no se pudieron respaldar las fotos. La base SÍ se respaldó." >&2
    rm -f "$MEDIA_FILE"
  fi
else
  echo "[backup] Sin contenedor '$API_CONTAINER': no se respaldan fotos de producto."
fi

# Rotación: no acumular volcados para siempre en un disco de 50 GB.
find "$OUT_DIR" -name "${DB_NAME}-*.dump" -type f -mtime "+$KEEP_DAYS" -print -delete 2>/dev/null || true
echo "[backup] Conservando los últimos $KEEP_DAYS días."
