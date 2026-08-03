# VentaFácil — Plan para construir el SaaS

> **Ordenado por prioridad.** El orden de este documento *es* el orden de trabajo: se
> empieza arriba y se baja. Dentro de cada bloque, los ítems también van en orden.
>
> Verificado contra el código real (revisión del 3 de agosto de 2026). Cada afirmación
> de estado cita el archivo donde se comprueba; si algo no coincide, gana el código.
>
> Stack: **pnpm + Turborepo · Fastify 5 · Drizzle + PostgreSQL 16 · React 18 PWA (Dexie)**
>
> **Prioridad:** 🔴 Bloquea · 🟠 Necesario para vender · 🔵 Escala, después

---

## Estado a 3 de agosto de 2026

| | Tarea | Estado |
|---|---|---|
| 🔴 | #1 Red de seguridad | 🟡 Hecho en local · falta el VPS |
| 🔴 | #2 Endurecer producción | ✅ Hecho |
| 🔴 | #3 Aislamiento (RLS) | 🟡 Código listo y probado · falta activarlo en el VPS |
| 🟠 | #4 Definir el precio | ⬜ Pendiente — decisión de negocio |
| 🟠 | #5–#10 Capa SaaS | ⬜ Pendiente (parte de #6 ya hecha) |
| 🔵 | #11–#14 Escala | ⬜ Pendiente |

**El bloque bloqueante está resuelto en todo lo que es programación.** 96 tests en verde
(82 del API, 23 de la web) y `pnpm typecheck` limpio.

### Lo que necesita el VPS y no se puede adelantar en local

1. Programar el backup diario y copiarlo **fuera del servidor**.
2. Crear el rol de aplicación y apuntar `DATABASE_URL` a él.
3. Activar RLS (`ENABLE_RLS=1`), después de un backup con restauración probada.
4. Definir `CORS_ORIGINS` — **el API no arranca sin ella** en producción.
5. DNS comodín `*.vertexweb.lat` y certificado SSL comodín (Let's Encrypt por DNS-01).
6. Rotar los secretos JWT si alguna vez se usaron los de `.env.example`.

Todo esto ya está ensayado en el staging local, así que en el servidor es ejecución, no
descubrimiento.

---

## 👉 Siguiente tarea

El **bloque 1 está resuelto en local**: staging en Docker con RLS activo, backups con
restauración probada, y los 13 módulos migrados. Lo único pendiente ahí necesita el VPS
(crear el rol de aplicación, programar el backup diario y activar RLS en producción).

Para seguir en local, lo siguiente es la **#4 — definir el precio**, de la que depende
todo el bloque 2.

---

# 🔴 BLOQUE 1 — Bloquea todo lo demás

Nada de la capa SaaS tiene sentido hasta que esto esté. Son, en este orden:

## #1 · Red de seguridad 🟡 HECHO EN LOCAL, falta llevarlo al VPS
**Por qué primero:** todo lo que sigue toca la base de datos donde hay ventas reales de
un cliente que paga. No se experimenta sin red.

- [x] **Staging local en Docker** que imita al VPS (`docker-compose.staging.yml`, stack
      `ventafacil-staging` en Portainer): mismo Postgres 16, misma imagen del API, mismo
      tuning de memoria, `NODE_ENV=production`, puertos 3100/5435 para convivir con
      `pnpm dev`. Documentado en `STAGING.md`.
- [x] **Script de backup** (`scripts/backup.sh`): formato custom `-Fc`, descarta volcados
      sospechosamente pequeños, rota a los 14 días.
- [x] **Prueba de restauración real** (`scripts/restore-test.sh`): restaura en una base
      desechable, cuenta filas y verifica que **las políticas de RLS viajan en el backup**
      — un backup que las perdiera restauraría los datos sin aislamiento. Ejecutado con
      éxito sobre staging.
- [x] **Procedimiento de arranque documentado** en el propio entrypoint: migrar y sembrar
      con el dueño, activar RLS, y recién entonces levantar el API con el rol sin
      privilegios.
- [ ] Programar el backup diario **en el VPS** y copiarlo **fuera del servidor**.
- [ ] Copia anonimizada de producción para staging (hoy staging usa datos de seed).

> Lo que falta necesita acceso al VPS. El procedimiento ya está ensayado en local.

## #2 · Endurecer la producción actual ✅ HECHO (3 ago 2026)
**Por qué:** esto ya estaba expuesto, con o sin SaaS. No era trabajo de SaaS, era deuda
de seguridad del presente.

- [x] **`@fastify/rate-limit`**: tope general de 600/min por IP (generoso, porque en una
      tienda todas las cajas salen por la misma IP) y límite propio en `POST /auth/login`
      de 20 intentos cada 5 min. Antes el login aceptaba fuerza bruta ilimitada.
- [x] **`@fastify/helmet`** con CSP desactivada (el API sólo responde JSON, nunca HTML).
      Verificado en vivo: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
      y ya no expone `X-Powered-By`.
- [x] **CORS estricto por entorno**: en producción exige `CORS_ORIGINS` y **el API no
      arranca sin ella** — un fallo ruidoso al desplegar es mejor que un agujero silencioso
      en marcha. Fuera de producción sigue abierto para no estorbar.
- [x] Todo configurable por entorno y documentado en `.env.example`.
- [x] **7 tests** (`apps/api/test/security.test.ts`), incluido el que comprueba que agotado
      el límite del login tampoco pasa la contraseña correcta.
- [ ] Rotar los secretos JWT de producción si alguna vez se usaron los de `.env.example`.
      *(Pendiente: requiere acceso al VPS.)*

> ⚠️ **Antes del próximo despliegue hay que definir `CORS_ORIGINS` en el `.env` del
> servidor**, o el API no levantará. Ej: `CORS_ORIGINS=https://vertexweb.lat`

## #3 · Aislamiento a prueba de descuidos (RLS) 🟡 CÓDIGO LISTO, falta infra
**Por qué:** es el verdadero requisito para vender. Hoy el aislamiento entre negocios
depende de que cada consulta recuerde su `where business_id`:

```ts
// apps/api/src/modules/products.ts:130
.where(and(eq(schema.product.id, id), eq(schema.product.businessId, user.businessId)))
```

El patrón está bien aplicado, pero depende de que el programador se acuerde **todas las
veces, para siempre**. Con un cliente propio es aceptable. Con clientes desconocidos
compartiendo base de datos, **un `businessId` olvidado es una fuga entre empresas**, y es
el bug que se descubre cuando ya es tarde.

- [x] **Migrar los 13 módulos de `apps/api/src/modules/` a `withTenant()`** ✅ (3 ago 2026).
      Se conservaron los `where business_id` como defensa en profundidad: RLS es el
      respaldo, no la única línea. De paso, varios handlers que hacían 2-3 consultas
      sueltas ahora las agrupan en una transacción (foto coherente y menos ida y vuelta).
      `business.ts` sigue con el `db` global a propósito: la tabla `business` está fuera
      de RLS porque hay que resolver el negocio *antes* de tener tenant, y lo mismo la
      parte del login que busca el negocio por slug.
- [x] **Suite que demuestra que la migración está completa** ✅:
      `apps/api/test/rls-integration.test.ts` (31 casos) ejercita los endpoints reales
      **con RLS activo**. Como RLS falla cerrado, cualquier handler sin migrar devolvería
      vacío y el test lo delataría. Empezó en 12 rojos y terminó en 0.
- [x] **Rol de aplicación creado y RLS activo en staging** ✅ (3 ago 2026). Verificado
      end-to-end contra el stack de Docker: dos negocios distintos, cada uno ve sólo lo
      suyo; venta completa con descuento de stock, KPI y auditoría; y el rol de la app
      confirmado como NO superusuario y sin `bypassrls`.
- [ ] Repetir en producción: crear el rol, apuntar `DATABASE_URL` y activar con
      `ENABLE_RLS=1`, **después** de un backup con restauración probada.
- [ ] Opcional: helper de repositorio que reciba el `AuthUser`, para que escribir una
      query sin tenant sea incómodo además de imposible.

> El código ya está listo para RLS. Lo que falta es de infraestructura (rol sin
> privilegios y staging), no de programación.

> 🔴 **Dos cosas que bloquean la activación** (verificadas, no obvias):
>
> 1. El usuario `ventafacil` de Postgres es **superusuario**, y Postgres **ignora RLS para
>    superusuarios** — ni `FORCE` les aplica. La API en producción se conecta con él, así
>    que activar RLS hoy no protegería nada *y lo parecería*. Hace falta un rol sin
>    privilegios: `pnpm --filter @ventafacil/db setup-rls` lo crea.
> 2. **RLS falla cerrado.** Mientras los módulos usen el `db` global sin fijar el negocio,
>    Postgres no devuelve ninguna fila. Por eso el orden de arriba no es negociable.

**✅ Salida del bloque:** puedes romper cosas sin miedo, la producción dejó de estar
expuesta, y aunque alguien olvide un `where`, Postgres no entrega datos de otro negocio.

---

# 🟠 BLOQUE 2 — Necesario para vender

## #4 · Definir el precio 🟠
**Va primero de este bloque porque todo lo demás depende de él.** ¿Cobras por negocio,
por sucursal o por usuario? La tabla de planes, los límites y el feature gating salen de
esta decisión de negocio, no técnica.

## #5 · Suscripciones 🟠
- [ ] Tablas `plan` y `subscription` (aditivas, no tocan el esquema existente).
- [ ] Estados: `trial` · `activa` · `morosa` · `suspendida` · `cancelada`.
- [ ] Límites por plan: nº de sucursales, usuarios, productos.
- [ ] Hook de Fastify que rechaza al tenant suspendido (mensaje claro, no un 500).
- [ ] Feature gating en el frontend según el plan.
- [ ] **Migrar Llantas El Rápido** a un plan `propietario` ilimitado, sin downtime. Es tu
      cliente real: el paso a SaaS tiene que ser invisible para él.

## #6 · Registro self-service 🟠
- [x] **Identificación del negocio por subdominio** ✅ (3 ago 2026). Cada cliente entra
      por `sunegocio.vertexweb.lat` y nunca ve que la plataforma es compartida; se
      descartó pedir un "código de negocio" en el login por delatarlo y añadir fricción.
      `CORS_ORIGINS` acepta comodín (`https://*.vertexweb.lat`) porque con un subdominio
      por cliente los orígenes no se pueden enumerar. Probado en staging con dos negocios.
      **Exige en producción: DNS comodín y certificado SSL comodín** (Let's Encrypt por
      DNS-01). Detalles en `STAGING.md`.
- [ ] Pantalla de registro que haga lo que hoy hace `new-tenant.ts` (negocio + sucursal +
      admin + contador de recibos). La lógica ya está escrita, sólo falta exponerla.
      Ojo al orden: insertar en `business` (fuera de RLS) y seguir con `withTenant`,
      porque el registro correrá con el rol de la app y no con el superusuario.
- [ ] Elegir el subdominio en el alta y validar que esté libre.
- [ ] **Recuperación de contraseña** — hoy no existe. Con clientes desconocidos es
      obligatorio: no puedes resetear a mano a cien negocios.
- [ ] Email transaccional (Resend / SES) para verificación y recuperación.
- [ ] Wizard inicial: sucursal, primeros productos, tema y textos.

## #7 · Panel super-admin 🟠
- [ ] Operador de plataforma **por encima** de `admin`. Hoy el enum es `['admin','seller']`
      y nada ve más de un negocio. Recomendado: tabla `platform_admin` aparte, para que
      ningún token de tenant pueda escalar a verlo todo.
- [ ] Listado de tenants, estado de suscripción, suspender/reactivar.
- [ ] Métricas: MRR, tenants activos, churn.

## #8 · Revocación de sesiones 🟠
- [ ] Refresh tokens con `jti` + lista de revocación. Hoy son stateless: si suspendes a un
      tenant, sus tokens siguen válidos hasta que expiren.

## #9 · Caja / arqueo 🟠
La tabla `cash_register` existe en el esquema **pero no tiene ni un endpoint ni una
pantalla** — está huérfana (`features/cash` es sólo el reporte Z). Es la brecha de
producto más visible: un POS sin cierre de caja cuesta venderlo a un negocio con empleados.

- [ ] Endpoints de apertura y cierre, con monto esperado vs. contado.
- [ ] Pantalla de arqueo y reporte de diferencias.
- [ ] Cierre Z apoyado en el reporte que ya existe.

## #10 · Legales, antes del primer registro público 🟠
- [ ] Términos de servicio y política de privacidad.
- [ ] Exportación de datos por tenant (si un cliente se va, tiene derecho a sus ventas).

**✅ Salida del bloque:** un negocio desconocido se registra, usa el POS y te paga.

---

# 🔵 BLOQUE 3 — Escala y profundidad

Nada de aquí bloquea vender. Se atiende cuando el uso lo pida.

## #11 · Cobro automático 🔵
- [ ] Pasarela local (Libélula / PagosNet / Tigo Money / QR Simple).
- [ ] Dunning: reintentos de cobro y suspensión automática.

## #12 · Operación 🔵
- [ ] CI/CD con GitHub Actions (hoy no hay `.github/`): lint → typecheck → test → build.
- [ ] Sentry + health checks sobre `/health` + alertas de uptime.
- [ ] **Infra:** el VPS es 1 vCPU / 4 GB con `max_connections=20` y `DB_POOL_MAX=8`.
      Aguanta unos pocos tenants; define en qué número migras a algo mayor.
- [ ] Documentación de la API (OpenAPI).

## #13 · Producto 🔵
- [ ] Mostrar en la UI las ventas `failed` de la cola offline y ofrecer reintento manual.
- [ ] Impresión térmica ESC/POS.
- [ ] Exportar reportes a Excel / PDF.
- [ ] Inventario profundo: proveedores, órdenes de compra, kardex valorizado,
      transferencias entre sucursales, alertas de stock bajo (`min_stock` ya existe).
- [ ] Ampliar cobertura de tests a `persistSale` y a los reportes.
- [ ] RBAC más fino, sólo si un cliente lo pide de verdad.
- [ ] Multi-moneda / multi-país (el esquema ya tiene `currency` y `tax_rate` por negocio).

## #14 · Soporte 🔵
- [ ] Plan de soporte y capacitación: en Bolivia un POS se vende con acompañamiento.

---

# ⏸️ APARTE — Facturación Bolivia (SIAT)

**No entra en la numeración porque está bloqueado por información externa, no por
esfuerzo.** Puede ser tu mayor diferenciador o tu mayor pozo: decide temprano si entras.

> ⚠️ **Los detalles normativos de esta sección no están verificados.** Una versión previa
> de este documento afirmaba requisitos concretos (CUIS, CUFD cada 24 h, CUF, servicios
> SOAP) generados por una IA, no consultados con la fuente. Las normas del SIN cambian.
> **Trata todo lo de abajo como preguntas, no como especificación.**

### Averiguar antes de estimar 🔴
- [ ] Confirmar con el SIN o un contador la **modalidad** que te aplica.
- [ ] Pedir acceso al ambiente de homologación y **la especificación oficial vigente**.
- [ ] Recién con el documento en mano, estimar el esfuerzo real.

### Decisiones que cambian la arquitectura 🔴
- [ ] ¿Facturas tú en nombre de los tenants, o cada uno con su propio certificado?
      La respuesta cambia el modelo de datos y tu exposición legal.
- [ ] `business` necesitará NIT y razón social; `location`, código de sucursal ante el SIN.
      Son migraciones de esquema.
- [ ] Retención de facturas por el plazo normativo → afecta backups y almacenamiento.

**A favor:** tu motor offline ya existe, así que el modo contingencia (emitir sin internet
y sincronizar al reconectar) reutiliza la cola de `offline/sync.ts`.

---

# ✅ HECHO

## Tests (era #0 del bloque 1) — 3 de agosto de 2026
- [x] Vitest en `apps/api` y `apps/web`; `pnpm test` corre las dos suites.
- [x] **28 tests de aislamiento** (`apps/api/test/tenant-isolation.test.ts`): crean los
      negocios A y B y comprueban que ninguna respuesta al token de A contiene un solo
      byte de B, endpoint por endpoint, en lectura y escritura.
- [x] **15 tests de la cola offline** (`apps/web/test/sync.test.ts`) con IndexedDB en
      memoria: sin red, con duplicados, con el API caído y agotando reintentos.
- [x] **10 tests de RLS** (`apps/api/test/rls.test.ts`).
- [x] Base desechable `ventafacil_test`, recreada en cada corrida, que aborta si su nombre
      no contiene "test". Los tests corren con un rol sin privilegios, no con el superusuario.

**Encontrado por estos tests:** `DELETE /categories/:id` respondía `200 {ok:true}` y
auditaba un borrado aunque no borrara nada. Corregido. No había ninguna fuga real entre
negocios.

## Mecanismo de RLS — 3 de agosto de 2026
- [x] Políticas para las 12 tablas con `business_id` (`packages/db/src/rls.ts`), más una
      para `sale_item` que hereda el tenant de su `sale`.
- [x] `withTenant()` (`packages/db/src/tenant.ts`): fija `app.business_id` con
      `set_config(..., true)`, **local a la transacción**, así una conexión reutilizada del
      pool nunca arrastra el tenant de la petición anterior.
- [x] `FORCE ROW LEVEL SECURITY` en todas las tablas.
- [x] Script de activación con simulacro: `pnpm --filter @ventafacil/db setup-rls`.

## Backoff de la cola offline — 3 de agosto de 2026
- [x] Antes reintentaba cada 30 s fijos ignorando `attempts`. Ahora cada venta guarda
      `nextAttemptAt` y el worker sólo envía las vencidas, con espera exponencial
      (15 s → 30 min) **y jitter**: sin él, todos los clientes que fallaron a la vez
      vuelven juntos y tumban el API al revivir.
- [x] Tras 10 intentos la venta pasa a `failed`: deja de reintentarse sola y queda visible
      (`useSyncStatus().failed`), con `retryFailed()` para reencolarla. Antes giraba en la
      cola para siempre.

---

## Punto de partida — lo que YA estaba construido

VentaFácil **ya era multi-tenant** antes de este plan. No hay que convertirlo en SaaS:
hay que ponerle la capa de negocio encima y endurecer el aislamiento.

| Capacidad | Dónde |
|---|---|
| `business_id` en las 12 tablas de negocio, con índices compuestos | `packages/db/src/schema.ts` |
| Tenant resuelto en login por slug del negocio | `apps/api/src/modules/auth.ts:20-39` |
| JWT access/refresh con `businessId` en el payload | `apps/api/src/plugins/auth.ts` |
| Alta de tenants por CLI (`pnpm new-tenant`) | `packages/db/src/new-tenant.ts` |
| White-label por tenant (tema, textos, logo, moneda, prefijo SKU) | `business.theme_json` / `texts_json` |
| Campos de producto configurables por rubro | `business.product_schema_json` |
| Roles y alcance por sucursal / central | `apps/api/src/lib/scope.ts` |
| Auditoría por tenant | tabla `audit_log` + `plugins/audit.ts` |
| Venta con descuento, 5 métodos de pago (incl. fiado) y anulación auditada | `schema.ts` (`sale`) + `modules/sales.ts` |
| Recibo correlativo por negocio asignado por el servidor | `business_counter.last_receipt_number` |
| Snapshot de nombre/precio/costo por línea | `sale_item` |
| Venta offline: UUID de cliente, cola outbox, idempotencia | `apps/web/src/offline/sync.ts` |
| Reportes y analítica (incl. lectura Z) | `modules/reports.ts`, `modules/analytics.ts` |
| PWA instalable | `vite-plugin-pwa` |
| Dockerfile del API + producción con dominio y SSL | `apps/api/Dockerfile`, `vertexweb.lat` |

**El producto POS está ~70% hecho.** Lo que falta es la capa SaaS, la seguridad para
clientes desconocidos, y las brechas de producto de la #9 y la #13.

---

## Lo que NO hay que hacer

- ❌ **Renombrar `business`→`organizations` y `location`→`branches`.** Es la misma
  jerarquía que ya existe. El rename toca 13 tablas, 13 módulos, migraciones y el
  frontend, sobre un sistema en producción con un cliente real, a cambio de nada.
- ❌ **Reconstruir la sync offline.** Ya existe y es correcta (idempotente por UUID).
- ❌ **Tablas `roles` + `permissions` genéricas.** Sobre-ingeniería a esta escala; el enum
  `admin|seller` + `scope.ts` alcanza para vender.
- ❌ **Un repo o proyecto separado para el SaaS.** El producto es el mismo POS; forkear
  obliga a arreglar cada bug dos veces.

---

## Estrategia de repositorio

- **`main`** — la versión vendible hoy, para el cliente que quiera su propia BD dedicada.
  Sólo correcciones y mejoras compartidas.
- **`feat/saas`** — sale de `main` y hereda todo lo suyo. Aquí va este plan.

Los cambios del Bloque 2 son **aditivos**: tablas y módulos nuevos, sin tocar el flujo de
venta. Llantas El Rápido sigue con su imagen actual y sólo se actualiza cuando el merge
esté verificado en staging.

---

*Corregido contra el código el 3 de agosto de 2026 y reordenado por prioridad.*
