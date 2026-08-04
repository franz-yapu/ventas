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

## Estado a 4 de agosto de 2026

| | Tarea | Estado |
|---|---|---|
| 🔴 | #1 Red de seguridad | 🟡 Hecho en local · falta el VPS |
| 🔴 | #2 Endurecer producción | ✅ Hecho |
| 🔴 | #3 Aislamiento (RLS) | 🟡 Código listo y probado · falta activarlo en el VPS |
| 🟠 | #4 Definir el precio | ✅ Por negocio, 3 planes + prueba de 14 días |
| 🟠 | #5 Suscripciones | ✅ Hecho |
| 🟠 | #6 Registro self-service | ✅ Hecho (falta sólo el wizard, aplazado) |
| 🟠 | #7 Panel super-admin | ✅ Hecho |
| 🟠 | #8–#10 Capa SaaS | ⬜ Pendiente |
| 🔵 | #11–#14 Escala | ⬜ Pendiente |

**El bloque bloqueante está resuelto en todo lo que es programación.** 183 tests en verde
(155 del API, 28 de la web) y `pnpm typecheck` limpio.

### Lo que necesita el VPS y no se puede adelantar en local

1. Programar el backup diario y copiarlo **fuera del servidor**.
2. Crear el rol de aplicación y apuntar `DATABASE_URL` a él.
3. Activar RLS (`ENABLE_RLS=1`), después de un backup con restauración probada.
4. Definir `CORS_ORIGINS` — **el API no arranca sin ella** en producción.
5. Definir **`JWT_PLATFORM_SECRET`** — **el API tampoco arranca sin ella**, ni si es
   igual a `JWT_ACCESS_SECRET`. Firma los tokens del panel, que ve y administra todos
   los negocios: `openssl rand -base64 48`.
6. DNS comodín `*.vertexweb.lat` y certificado SSL comodín (Let's Encrypt por DNS-01).
   El comodín ya cubre `admin.vertexweb.lat`, que es el panel.
7. Crear el primer operador de plataforma:
   `pnpm --filter @ventafacil/db new-platform-admin <email> "<Nombre>" <contraseña>`.
8. Rotar los secretos JWT si alguna vez se usaron los de `.env.example`.

Todo esto ya está ensayado en el staging local, así que en el servidor es ejecución, no
descubrimiento.

---

## 👉 Siguiente tarea

**Un negocio desconocido ya puede registrarse solo, usar el POS y ser cobrado.** Están
hechas la #4 (precio), la #5 (suscripciones), la #7 (panel) y la #6 (registro y
recuperación de contraseña), todas probadas contra el staging en Docker con RLS activo.

Lo que falta para **abrir el registro al público** son dos cosas, en este orden:

1. **#10 — legales**: términos de servicio y política de privacidad. Van antes del
   primer registro público, no después.
2. **#8 — revocación de sesiones**: hoy suspendes a un tenant y el corte es inmediato
   porque el API lo comprueba en cada petición, pero sus refresh tokens siguen siendo
   válidos, y restablecer la contraseña no echa a quien ya está dentro.

Y en el servidor: `RESEND_API_KEY`, `EMAIL_FROM` y `APP_URL_TEMPLATE`. **Sin la clave de
Resend el alta funciona pero nadie recibe el correo.**

La **#9 (caja/arqueo)** sigue siendo la brecha de producto más visible para vender, y no
depende de nada de lo anterior.

**Recuerda**: cambiar precios o cupos es editar `packages/shared/src/plans.ts` y correr
`pnpm --filter @ventafacil/db seed-plans`.

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

## #4 · Definir el precio ✅ DECIDIDO (4 ago 2026)
**Se cobra POR NEGOCIO, con límites incluidos.** Ni por sucursal ni por usuario: un
precio fijo al mes y un cupo de sucursales, usuarios y productos. Es lo más simple de
explicar al cliente y lo más simple de cobrar, y no castiga que el negocio dé de alta a
sus cajeros.

Tres planes públicos más 14 días de prueba, y un plan interno que no se vende:

| Plan | Precio/mes | Sucursales | Usuarios | Productos | Panel y bitácora |
|---|---|---|---|---|---|
| Básico | Bs. 149 | 1 | 3 | 500 | — |
| Pro | Bs. 299 | 3 | 10 | 5.000 | ✓ |
| Ilimitado | Bs. 599 | ∞ | ∞ | ∞ | ✓ |
| *Propietario* (interno) | — | ∞ | ∞ | ∞ | ✓ |

Los **precios y los cupos son una decisión de negocio y viven en un solo archivo**:
`packages/shared/src/plans.ts` (`PLAN_CATALOG`). Cambiarlos es editar ese archivo y
volver a correr `pnpm --filter @ventafacil/db seed-plans`; no hay ni un número escrito
a mano en el resto del código.

## #5 · Suscripciones ✅ HECHO (4 ago 2026)
- [x] **Tablas `plan` y `subscription`** (migración `0007`, aditiva). Van **fuera de
      RLS**, junto a `business`: son datos de la plataforma, y el panel super-admin
      (#7) tiene que poder listar todos los tenants — con una política de tenant no
      vería ninguno, porque RLS falla cerrado.
- [x] **Estados**: `trial` · `active` · `past_due` (morosa) · `suspended` · `cancelled`.
      La **prueba vencida no se guarda**: se deduce de `trial_ends_at`. Guardarla
      obligaría a un cron, y un cron que no corre un día regala el servicio.
- [x] **Límites por plan** en sucursales, usuarios y productos, comprobados en
      `POST /locations`, `POST /users` y `POST /products`. Sólo cuenta lo **activo**:
      desactivar libera cupo.
- [x] **Puerta en `requireAuth`**, no ruta por ruta: así una ruta nueva queda cubierta
      por el solo hecho de pedir autenticación. Responde **402**, no 401 — el frontend
      refresca el token ante un 401 y cierra sesión si falla, y echar al usuario al
      login no es la forma de decirle "renueva tu plan".
- [x] **Feature gating en los dos lados**: `requireFeature()` en el API y menús
      ocultos en la app. El frontend es comodía; quien decide es el servidor.
- [x] **Migrado Llantas El Rápido** al plan `propietario` (ilimitado, sin fecha de
      corte, precio 0). `seed-plans` da de alta a todo negocio que aún no tenga
      suscripción, así que la migración es un paso del arranque del contenedor y no
      un script que haya que acordarse de correr. Verificado en staging.
- [x] **28 tests** (`apps/api/test/subscription.test.ts`) y prueba end-to-end contra el
      staging en Docker con RLS activo.

> **Dos decisiones que protegen al cliente que ya paga**, y que conviene no revertir
> sin pensarlo:
>
> 1. **La morosidad NO corta el servicio.** Un pago atrasado le costaría al negocio su
>    día de caja. Se avisa con un banner y se persigue el cobro (#11).
> 2. **Un negocio sin fila de suscripción opera sin restricciones.** Es la decisión
>    menos mala: un fallo en la capa de cobro no puede dejar una tienda sin vender.
>    `seed-plans` hace que en la práctica no ocurra.
>
> La **lectura Z tampoco se limita nunca**: es el cierre de caja, parte del POS, no un
> extra de plan superior.

## #6 · Registro self-service 🟠
- [x] **Identificación del negocio por subdominio** ✅ (3 ago 2026). Cada cliente entra
      por `sunegocio.vertexweb.lat` y nunca ve que la plataforma es compartida; se
      descartó pedir un "código de negocio" en el login por delatarlo y añadir fricción.
      `CORS_ORIGINS` acepta comodín (`https://*.vertexweb.lat`) porque con un subdominio
      por cliente los orígenes no se pueden enumerar. Probado en staging con dos negocios.
      **Exige en producción: DNS comodín y certificado SSL comodín** (Let's Encrypt por
      DNS-01). Detalles en `STAGING.md`.
- [x] **Pantalla de registro** ✅ (4 ago 2026). El alta vive en `crearNegocio()`
      (`packages/db/src/create-tenant.ts`) y la usan **el CLI y la web**: dos
      implementaciones acabarían divergiendo y creando negocios a medias — sin
      contador de recibos, por ejemplo, con lo que la primera venta fallaría. Hay un
      test que comprueba justamente eso.
- [x] **Subdominio elegido en el alta**, propuesto desde el nombre y comprobado
      mientras se teclea. Las reglas (formato, longitud, reservados) están en
      `packages/shared/src/subdomain.ts`, una sola lista para la web y el API.
      Las mayúsculas se normalizan en vez de rechazarse: un hostname no las distingue.
- [x] **Recuperación de contraseña** ✅. Enlace por correo, válido 1 hora y de un solo
      uso. Pedir uno nuevo invalida el anterior. En la base se guarda **sólo el sha256**
      del token: quien leyera la tabla no podría entrar en ninguna cuenta.
- [x] **Email transaccional**: Resend por HTTP (sin dependencias nuevas). **Sin
      `RESEND_API_KEY` los correos se escriben en el log del API** con el enlace
      entero — así el flujo se prueba en local y en staging sin cuenta, y sin mandarle
      nada por error a nadie.
- [x] **Verificación del correo**, que **no bloquea**: el negocio vende desde el primer
      minuto y ve un aviso hasta confirmar. Verificar es lo que permite recuperar la
      contraseña, y eso es lo que dice el aviso — no un "confirma tu correo" a secas.
- [x] **Correo editable en el perfil**, para que los usuarios anteriores al registro
      (que no tienen ninguno) dejen de depender de que se lo resetees a mano.
      Cambiarlo lo deja sin verificar.
- [ ] Wizard inicial: sucursal, primeros productos, tema y textos. *(Aplazado a
      propósito: el alta ya deja el negocio listo para vender, y el wizard se diseña
      mejor cuando se vea dónde se atasca de verdad un cliente nuevo.)*

> **Antes de abrir el registro al público** hace falta la #10 (términos y privacidad) y
> definir `RESEND_API_KEY`, `EMAIL_FROM` y `APP_URL_TEMPLATE` en el servidor. Sin la
> clave de Resend el alta funciona pero **nadie recibe el correo**: los enlaces se
> quedan en el log.

> **Topes**: registro y "olvidé mi contraseña" están limitados a 5 por hora y por IP.
> Lo que se frena ahí no es la fuerza bruta, es usar el endpoint como máquina gratis
> para inundar el buzón de alguien o llenar la base de negocios basura.

## #7 · Panel super-admin ✅ HECHO (4 ago 2026)
- [x] **Tabla `platform_admin` aparte**, no un rol más del enum. Si el super-admin
      fuera `role: 'platform'`, cualquier fallo que dejara escribir el rol de un
      usuario convertiría a un cliente en operador de la plataforma.
- [x] **Dos llaves, no una comprobación**: los tokens del panel se firman con
      `JWT_PLATFORM_SECRET`, distinto del de los negocios. Un token de tenant no
      verifica contra él ni aunque le metieran el claim correcto, y el del panel no
      sirve para entrar al POS de nadie. **El API no arranca en producción sin esa
      variable, ni si es igual a `JWT_ACCESS_SECRET`.**
- [x] **Listado de tenants** con plan, estado y buscador; **detalle** con el uso real
      (usuarios, sucursales, productos, ventas, última venta); **suspender, reactivar
      y cambiar de plan**. El corte y la reactivación son **inmediatos**: la acción
      invalida la caché de suscripción en vez de esperar a que caduque. Importa —
      cuando reactivas a alguien que acaba de pagar, está mirando la pantalla.
- [x] **Métricas**: MRR de lo que está al día y, aparte, **MRR en riesgo** (morosas).
      Sumarlo todo daría un número más bonito y menos cierto. Más negocios por estado,
      y altas y bajas del mes.
- [x] **Bitácora propia** (`platform_audit_log`): quién suspendió a quién y cuándo.
      No se mezcla con el `audit_log` del negocio, que es suyo y que él ve.
- [x] **Panel en el subdominio `admin.`** (`admin.vertexweb.lat` → `/plataforma`), con
      su propia pantalla de entrada y su token guardado con otra clave: dar soporte con
      la sesión de un cliente abierta en la misma pestaña no pisa ninguna de las dos.
- [x] **24 tests** (`apps/api/test/platform.test.ts`), incluida la frontera en las dos
      direcciones, más prueba end-to-end contra el staging y revisión de la UI en
      navegador.

> El operador se crea por CLI en el servidor:
> `pnpm --filter @ventafacil/db new-platform-admin <email> "<Nombre>" <contraseña>`
> (mínimo 12 caracteres). No hay pantalla de registro ni recuperación: quien puede
> crear operadores puede ver y suspender a todos los clientes, así que hace falta
> acceso al servidor. El mismo comando cambia la contraseña si te quedas fuera.

> **Lo que NO tiene, a sabiendas:** *churn* en porcentaje. Calcularlo exige saber
> cuántos estaban activos al empezar el mes, y hoy no se guarda histórico de estados.
> Se muestran las bajas del mes, que es un número cierto, en vez de una tasa inventada.
> Si el churn hace falta de verdad, primero hay que registrar los cambios de estado.

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
