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

## 3. Nada más

El resto de la rama (aislamiento, caja, catálogo por sucursal, cola offline, contraste) es
código y migraciones normales. **No hay migraciones nuevas de base de datos** en esta
tanda: los seis commits no tocan el esquema.

---

## Sigue pendiente de antes, y esto no lo cambia

1. **Backup diario copiado FUERA del servidor.** Lo único cuyo coste, si sale mal, no se
   recupera con código. Los scripts están hechos y probados; falta el cron.
2. **Activar RLS** (`ENABLE_RLS=1`), tras un backup con restauración probada.
3. **Monitor de uptime** externo apuntando a `/health`.
4. Que un abogado revise los legales, y **los cinco datos de la empresa** para cerrar los
   marcadores de `packages/shared/src/legal.ts`.
