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
# El contenedor se DESCUBRE, no se adivina.
#
# Aquí había escrito `vf-api` como valor por defecto, y ese contenedor no existe: el
# `docker-compose.yml` de producción no fija `container_name`, así que Docker lo llama
# `<carpeta-del-stack>-api-1`. El `docker inspect` fallaba siempre, el script se iba por la
# rama del else, lo decía por stdout **y terminaba con código 0** — o sea que un cron que
# sólo avisa cuando algo falla habría informado de un respaldo limpio todas las noches
# mientras las fotos no se salvaban ni una sola vez. Un fallo que se anuncia por el canal
# que nadie lee es indistinguible de no fallar.
#
# Se busca por la etiqueta que compose pone en sus contenedores, que sí es estable.
MEDIA_DIR_EN_CONTENEDOR="${MEDIA_DIR_EN_CONTENEDOR:-/datos/media}"
FOTOS_OK=0

if [ -z "${API_CONTAINER:-}" ]; then
  # `|| true` porque con `set -e` un grep sin resultados tumbaría el script entero después
  # de haber salvado la base correctamente.
  ENCONTRADOS=$(docker ps --filter "label=com.docker.compose.service=api" --format '{{.Names}}' 2>/dev/null || true)
  CUANTOS=$(printf '%s' "$ENCONTRADOS" | grep -c . || true)

  if [ "$CUANTOS" -gt 1 ]; then
    # En esta misma máquina conviven el stack de staging y el de producción. Respaldar el
    # equivocado sería peor que no respaldar: el archivo existe, pesa, y no es el que hace
    # falta el día de la restauración.
    echo "[backup] ERROR: hay varios contenedores de API corriendo:" >&2
    printf '%s\n' "$ENCONTRADOS" >&2
    echo "[backup] Indica cuál con API_CONTAINER=<nombre> para no respaldar el stack equivocado." >&2
  else
    API_CONTAINER="$ENCONTRADOS"
  fi
fi

if [ -n "${API_CONTAINER:-}" ] && docker inspect "$API_CONTAINER" >/dev/null 2>&1; then
  # Cuántas fotos hay ANTES de empacar.
  #
  # `tar` de un directorio vacío sale con 0 y escribe un gzip de ~45 bytes perfectamente
  # válido. Sin esta cuenta, un volumen `media` que no se montó en el redespliegue producía
  # un archivo hueco anunciado como OK que además disparaba la rotación de abajo: a los
  # KEEP_DAYS días no quedaba ni un respaldo bueno del único dato que `pg_dump` no cubre.
  CUANTAS=$(docker exec "$API_CONTAINER" find "$MEDIA_DIR_EN_CONTENEDOR" -type f 2>/dev/null | wc -l | tr -d ' ' || echo 0)

  if [ "$CUANTAS" -eq 0 ]; then
    echo "[backup] AVISO: $API_CONTAINER:$MEDIA_DIR_EN_CONTENEDOR no tiene ni una foto." >&2
    echo "[backup] Si el negocio tiene fotos, el volumen 'media' no está montado. NO se rota nada." >&2
  else
    MEDIA_FILE="$OUT_DIR/media-${STAMP}.tar.gz"
    if [ "$CUANTAS" -eq 1 ]; then PLURAL="foto"; else PLURAL="fotos"; fi
    echo "[backup] Volcando $CUANTAS $PLURAL desde $API_CONTAINER:$MEDIA_DIR_EN_CONTENEDOR…"
    if docker exec "$API_CONTAINER" tar -czf - -C "$MEDIA_DIR_EN_CONTENEDOR" . > "$MEDIA_FILE" 2>/dev/null; then
      # Y cuántas quedaron DENTRO del archivo, que es lo que de verdad se va a restaurar.
      EMPAQUETADAS=$(tar -tzf "$MEDIA_FILE" 2>/dev/null | grep -vc '/$' || true)
      if [ "$EMPAQUETADAS" -lt "$CUANTAS" ]; then
        echo "[backup] ERROR: se empaquetaron $EMPAQUETADAS de $CUANTAS fotos. Se descarta." >&2
        rm -f "$MEDIA_FILE"
      else
        echo "[backup] OK -> $MEDIA_FILE ($(wc -c < "$MEDIA_FILE") bytes, $EMPAQUETADAS $PLURAL)"
        FOTOS_OK=1
      fi
    else
      echo "[backup] ERROR: no se pudieron respaldar las fotos. La base SÍ se respaldó." >&2
      rm -f "$MEDIA_FILE"
    fi
  fi
else
  echo "[backup] ERROR: no se encontró el contenedor del API; las fotos NO se respaldaron." >&2
  echo "[backup] Si esta instalación no tiene fotos, ejecuta con SIN_FOTOS=1 para silenciarlo." >&2
fi

# La rotación de fotos SÓLO tras un respaldo verificado.
#
# Es la mitad que faltaba: borrar los archivos viejos después de un respaldo que falló, o
# que salió vacío, deja el disco limpio de lo único que no se puede reconstruir.
if [ "$FOTOS_OK" -eq 1 ]; then
  find "$OUT_DIR" -name 'media-*.tar.gz' -type f -mtime "+$KEEP_DAYS" -print -delete 2>/dev/null || true
fi

# Rotación: no acumular volcados para siempre en un disco de 50 GB.
find "$OUT_DIR" -name "${DB_NAME}-*.dump" -type f -mtime "+$KEEP_DAYS" -print -delete 2>/dev/null || true
echo "[backup] Conservando los últimos $KEEP_DAYS días."

# Salir con 2 si la base se salvó pero las fotos no.
#
# Es lo que convierte este fallo en uno que se ve. La forma normal de programar esto es
# `0 3 * * * /ruta/backup.sh`, y cron sólo manda correo cuando el código es distinto de
# cero: con un 0 de vuelta, meses de fotos sin respaldar no habrían producido ni un aviso.
# Se distingue del 1 a propósito — 1 es "no hay respaldo", 2 es "la base está a salvo,
# faltan las fotos" —, y `SIN_FOTOS=1` lo silencia para instalaciones que no las usan.
if [ "$FOTOS_OK" -eq 0 ] && [ -z "${SIN_FOTOS:-}" ]; then
  echo "[backup] La base está salvada, pero NO las fotos de producto (código 2)." >&2
  exit 2
fi
