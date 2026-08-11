# Lo que hay que hacer en el VPS antes de desplegar esta rama

Escrito el 2026-08-07, después de la revisión con tres agentes. **Lo ejecuta franz**: yo no
toco el servidor (hay un cliente real operando y todavía no hay backups fuera del VPS).

Todo lo demás de la rama despliega sin ceremonia. Esto no.

---

## 1. ⛔ El API NO ARRANCARÁ si no revisas dos variables

Este es el cambio que puede dejar el servicio caído si se despliega sin mirar.

### `JWT_ACCESS_SECRET`

Caía a un valor por defecto **también en producción**, y ese valor es el literal escrito
en `.env.example`. Con él, cualquiera que vea el repositorio puede firmarse un token de
administrador de cualquier negocio. Ahora el API se niega a arrancar si falta, si es el
literal de ejemplo, o si tiene menos de 32 caracteres — el mismo criterio que ya se
aplicaba a `CORS_ORIGINS`.

```bash
grep -E 'JWT_ACCESS_SECRET' /home/franz/deploy-ventafacil/.env
```

- **Si es el de `.env.example`** (`dev_access_secret_cambiame`), el sistema lleva desde el
  primer día firmando con una llave pública. Hay que rotarlo:

  ```bash
  openssl rand -base64 48
  ```

  ⚠️ **Rotarlo echa a todo el mundo**: los tokens en circulación dejan de valer y todos
  tienen que volver a entrar. Hacerlo **con el negocio cerrado**, no a media tarde.

- **Si es propio pero corto** (menos de 32 caracteres), el API tampoco arranca. Mismo
  procedimiento.

- **Si es propio y largo**, no hay nada que hacer.

### `RESEND_API_KEY`

Pasa a ser obligatoria en producción. Sin ella los correos **no se envían**: se escriben
en el log del servidor. En desarrollo eso es un buzón cómodo; en producción es una avería
silenciosa — quien se registra nunca recibe el enlace de verificación y quien olvida su
contraseña nunca recibe el de restablecimiento, y ninguno de los dos sabe por qué.

### `JWT_REFRESH_SECRET` se puede borrar del `.env`

No firmaba nada. Estaba en la configuración y ni una línea la usaba: los dos tokens de un
negocio se firman con `JWT_ACCESS_SECRET` y lo que los distingue es un claim que se
comprueba en las dos direcciones. Se quitó del código — una variable que promete separar
dos llaves y no separa nada es peor que no tenerla, porque quien la rota cree haber rotado
algo. Dejarla en el `.env` es inofensivo; el API la ignora.

## 2. Comprobar si quedaron filas de inventario huérfanas

La transferencia de stock permitía mandar existencias a una sucursal de OTRO negocio. En
local no quedó ninguna, pero en producción no lo he mirado —no puedo—. La consulta:

```sql
SELECT i.id, i.business_id, i.location_id, i.quantity, p.name
FROM inventory i
LEFT JOIN location l ON l.id = i.location_id
LEFT JOIN product p ON p.id = i.product_id
WHERE l.business_id IS DISTINCT FROM i.business_id;
```

Si devuelve filas, cada una es stock que se evaporó: ni el dueño ni el receptor podían
venderlo. Lo correcto es devolverlo a la ubicación de origen, no borrarlo — es mercadería
que existe en una estantería.

## 3. ⛔ Las fotos de producto necesitan un VOLUMEN, y no las salva `pg_dump`

Las fotos entraron el 11 de agosto de 2026. Traen dos cosas que hay que hacer en el
servidor **antes** de que alguien suba la primera, porque después ya es tarde.

### `MEDIA_DIR` tiene que apuntar a un volumen

`docker-compose.yml` ya lo trae montado (`media:/datos/media`) y el `.env.example` explica
la variable. Lo que hay que comprobar en el servidor es que el compose que corre allí sea
éste, con su sección `volumes`.

**Si la carpeta vive dentro del contenedor, cada despliegue borra las fotos de todos los
negocios.** No hay aviso ni vuelta atrás: la imagen se reemplaza entera. Es de las cosas
que sólo se descubren la segunda vez que se despliega.

### El respaldo ya no basta con la base

`product.image_url` guarda la **ruta**, no el archivo. Restaurar sólo el volcado de
Postgres dejaría cada producto apuntando a una foto que no existe.

`scripts/backup.sh` saca desde hoy un `media-<fecha>.tar.gz` junto al `.dump`, leyendo el
volumen desde el contenedor del API. Dos cosas que comprobar la primera vez:

- Que el nombre del contenedor coincide. Por defecto busca `vf-api`; si el tuyo se llama
  de otro modo, `API_CONTAINER=<nombre> ./scripts/backup.sh …`.
- Que el `.tar.gz` **se copia fuera del servidor** igual que el `.dump`. Un respaldo en el
  mismo disco no protege del caso más probable, que es perder el disco.

Si el paso de fotos falla, el script avisa por `stderr` y **sigue**: la base se respalda
igual. Esa prioridad es deliberada, pero significa que un aviso ignorado deja las fotos sin
copia sin que nada más lo diga.

### Lo que NO hace falta

No hay cupo de imágenes por plan —lo acota el límite de productos—, así que no hay nada que
configurar por negocio. El número a vigilar es el espacio libre del disco: con ~60 kB por
foto, 5.000 productos son unos 300 MB.

## 4. ⛔ La migración `0019` se PLANTA si en producción hay ventas al fiado

**Esta sección corrige lo que decía antes este documento.** Estaba escrito que «no hay
migraciones nuevas de base de datos», y era cierto cuando se escribió: dejó de serlo con el
commit `28116b1`, que quitó el fiado. Quien despliegue creyendo la frase de antes no hará
la comprobación de abajo.

`0019_fuera_el_fiado.sql` **borra la tabla `customer_payment` y recrea el enum
`payment_method` sin `credit`**. Empieza con una guarda que aborta la migración —con un
mensaje que explica qué hacer— si encuentra ventas a crédito o abonos. Que se plante es lo
correcto: son cuentas por cobrar, plata que el negocio no ha cobrado, y pasarlas a `cash` en
silencio diría que ya entró.

**En la base local había cero de las dos. En producción no está comprobado**, y ahí hay un
cliente real operando. Antes de migrar, con el `.env` de producción:

```bash
cd /home/franz/deploy-ventafacil   # donde vive el stack, con su .env
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT (SELECT count(*) FROM sale WHERE payment_method::text='credit') AS ventas_fiado,
          (SELECT count(*) FROM customer_payment) AS abonos;"
```

Va por **nombre de servicio** (`db`) y no por nombre de contenedor a propósito: el
`docker-compose.yml` de producción no fija `container_name`, así que el contenedor se llama
según la carpeta del stack y un nombre escrito a mano aquí fallaría. Las credenciales las
toma del `.env` que compose ya carga.

- **Los dos en cero** → la migración pasa sola, no hay nada que decidir.
- **Alguno distinto de cero** → **parar**. Exportar esas ventas (Reportes → Exportar) y
  decidir con el dueño qué pasa con esas cuentas por cobrar ANTES de aplicar nada. La
  migración no se puede deshacer: recrea un tipo de la base.

El resto de la rama (aislamiento, caja, catálogo por sucursal, cola offline, contraste, la
pantalla de Clientes, las fotos y el PDF) es código y migraciones normales.

---

## Sigue pendiente de antes, y esto no lo cambia

1. **Backup diario copiado FUERA del servidor.** Lo único cuyo coste, si sale mal, no se
   recupera con código. Los scripts están hechos y probados; falta el cron. Desde que hay
   fotos de producto son **dos archivos** los que hay que llevarse, no uno.
2. **Activar RLS** (`ENABLE_RLS=1`), tras un backup con restauración probada.
3. **Monitor de uptime** externo apuntando a `/health`.
4. Que un abogado revise los legales, y **los cinco datos de la empresa** para cerrar los
   marcadores de `packages/shared/src/legal.ts`.

## Y esto salió de la revisión del 11 de agosto

5. **`TERMS_VERSION` subió a `2026-08-11` y nadie compara nada.** Se guarda en
   `business.terms_version` al registrarse (`create-tenant.ts`) y ahí muere: no hay ningún
   sitio que contraste lo que un negocio aceptó con la versión vigente. Los términos
   cambiaron —se quitó el fiado, que era una de las cosas que describían— y **el negocio que
   ya opera no se va a enterar**. O se añade el aviso de reaceptación, o subir la constante
   es un gesto que no hace nada; lo que no puede quedarse es a medias, porque el campo da la
   impresión de que el consentimiento está al día. Va por el skill `legal`.
6. **Tres avisos moderados en `react-router-dom` 6.27** (open redirect vía `\` en `<Link>`,
   open redirect → XSS, inyección de constructor). El CI no los ve porque corta en `high`.
   Se arreglan subiendo a **6.30.5**. Ojo: en esta rama ya hubo una subida de versión que
   rompió seis caminos sin test, así que se hace con la suite delante y no de camino al
   despliegue.
