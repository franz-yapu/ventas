# VentaFácil — Plan para construir el SaaS

> **Versión corregida contra el código real** (revisión del 3 de agosto de 2026).
> La versión anterior de este documento fue escrita sin leer el repositorio: daba por
> pendiente trabajo que ya está terminado y proponía renombrar el modelo de datos.
> Todo lo que sigue está verificado contra archivos concretos del repo.
>
> Stack: **pnpm + Turborepo · Fastify 5 · Drizzle + PostgreSQL 16 · React 18 PWA (Dexie)**
>
> **Prioridad:** 🔴 Crítico (bloquea) · 🟠 Alto (para vender) · 🔵 Medio (escala)

---

## Punto de partida real

VentaFácil **ya es multi-tenant**. No hay que convertirlo en SaaS: hay que ponerle
la capa de negocio encima y endurecer el aislamiento.

### Ya construido y funcionando

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
| Snapshot de nombre/precio/costo por línea (reportes históricos estables) | `sale_item` |
| Venta offline: UUID de cliente, cola outbox, reintentos, idempotencia | `apps/web/src/offline/sync.ts` |
| Reportes y analítica (incl. lectura Z por método de pago y vendedor) | `modules/reports.ts`, `modules/analytics.ts` |
| PWA instalable | `vite-plugin-pwa` |
| Dockerfile del API + despliegue en producción con dominio y SSL | `apps/api/Dockerfile`, `vertexweb.lat` |

**Estimación honesta: el producto POS está ~70% hecho. Lo que falta es la capa SaaS,
la seguridad para clientes desconocidos, y tres brechas de producto.**

### Lo que NO hay que hacer

- ❌ **Renombrar `business`→`organizations` y `location`→`branches`.** Es la misma
  jerarquía que ya tienes. El rename toca 13 tablas, 13 módulos del API, migraciones y
  el frontend, sobre un sistema en producción con un cliente real, a cambio de nada.
- ❌ **Reconstruir la sync offline.** Ya existe y es correcta (idempotente por UUID).
  Lo que falta son *pruebas*, no reescribirla.
- ❌ **Tablas `roles` + `permissions` genéricas.** Sobre-ingeniería para tu escala.
  El enum `admin|seller` + `scope.ts` alcanza para vender.
- ❌ **Un repo o proyecto separado para el SaaS.** El producto es el mismo POS; forkear
  significa arreglar cada bug dos veces. Rama `feat/saas` sobre este repo, y merge.

---

## Fase 0 — Antes de tocar nada

**Meta:** poder experimentar sin arriesgar los datos del cliente que ya te paga.

### 0.1 Red de seguridad 🔴
- [ ] **Backups automáticos de Postgres** (`pg_dump` diario a almacenamiento externo).
- [ ] **Probar una restauración real** en una BD vacía. Un backup no probado no es un backup.
- [ ] Ambiente de **staging** con copia anonimizada de producción.
- [ ] Documentar el procedimiento de migraciones en producción (hoy `pnpm db:migrate` a mano).

### 0.2 Tapar agujeros de la producción actual 🔴
Esto ya está expuesto hoy, con o sin SaaS. Es cuestión de días, no de fases.

- [ ] **`@fastify/rate-limit`**, sobre todo en `POST /auth/login` — hoy no hay ningún
      límite y el login acepta fuerza bruta ilimitada.
- [ ] **`@fastify/helmet`** (cabeceras de seguridad).
- [ ] **CORS estricto por entorno** — hoy `origin: true` acepta cualquier origen
      (`apps/api/src/index.ts:29`).
- [ ] Rotar los secretos JWT de producción si alguna vez se usaron los de `.env.example`.

### 0.3 Primeros tests ✅ HECHO
- [x] Vitest configurado en `apps/api` y `apps/web`; `pnpm test` corre las dos suites.
- [x] **Test de aislamiento entre tenants** (`apps/api/test/tenant-isolation.test.ts`, 28
      casos): crea los negocios A y B y comprueba que ninguna respuesta al token de A
      contiene un solo byte de B, endpoint por endpoint, en lectura y en escritura.
- [x] Test de la sync offline (`apps/web/test/sync.test.ts`, 15 casos) con IndexedDB
      en memoria: sin red, con duplicados, con el API caído y agotando reintentos.
- [x] Base de tests desechable (`ventafacil_test`), recreada en cada corrida, con
      salvaguarda que aborta si el nombre no contiene "test".
- [ ] Ampliar cobertura a la lógica de ventas (`persistSale`) y a los reportes.

**Encontrado por estos tests:** `DELETE /categories/:id` respondía `200 {ok:true}` y
auditaba un borrado aunque no borrara nada (id inexistente o de otro negocio). Corregido:
ahora devuelve 404 y no audita. No hubo ninguna fuga real de datos entre negocios.

**✅ Salida:** puedes romper cosas sin miedo, y la producción actual dejó de estar expuesta.

---

## Fase 1 — Aislamiento a prueba de descuidos

**Meta:** que sea *imposible* filtrar datos entre negocios, no solo improbable.

### 1.1 El problema real 🔴

Hoy cada consulta filtra el tenant **a mano**:

```ts
// apps/api/src/modules/products.ts:130
.where(and(eq(schema.product.id, id), eq(schema.product.businessId, user.businessId)))
```

El patrón es consistente y está bien aplicado, pero depende de que el programador se
acuerde **todas las veces, para siempre**. Con un solo cliente propio es aceptable.
Con clientes desconocidos compartiendo base de datos, **un `businessId` olvidado es una
fuga de datos entre empresas** — y es el tipo de bug que se descubre cuando ya es tarde.
`DECISIONS.md:22` ya lo dejó anotado como mejora futura; aquí deja de ser opcional.

### 1.2 Row-Level Security — mecanismo listo y probado ✅
- [x] Políticas para las 12 tablas con `business_id` (`packages/db/src/rls.ts`), contra la
      variable de sesión `app.business_id`.
- [x] `sale_item` cubierto con una política que hereda el tenant de su `sale` (sin
      necesidad de agregarle la columna).
- [x] `withTenant()` (`packages/db/src/tenant.ts`): abre transacción y fija la variable
      con `set_config(..., true)` — **local a la transacción**, así una conexión
      reutilizada del pool nunca arrastra el tenant de la petición anterior.
- [x] `FORCE ROW LEVEL SECURITY` en todas las tablas.
- [x] Suite que lo demuestra (`apps/api/test/rls.test.ts`, 10 casos): consultas escritas
      **a propósito sin `where business_id`** devuelven sólo las filas del negocio en
      contexto; sin contexto no devuelven nada (falla cerrado); un INSERT a nombre de otro
      negocio es rechazado; UPDATE y DELETE sin `where` no tocan filas ajenas.
- [x] Script de activación con simulacro: `pnpm --filter @ventafacil/db setup-rls`
      (agregar `--apply` para ejecutarlo).

> 🔴 **Hallazgo importante.** El usuario `ventafacil` de Postgres es **superusuario**, y
> Postgres **ignora RLS para superusuarios** — ni siquiera `FORCE` les aplica. La API en
> producción se conecta con ese usuario, así que activar RLS hoy no protegería nada.
> Es imprescindible crear un rol de aplicación sin privilegios (el script lo hace) y
> apuntar `DATABASE_URL` del API a ese rol. Sin este paso, todo lo demás es decorativo.

### 1.3 Lo que falta para poder activarlo 🔴
RLS **falla cerrado**: mientras los módulos consulten con el `db` global sin fijar el
negocio, Postgres no devolverá ninguna fila. Por eso el orden no es negociable:

- [ ] Migrar los 13 módulos del API para que consulten dentro de `withTenant()`.
      Es mecánico y los tests de 0.3 lo hacen seguro: deben seguir en verde tras cada módulo.
- [ ] Crear el rol de aplicación en desarrollo y en staging, y cambiar `DATABASE_URL`.
- [ ] Correr las suites **con RLS activo** contra staging.
- [ ] Recién entonces activarlo en producción.
- [ ] Opcional: helper de repositorio que reciba el `AuthUser`, para que escribir una
      query sin tenant sea incómodo además de imposible.

**✅ Salida:** aunque alguien olvide el `where`, Postgres no devuelve datos de otro negocio.

---

## Fase 2 — Capa SaaS

**Meta:** que un negocio se registre solo, tenga un plan y te pague.

### 2.1 Suscripciones 🟠
- [ ] **Definir el precio y la unidad de cobro antes de programar** (¿por negocio? ¿por
      sucursal? ¿por usuario?). Toda la tabla de planes depende de esta decisión de negocio.
- [ ] Tablas `plan` y `subscription` (aditivas, no tocan el esquema existente).
- [ ] Estados: `trial` · `activa` · `morosa` · `suspendida` · `cancelada`.
- [ ] Límites por plan: nº de sucursales, usuarios, productos.
- [ ] Hook de Fastify que rechaza al tenant suspendido (con mensaje claro, no un 500).
- [ ] Feature gating en el frontend según el plan.
- [ ] **Migrar Llantas El Rápido** a un plan `propietario` ilimitado, sin downtime.
      Es tu cliente real: el paso a SaaS tiene que ser invisible para él.

### 2.2 Registro self-service 🟠
- [ ] Pantalla de registro que hace lo que hoy hace `new-tenant.ts` (negocio + sucursal +
      admin + contador de recibos). La lógica ya está escrita, solo falta exponerla.
- [ ] Validar que el slug esté libre (ya es `unique` en el esquema).
- [ ] Email transaccional (Resend / SES) para verificación y recuperación de contraseña.
- [ ] Wizard inicial: sucursal, primeros productos, tema y textos.
- [ ] Recuperación de contraseña — **hoy no existe**; con clientes desconocidos es
      obligatorio (no puedes resetear a mano a cien negocios).

### 2.3 Panel super-admin 🟠
- [ ] Concepto de operador de plataforma **por encima** de `admin`. Hoy el enum de roles
      es `['admin','seller']` y no hay nada que vea más de un negocio.
      Decidir: ¿tercer rol, o tabla `platform_admin` aparte? (Recomendado: tabla aparte,
      para que ningún token de tenant pueda escalar a ver todo.)
- [ ] Listado de tenants, estado de suscripción, suspender/reactivar.
- [ ] Métricas: MRR, tenants activos, churn.

### 2.4 Revocación de sesiones 🟠
- [ ] Refresh tokens con `jti` + lista de revocación. Hoy son stateless: si suspendes o
      echas a un tenant, sus tokens siguen siendo válidos hasta que expiren.

**✅ Salida:** un negocio desconocido se registra, usa el POS y paga; tú lo administras.

---

## Fase 3 — Brechas de producto

**Meta:** cerrar lo que falta para que el POS aguante clientes más exigentes.

### 3.1 Caja / arqueo 🟠
La tabla `cash_register` existe en el esquema **pero no tiene ni un endpoint ni una
pantalla** — está huérfana (`features/cash` es solo el reporte Z). Es la brecha más
visible del producto: un POS sin cierre de caja es difícil de vender a un negocio con
empleados.

- [ ] Endpoints de apertura y cierre con monto esperado vs. contado.
- [ ] Pantalla de arqueo y reporte de diferencias.
- [ ] Cierre Z apoyado en el reporte que ya existe.

### 3.2 Sync offline ✅ HECHO
- [x] **Backoff real.** Antes reintentaba cada 30 s fijos ignorando `attempts`. Ahora cada
      venta guarda `nextAttemptAt` y el worker sólo envía las vencidas, con espera
      exponencial (15 s → 30 min) **y jitter**: sin el jitter, todos los clientes que
      fallaron a la vez vuelven juntos y tumban el API otra vez al revivir.
- [x] Salida para las ventas irrecuperables: tras 10 intentos pasan a `failed`, dejan de
      reintentarse solas y quedan visibles (`useSyncStatus().failed`) con `retryFailed()`
      para reencolarlas a mano. Antes giraban en la cola para siempre.
- [ ] Mostrar las ventas `failed` en la UI y ofrecer el reintento manual.
- [ ] Extender el offline más allá de las ventas si el uso lo pide (hoy sólo se cachea el
      catálogo y se encolan ventas, que es la decisión correcta para empezar).

### 3.3 Impresión y exportación 🔵
- [ ] Impresión térmica ESC/POS.
- [ ] Exportar reportes a Excel / PDF.

### 3.4 Inventario profundo 🔵
- [ ] Proveedores y órdenes de compra.
- [ ] Kardex valorizado.
- [ ] Transferencias entre sucursales.
- [ ] Alertas de stock bajo (`min_stock` ya existe en el esquema).

---

## Fase 4 — Facturación Bolivia (SIAT)

> ⚠️ **Los detalles normativos de esta fase no están verificados.** La versión anterior
> del documento afirmaba requisitos concretos (CUIS, CUFD cada 24 h, CUF, servicios SOAP)
> que son plausibles pero fueron generados por una IA, no consultados con la fuente. Las
> normas del SIN cambian. **Trata todo lo de abajo como preguntas, no como especificación.**

### 4.1 Averiguar antes de estimar 🔴
- [ ] Confirmar con el SIN o un contador la **modalidad** que te aplica.
- [ ] Pedir acceso al ambiente de homologación y **la especificación oficial vigente**.
- [ ] Recién con el documento en mano, estimar el esfuerzo real de esta fase.

### 4.2 Decisiones que cambian la arquitectura 🔴
- [ ] ¿Facturas tú en nombre de los tenants, o cada tenant con su propio certificado?
      La respuesta cambia el modelo de datos y tu exposición legal.
- [ ] `business` necesitará NIT y razón social; `location` probablemente código de
      sucursal ante el SIN. Son migraciones de esquema, planifícalas.
- [ ] Retención de facturas por el plazo normativo → afecta backups y costo de almacenamiento.

### 4.3 A favor 🟠
Tu motor offline ya existente es ventaja real aquí: el modo contingencia (emitir sin
internet y sincronizar al reconectar) reutiliza la cola de `offline/sync.ts`.

---

## Fase 5 — Escala

- [ ] 🔵 **Infra.** El VPS actual es 1 vCPU / 4 GB con `max_connections=20` y
      `DB_POOL_MAX=8`. Aguanta unos pocos tenants; define en qué número migras a algo mayor.
- [ ] 🔵 CI/CD con GitHub Actions (hoy no hay `.github/`): lint → typecheck → test → build.
- [ ] 🔵 Sentry + health checks sobre `/health` (ya existe en la raíz del API) + alertas.
- [ ] 🔵 Cobro automático con pasarela local (Libélula / PagosNet / Tigo Money / QR Simple).
- [ ] 🔵 Dunning: reintentos de cobro y suspensión automática.
- [ ] 🔵 RBAC más fino, si algún cliente realmente lo pide.
- [ ] 🔵 Multi-moneda / multi-país (el esquema ya tiene `currency` y `tax_rate` por negocio).

---

## Transversales

- [ ] Documentación de la API (OpenAPI).
- [ ] Términos de servicio y política de privacidad — obligatorios antes del primer registro público.
- [ ] Plan de soporte y capacitación: en Bolivia un POS se vende con acompañamiento, no solo con software.
- [ ] Exportación de datos por tenant (si un cliente se va, tiene derecho a sus ventas).

---

## Orden recomendado

1. **Backups probados + staging** (0.1) — antes de tocar nada.
2. **Rate-limit, helmet, CORS** (0.2) — días, no semanas; ya estás expuesto.
3. **Tests de aislamiento** (0.3) — necesitas la red antes de mover el trapecio.
4. **RLS** (Fase 1) — lo más caro de agregar después; es el verdadero requisito para vender.
5. **Definir el precio**, y recién entonces planes y suscripciones (2.1).
6. **Registro self-service + super-admin** (2.2, 2.3).
7. **Caja/arqueo** (3.1) — la brecha de producto más visible.
8. **SIAT** (Fase 4) — solo después de confirmar la norma con la fuente oficial.
9. **Escala** (Fase 5) — cuando el número de tenantes lo exija, no antes.

---

## Estrategia de repositorio

Un solo repo, rama `feat/saas`, merge a `main` cuando esté probado. Los cambios de la
Fase 2 son **aditivos**: tablas nuevas y módulos nuevos, sin tocar el flujo de venta. La
instalación de Llantas El Rápido sigue corriendo su imagen actual y solo se actualiza
cuando el merge esté verificado en staging.

---

*Corregido contra el código el 3 de agosto de 2026. Cada afirmación de estado se puede
verificar en el archivo citado; si algo no coincide, gana el código.*
