# Staging local — ensayo del servidor

Stack en Docker que imita al VPS para probar despliegues, la activación de RLS y las
restauraciones de backup **sin acercarse a producción**. Todo corre en la máquina local.

Aparece en Portainer como el stack **`ventafacil-staging`**.

|                 | Desarrollo (`pnpm dev`)     | Staging (Docker)                       | Producción (VPS) |
| --------------- | --------------------------- | -------------------------------------- | ---------------- |
| API             | `localhost:3000`            | `localhost:3100`                       | `vertexweb.lat`  |
| Postgres        | `localhost:5434`            | `localhost:5435`                       | interno          |
| `NODE_ENV`      | development                 | **production**                         | production       |
| RLS             | apagado                     | **activo**                             | pendiente        |
| Usuario del API | `ventafacil` (superusuario) | **`ventafacil_app`** (sin privilegios) | pendiente        |

Los puertos son distintos a los de desarrollo a propósito: los dos stacks conviven sin
pisarse.

## Levantarlo

```bash
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d --build
docker logs -f vf-staging-api
```

Al arrancar, el contenedor migra, siembra si la base está vacía, crea el rol de
aplicación y activa RLS. Para levantarlo sin RLS: `ENABLE_RLS=0` en `.env.staging`.

Bajarlo conservando los datos: `docker compose -f docker-compose.staging.yml down`
Bajarlo y **borrar la base**: añadir `-v`.

## Las dos identidades de base de datos

Es la pieza central, y la razón de que este entorno exista:

- **`ventafacil`** (dueño, superusuario) — migra, siembra y administra RLS. Sólo se usa
  al arrancar el contenedor.
- **`ventafacil_app`** (sin privilegios) — con este corre el API.

**Postgres ignora RLS para superusuarios y para el dueño de las tablas.** Si el API se
conectara con el dueño, las políticas quedarían de adorno y todo _parecería_ correcto.
Por eso `DATABASE_URL` apunta al rol de aplicación y `OWNER_DATABASE_URL` al dueño.

Comprobado en este entorno: el rol de la app no puede escribir sin fijar el negocio.

```
$ psql -U ventafacil_app -c "insert into location (business_id, name) ..."
ERROR:  new row violates row-level security policy for table "location"
```

## Un subdominio por cliente

Cada negocio entra por **su propia dirección** y nunca ve que la plataforma es
compartida — nada de pedirle un "código de negocio" al iniciar sesión.

| Negocio           | En staging                         | En producción                     |
| ----------------- | ---------------------------------- | --------------------------------- |
| Llantas El Rapido | `llantas-el-rapido.localhost:5174` | `llantas-el-rapido.vertexweb.lat` |
| Ferretería        | `ferre-dos.localhost:5175`         | `ferre-dos.vertexweb.lat`         |

`*.localhost` resuelve solo en los navegadores modernos, así que en local se prueba
igual que en producción, sin tocar `/etc/hosts`.

**Cómo se resuelve el negocio**, en orden: subdominio → `VITE_BUSINESS_SLUG` (frontend
dedicado a un cliente) → lo que se escriba a mano (último recurso, sólo si el API lo
pide) → o nada, y el API lo deduce cuando hay un único negocio.

La web necesita `VITE_APP_DOMAIN` (el dominio base) para no confundirlo con un negocio:
sin ella, `ventafacil.com` daría el slug `ventafacil`. Los subdominios `www`, `app`,
`api`, `admin` y `staging` están reservados.

### CORS con comodín

Con un subdominio por cliente los orígenes no se pueden enumerar: habría que redesplegar
el API en cada alta. Por eso `CORS_ORIGINS` acepta comodín:

```
CORS_ORIGINS=https://*.vertexweb.lat,https://vertexweb.lat
```

El comodín cubre **un solo nivel**, así que `a.b.vertexweb.lat` y
`vertexweb.lat.malicioso.io` quedan fuera. Hay 6 tests que lo fijan.

### Lo que exige en producción

- **DNS comodín**: un registro `*.vertexweb.lat` apuntando al VPS.
- **Certificado SSL comodín** para `*.vertexweb.lat` (Let's Encrypt lo emite por
  DNS-01, no por HTTP-01).
- El frontend debe servirse desde cualquier subdominio, con `VITE_APP_DOMAIN` definido.

## Backups

```bash
./scripts/backup.sh vf-staging-db ventafacil ventafacil ./backups
./scripts/restore-test.sh ./backups/<archivo>.dump vf-staging-db
```

`backup.sh` vuelca en formato custom (`-Fc`), descarta volcados sospechosamente
pequeños y rota a los 14 días (`KEEP_DAYS`).

`restore-test.sh` restaura en una base **desechable** (`<db>_restore_test`), nunca sobre
la original, cuenta las filas y verifica que **las políticas de RLS viajaron en el
backup** — un backup que las perdiera restauraría los datos sin aislamiento.

Los volcados van a `backups/`, que está en `.gitignore`.

> En el VPS, el backup debe copiarse **fuera del servidor**. Un volcado que vive en el
> mismo disco que la base no protege del caso más probable: perder ese disco.

## Qué falta para llevar esto a producción

1. Crear el rol de aplicación en el VPS y apuntar `DATABASE_URL` a él.
2. Definir `CORS_ORIGINS` en el `.env` del servidor — **el API no arranca sin ella**.
3. Backup completo y prueba de restauración **antes** de activar RLS.
4. Activar RLS con `ENABLE_RLS=1`.

## Nota para el registro self-service (plan #6)

El alta de un negocio no puede correr entera con contexto de tenant, porque el negocio
todavía no existe. El orden que funciona: insertar en `business` (que está fuera de RLS)
y luego, ya con `withTenant(nuevoId, …)`, crear el contador, la ubicación y el admin.

`pnpm new-tenant` funciona hoy sólo porque se ejecuta como superusuario. El registro
self-service correrá con el rol de la app y **no** tendrá ese atajo.
