# Lo que hay que hacer en el VPS antes de desplegar esta rama

Escrito el 2026-08-07, después de la revisión con tres agentes. **Lo ejecuta franz**: yo no
toco el servidor (hay un cliente real operando y todavía no hay backups fuera del VPS).

Todo lo demás de la rama despliega sin ceremonia. Esto no.

---

## 1. ⛔ El API NO ARRANCARÁ sin dos variables nuevas

Este es el cambio que puede dejar el servicio caído si se despliega sin mirar.

`JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET` caían a un valor por defecto **también en
producción**, y ese valor es el literal que está escrito en `.env.example`. Con él,
cualquiera que vea el repositorio puede firmarse un token de administrador de cualquier
negocio. Ahora el API se niega a arrancar si faltan, si son el literal de ejemplo, o si
tienen menos de 32 caracteres — el mismo criterio que ya se aplicaba a `CORS_ORIGINS`.

**Antes de desplegar**, mirar qué tiene puesto el servidor:

```bash
grep -E 'JWT_ACCESS_SECRET|JWT_REFRESH_SECRET' /home/franz/deploy-ventafacil/.env
```

- **Si son los de `.env.example`** (`dev_access_secret_cambiame` / `dev_refresh_secret_cambiame`),
  el sistema lleva desde el primer día firmando con una llave pública. Hay que rotarlos:

  ```bash
  openssl rand -base64 48   # uno para cada uno
  ```

  ⚠️ **Rotarlos echa a todo el mundo**: los tokens en circulación dejan de valer y todos
  tienen que volver a entrar. Hacerlo **con el negocio cerrado**, no a media tarde.

- **Si son propios pero cortos** (menos de 32 caracteres), el API tampoco arranca. Mismo
  procedimiento.

- **Si son propios y largos**, no hay nada que hacer: despliega y ya.

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
