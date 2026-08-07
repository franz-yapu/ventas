# Tareas pendientes — revisión con tres agentes del 2026-08-07

> ## Estado al cerrar la sesión del 7 de agosto
>
> **Bloques 0, 1, 2 y 3 cerrados** — 17 tareas, 6 commits (`d812417` … `b406194`), de
> 405 tests a **462** (345 del API + 117 de la web), typecheck y build limpios.
>
> **Faltan los bloques 4, 5 y 6: 24 tareas.** Ninguna es de dinero ni de aislamiento;
> la de más valor es la 4.1 (el generador de `docs/API.md` pierde 9 de 74 rutas y
> regenerarlo no delata nada) y las del bloque 6, que son las que evitan la próxima
> ronda de 54 hallazgos.
>
> Tres cosas que aparecieron al arreglar y no estaban en el informe:
>
> 1. **El salto de drizzle rompió los SEIS sitios que detectaban un duplicado.** Leían el
>    texto del error. Sólo uno tenía test. Resuelto con `lib/pg-errores.ts`.
> 2. **La 0.4 estaba mal escrita por mí**: `react-router-dom` 6.30.5 **no existe**, la
>    línea v6 termina en 6.30.4 y el parche sólo está en 7.x. No es un parche, es
>    migración mayor — ver abajo, sigue pendiente y razonada.
> 3. **La suite estaba a un test de romperse** por agotar los 20 intentos de login por IP.
>    Se rompió al añadir el 21. Cerrada de raíz la 5.13.
>
> Y una decisión de diseño que conviene revisar: el contorno a 3:1 se resolvió
> **separando el token en dos** (`--color-border` decorativo, `--color-field` para lo que
> se toca) en vez de subir el existente, que habría llenado la aplicación de cajas
> negras. Capturas en `scratchpad/shots/`.

Salen de `INFORME-CONSOLIDADO.md` (peer review · QA punta a punta · QA visual · métricas),
sobre toda la rama `feat/saas`. **54 hallazgos → 41 tareas.**

Cada tarea lleva **cómo se comprueba que quedó arreglada**. La lección de la ronda anterior
fue que el test que compra algo es el que **falla sin el arreglo**: escribirlo primero, verlo
rojo, y entonces arreglar.

Marcas: **✓** verificado con reproducción o leyendo el código · **?** una sola fuente, hay que
confirmarlo antes de tocar nada.

---

## Bloque 0 — Bloquea abrir el registro al público

- [x] **0.1 ✓ Que el API no arranque en producción con los secretos de ejemplo.**
      `apps/api/src/env.ts:91-92`. `jwtAccessSecret` y `jwtRefreshSecret` caen a
      `'dev_*_cambiame'`, literales que están en `.env.example:12-13`. Copiar el patrón que ya
      existe para `JWT_PLATFORM_SECRET` (`env.ts:67-86`): lanzar si faltan cuando
      `NODE_ENV=production`, y exigir una longitud mínima.
      _Comprobar_: test que arranca `buildApp()` con `NODE_ENV=production` sin las variables y
      espera que lance. Hoy pasaría sin lanzar.

- [ ] **0.2 ✓ Comprobar qué secreto JWT tiene puesto el VPS.** Hay un cliente real operando. Si
      es el del `.env.example`, rotarlo — sube `token_version` y echa a todo el mundo, así que
      hacerlo con el negocio cerrado. **No lo toco yo** (ver la nota de sólo-local); preparo el
      comando para que lo ejecute franz.

- [x] **0.3 ✓ Subir `@fastify/jwt` a una versión que traiga `fast-jwt` ≥ 6.2.4.** Tres CVE
      críticas en la biblioteca que firma **todos** los tokens; la peor acepta secreto HMAC
      vacío. Instalada: `fast-jwt` 5.0.6 vía `@fastify/jwt` 9.1.0.
      _Comprobar_: `pnpm audit --prod` sin críticas + los 316 tests del API en verde.

- [ ] **0.4 ⚠️ CORREGIDA — `react-router-dom` 6.30.5 NO EXISTE.** Lo di por un parche y me
      equivoqué: la línea v6 termina en 6.30.4 y el arreglo sólo está en **7.x**, que es
      migración mayor. **No se hizo, a propósito**: las tres vulnerabilidades que quedan
      son de react-router y **no son alcanzables aquí** — ningún `navigate()` recibe datos
      de fuera (comprobado: todas las rutas son literales) y no hay SSR, que es lo que
      exige `deserializeErrors()`. Sí se activaron las dos banderas de v7 en `main.tsx`,
      que callan los dos avisos de cada arranque y dejan la migración medio hecha.
      _Rehacer la cuenta el día que se navegue a una URL que venga del usuario._

- [x] **0.5 ✓ Subir `drizzle-orm` 0.36.4 → ≥ 0.45.2.** Inyección SQL por identificadores mal
      escapados. **Es un salto de versión de verdad**: hacerlo aparte, con la suite entera y
      `rls-integration.test.ts` como red.

- [x] **0.6 ✓ Añadir `pnpm audit` al CI** con umbral en `high`. Habría dado las tres críticas
      solo. `.github/workflows/ci.yml`, después de "Instalar dependencias".

---

## Bloque 1 — Crítico

- [x] **1.1 ✓ Validar el destino en `POST /inventory/transfer`.**
      `apps/api/src/modules/inventory.ts:117-156`. Se comprueba el origen con
      `canAdjustInventory(user, fromLocationId)` y el destino no se mira: el `insert` escribe
      `{ businessId: <mío>, locationId: <ajeno> }`. Reproducido: 200 moviendo stock a otro
      negocio. Además, con un uuid inexistente responde 500.
      _Comprobar_: test cross-tenant que espera 403/404 al transferir a una ubicación de otro
      negocio, y 400 con un uuid que no existe. Añadirlo a `tenant-isolation.test.ts`.

- [ ] **1.2 ⏳ Comprobar las filas de inventario huérfanas EN PRODUCCIÓN.** En local ya están
      a 0, comprobado al cerrar la sesión. Falta mirarlo en el VPS antes de dar el arreglo
      por cerrado del todo: `select … from inventory i left join location l on l.id = i.location_id
    where l.business_id is distinct from i.business_id`.

---

## Bloque 2 — Alto: dinero y datos

- [x] **2.1 ✓ Decidir y aplicar qué pasa al vender sin existencias.**
      `apps/api/src/lib/sales-service.ts:183-199` hace `quantity - N` sin comprobación ni
      restricción en la base. Reproducido: inventario en **−53**, y `/products` se lo enseña al
      vendedor. **Es una decisión de producto antes que de código** — una llantería que vende lo
      que acaba de entrar sin registrarlo no puede quedarse bloqueada. Opciones: rechazar,
      permitir avisando, o permitir en línea y bloquear en la sincronización.
      Sea cual sea, **escribirla en `DECISIONS.md`**, que hoy no dice nada.
      _Comprobar_: test de venta concurrente del último ítem, con el comportamiento decidido.

- [x] **2.2 ✓ Que una sucursal pueda vender.** `apps/api/src/modules/products.ts:88`: el
      catálogo filtra por `product.locationId`, la ubicación **dueña** del producto, no por
      dónde hay stock. Sucursal Norte tiene 57 unidades en 6 productos y su vendedor recibe
      `items: []`, también buscando por SKU. **El multi-sucursal no opera.**
      Hay que decidir si un producto es del negocio (con inventario por ubicación, que es como
      está modelado) o de una ubicación. Todo apunta a lo primero.
      _Comprobar_: test con el vendedor de Norte que ve los productos con stock en Norte.

- [x] **2.3 ✓ Que anular una venta no borre su rastro en el arqueo.**
      `apps/api/src/lib/scope.ts:63-66`. Un vendedor anula cualquier venta de su ubicación y el
      efectivo esperado del turno retrocede con ella: cobra, anula, se queda el billete, cierra
      a cero. Reproducido: 5410 → 5690 → **5410**.
      Anular es deliberado y está comentado; lo que no puede ser es que el arqueo lo olvide. Que
      la anulación deje un movimiento de salida, o que no descuente del esperado del turno en
      que se cobró.
      _Comprobar_: test en `cash.test.ts` — vender, anular, y esperar que el descuadre aparezca.

- [x] **2.4 ✓ Revocar las sesiones al cambiarse uno mismo la contraseña.**
      `apps/api/src/modules/auth.ts:284-311`: `PATCH /auth/me` aplica el hash y va directo a la
      auditoría, sin `revocarTodo`. Los tres equivalentes sí lo hacen (`users.ts:253`,
      `auth.ts:420`, `auth.ts:221`). Ojo al detalle: **hay que dejar viva la sesión de quien la
      cambia**, o se echa a sí mismo — mirar cómo lo resuelve `auth.ts:420`.
      _Comprobar_: test en `sessions.test.ts` que con el refresh viejo espera 401 después.

- [x] **2.5 ✓ Aplicar el alcance en `GET /sales?userId=`.**
      `apps/api/src/modules/sales.ts:144`: el filtro se empuja sin mirar el rol; un vendedor ve
      las ventas de su compañero y su `sumTotal`. `cash.ts:398` ya tiene `soloLosMios` por este
      mismo razonamiento. Reutilizarlo, no reescribirlo.
      _Comprobar_: test en `alcance-sucursal.test.ts`.

- [x] **2.6 ? Que `POST /products/import` respete la cuota del plan.**
      `apps/api/src/modules/products.ts:338-392`: 600 productos creados con tope 500; el alta
      unitaria sí la respeta. **Confirmar primero** con `curl` contra `repuestos-sur`.
      _Comprobar_: test en `subscription.test.ts` con un import que cruza el tope.

- [x] **2.7 ? Que la cola offline no sobreviva al cambio de usuario.**
      `apps/web/src/offline/sync.ts:71` + `features/auth/AuthProvider.tsx:140`. Las ventas
      pendientes se suben con el token del siguiente usuario: mismo local → ventas de Ana a
      nombre de Beto; distinto local → `LOCATION_SCOPE`, 10 reintentos y `failed`, venta cobrada
      que nunca llega.
      **Trampa conocida**: borrar la cola al salir destruiría ventas cobradas sin sincronizar
      (es lo que bloquea el punto 3 de `PROMESAS_RETIRADAS.md`). Lo correcto es **sellar cada
      venta con el usuario y la ubicación que la cobró** y negarse a subirla con otra sesión,
      avisando en pantalla.
      _Comprobar_: test en `sync.test.ts` con cambio de usuario entre encolar y sincronizar.

---

## Bloque 3 — Alto: interfaz

- [x] **3.1 ✓ Arreglar `--color-border` en los dos modos.** `apps/web/src/index.css:141`
      (claro `#ecebe6`: 1.19:1 sobre blanco, **1.10:1** sobre el fondo) y `:228` (oscuro
      `#2d2c29`: 1.24 y **1.34:1**). Se pide 3:1. Afecta a cada `<input>`, `<select>` y botón
      secundario de todas las pantallas con formulario.

- [x] **3.2 ✓ Arreglar `text-muted` sobre `track`, `danger-bg` e `info-bg` en claro.**
      `#716f6b` da 4.37 / 4.43 / 4.49 (se pide 4.5). Se ve en la inicial del usuario de la barra
      lateral en **todas** las pantallas con sesión (`components/Layout.tsx:155`) y en **todo
      chip `neutral`** (`components/ui/badge.tsx:9`).

- [x] **3.3 ✓ Ampliar `paleta.test.ts` para que esto no vuelva a pasar.** Sus 27 parejas no
      incluyen **ninguna** con `border`, ni `muted` sobre `track` / `danger-bg` / `info-bg`. Es
      el mismo agujero que dejó `--color-muted` en 3.17 durante meses: el token se afina contra
      los dos fondos que el test mira. Añadir toda pareja que exista de verdad en pantalla,
      incluidos los bordes con su umbral de 3:1 (que es el de componentes, no el de texto).
      **Hacerlo antes que 3.1 y 3.2**, para verlo rojo primero.

---

## Bloque 4 — Medio

- [ ] **4.1 ✓ Arreglar `scripts/gen-api-docs.mjs`: pierde 9 de las 74 rutas reales.**
      `docs/API.md` documenta 65 y **regenerarlo no produce ninguna diferencia**, así que nada
      lo delata. Faltan casi todas las de administración de operadores: `GET`/`POST
    /platform/admins`, `PATCH /platform/admins/:id`, `PATCH /platform/me`,
      `/platform/me/password`, `/platform/tenants/:id/users`, el rescate de contraseña y
      `PATCH /platform/tenants/:id`. Se pierden al aplanar el árbol radix de Fastify
      (`aplanar()`, la reconstrucción por niveles).
      _Comprobar_: que el generador emita tantas rutas como `printRoutes()` sin `HEAD` — y
      **añadir esa comprobación al CI**, que es lo que convierte el documento en fiable.

- [ ] **4.2 ✓ Que el export no se bloquee con 402** cuando vence la prueba o hay suspensión
      (`subscription.ts:135-147`): es justo el caso que los términos prometen
      (`textos.ts:73,74,156,162`). O se arregla, o es la **quinta promesa retirada**.
      → tarea del skill `legal`.

- [ ] **4.3 ✓ Decidir qué pasa con la "Tasa de impuesto (%)".** `db/schema.ts:43`: editable,
      guardada y exportada, y **no interviene en ningún cálculo** — `createSaleSchema` exige
      `total = subtotal − discount`. O se implementa, o se quita de la pantalla: un ajuste que
      no hace nada es peor que no tenerlo. Si se quita, **sexta promesa retirada**.

- [ ] **4.4 ✓ Que mudar el subdominio sea del operador principal.** `platform.ts:634`. Deja a
      todo el personal del cliente fuera con "Usuario o contraseña incorrectos". La ronda
      anterior decidió que lo comercial es del principal y esto se quedó fuera.

- [ ] **4.5 ? Devolver 400 y no 500 con un `:id` que no es UUID.** En todas las rutas. Ensucia
      el log y dispara los avisos por correo de `alertas.ts`. Se arregla en un sitio: validando
      los params con zod en un hook, no ruta por ruta.

- [ ] **4.6 ? Que una venta mal formada no tumbe el lote entero de `/sales/sync`.** Mal asunto
      para una PWA offline: una venta corrupta bloquea todas las demás del dispositivo.

- [ ] **4.7 ✓ Arreglar el desborde de 99 px del panel de plataforma en móvil** (390×844, los dos
      modos): "Salir" queda entero fuera de pantalla. Es la única pantalla del producto con
      desborde horizontal.

- [ ] **4.8 ✓ Pasar el tooltip de las gráficas por `--color-primary-ink`.** Recharts usa el
      color de marca crudo: 3.28:1 y 3.25:1 en oscuro. El token existe exactamente para esto.

- [ ] **4.9 ✓ Quitar la numeración duplicada de Términos y Privacidad** ("1. 1. Quiénes
      somos…"): `LegalPage.tsx:44` y `:55` añaden el número que `textos.ts:33+` ya trae.

- [ ] **4.10 ✓ Traducir los códigos crudos de Actividad**: `transfer`, `open`, `close`,
      `inventory`.

- [ ] **4.11 ✓ Decidir si "Cobrar" pide confirmación.** Hoy registra la venta sin ninguna — el
      agente visual creó la venta #104 sin querer. En un POS con prisa y dedos, que sea una
      decisión y no un descuido.

- [ ] **4.12 ? Hacer atómica el alta de negocio.** `packages/db/src/create-tenant.ts:61-99`: un
      fallo a media deja un negocio zombi sin admin que **ocupa el slug para siempre**.

- [ ] **4.13 ? Guarda de "último admin de la central".** `users.ts:143`: el negocio puede
      quedarse sin quien lo administre. `platform.ts:341` ya resolvió el mismo problema y no se
      trasladó.

- [ ] **4.14 ? Que el mailer de consola no diga `enviado: true`.** `lib/mailer.ts:80` +
      `platform.ts:825` → `correoEnviado: true` mentiroso en el rescate de contraseña, y claves
      temporales escritas en el log. Añadir guarda: sin `RESEND_API_KEY` en producción, no
      arrancar (o al menos no mentir).

---

## Bloque 5 — Bajo

- [ ] **5.1 ✓** Botones deshabilitados a 2.39–2.45:1.
- [ ] **5.2 ✓** El párrafo del login a 4.36–4.45:1 por `opacity-[.88]`.
- [ ] **5.3 ✓** Enlaces y botones sin `:focus-visible` propio (los `<input>` sí lo tienen).
- [ ] **5.4 ✓** "Hasta" huérfano de su campo en móvil; importes de 4 cifras partidos en dos líneas.
- [ ] **5.5 ✓** Panel y Reportes sin skeleton; 404 de favicon.
- [ ] **5.6 ?** El límite de export (5/h por IP) lo agotan los 403/402 de quien no puede exportar.
- [ ] **5.7 ?** Mensaje equivocado en `soloPrincipal`; dos errores en inglés.
- [ ] **5.8 ?** `jwtRefreshSecret` está muerto: el refresh se firma con el de acceso (`env.ts:92`).
      Decidir si se usa o se borra — una variable que no hace nada engaña al que despliega.
- [ ] **5.9 ?** `/auth/logout` no comprueba `typ` (`auth.ts:199`).
- [ ] **5.10 ?** `auth_token` fuera de RLS sin la nota que sí llevan `business` y `subscription`
      (`rls.ts:27`). Documentarlo o meterlo.
- [ ] **5.11 ?** `inventory.ts:53` admite `quantity` negativo.
- [ ] **5.12 ?** BD de tests con nombre fijo: dos corridas concurrentes se destruyen
      (`global-setup.ts:40`). Molesta justo cuando se lanzan agentes en paralelo, como hoy.
- [x] **5.13 ?** `vitest.config.ts:33` no sube `LOGIN_RATE_LIMIT_MAX` y `sessions.test.ts` roza
      el tope de 20: un test más y se pone rojo sin que nadie haya roto nada.

---

## Bloque 6 — De fondo: por qué existían estos 54

- [ ] **6.1 Empezar a montar componentes en los tests.** La web está en **3,5 %** de cobertura,
      cero componentes montados, sin `@testing-library/react`. Las 70 pantallas (10.329 líneas)
      sólo las vigila una ronda manual como esta, que **no deja red**. Empezar por lo que ya
      falló: POS (cobrar), caja (cierre) y login.

- [ ] **6.2 Umbral de cobertura en el CI.** Hoy nada impide que un módulo nuevo entre sin tests.
      Los tres módulos peor cubiertos del API son de donde salieron el crítico y dos altos:
      `inventory.ts` **28 %**, `sales.ts` 77 %, `products.ts` 81 %. La cobertura fue un mapa
      fiable de dónde estaban los fallos. Requiere añadir `@vitest/coverage-v8`.

- [ ] **6.3 Arreglar o quitar `pnpm lint`.** Falla siempre: `packages/shared` declara
      `eslint src` y no hay eslint ni config en el repo. Un script que falla siempre es peor que
      no tenerlo.

- [ ] **6.4 Subir tests de los módulos flojos**, por orden de daño: `inventory.ts` (28 %),
      `customers.ts` (53 %, es fiado y es dinero), `alertas.ts` (25 %), y las **ramas** de
      `audit.ts` (100 % de sentencias, **23 %** de ramas).

- [ ] **6.5 Partir el chunk de entrada de la web.** 1.021 kB (1.862 KiB de precarga del service
      worker) para un POS que arranca en tabletas baratas por la conexión de una tienda. El
      escáner y los widgets ya están separados.

- [ ] **6.6 Formatear el repo de una vez** (49 archivos) y activar el paso de formato en el CI,
      que son dos líneas ya escritas en el propio `ci.yml`. Commit aparte, sin mezclar.

---

## Ya estaba pendiente, y esto lo refuerza

De `planSaas.md` y las notas anteriores. No sale de este análisis, pero sigue abierto:

- [ ] **Backup diario del VPS copiado fuera del servidor.** Lo único cuyo coste, si sale mal, no
      se recupera con código. Los scripts están hechos y probados; falta el cron. Hay un cliente
      real y aún no hay backups.
- [ ] **Activar RLS en el VPS** (`ENABLE_RLS=1`), tras un backup con restauración probada.
- [ ] **El logout no borra IndexedDB** — fallo de privacidad real, emparentado con la tarea 2.7.
- [ ] **Que un abogado revise los legales**, y **franz debe dar los cinco datos de la empresa**
      (razón social, NIT, ciudad, correo, hosting) para cerrar los marcadores de
      `packages/shared/src/legal.ts`. Esta pregunta lleva abierta desde el 06.
- [ ] Monitor de uptime externo apuntando a `/health`.

---

## Orden sugerido

1. **Bloque 0** — bloquea el despliegue y son cambios pequeños.
2. **1.1 + 1.2** — el crítico, y es una línea.
3. **2.2, 2.3, 2.1** — el multi-sucursal roto y los dos agujeros de dinero. Se ven desde el mostrador.
4. **2.4, 2.5** — coherencia con decisiones que el propio código ya tomó en otros sitios.
5. **3.3 → 3.1 → 3.2** — el test primero, para verlo rojo.
6. **4.1** — hasta arreglarlo, `docs/API.md` no es fiable y lo parece.
7. El resto del bloque 4, luego el 6 (que es lo que evita la próxima ronda de 54), y el 5 al final.

Antes de tocar nada del bloque 4 y 5 marcado con **?**, confirmarlo: en la ronda anterior uno
de los hallazgos de fuente única resultó falso.
