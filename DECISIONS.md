# Decisiones de arquitectura (DECISIONS.md)

Registro de decisiones tomadas durante la implementacion. No cambiar sin justificar aqui.

## Contexto de despliegue
- **Servidor objetivo:** Hostinger VPS KVM 1 — 1 vCPU, 4 GB RAM, 50 GB NVMe.
- Regla dura: **nunca compilar en el VPS.** Frontend en Cloudflare Pages; imagen del API compilada en CI/local.
- Postgres tuneado para 4 GB (ver `docker-compose.yml`). Pool del API = 8 conexiones.
- Recomendado en el VPS: 2 GB de swap + backups `pg_dump` automaticos fuera del servidor.

## D1 — Numeracion de recibos vs. offline
- `sale.id` es UUID generado en el cliente (identidad real, idempotencia en sync).
- `receipt_number` correlativo **por negocio** lo asigna el SERVIDOR al sincronizar, con una
  fila contador por negocio (`business_counter`) usando `SELECT ... FOR UPDATE`.
- Offline el recibo se imprime con folio provisional (`PROV-<uuid-corto>`); el correlativo
  oficial aparece al sincronizar.
- No se usa `SERIAL` global (seria correlativo compartido entre negocios = incorrecto).

## D2 — Aislamiento multi-tenant
- Una sola BD, columna `business_id` en TODAS las tablas.
- Defensa en profundidad: helper de repositorio que exige `business_id` en toda query.
  (Postgres RLS queda como mejora futura si crece el numero de tenants.)
- El `business_id` SIEMPRE sale del token JWT, nunca del payload del cliente.

## D3 — Indices desde el dia 1
- Indices compuestos que empiezan por `business_id` en todas las tablas.
- Claves para reportes/POS: `sale(business_id, location_id, client_created_at)`,
  `product(business_id, name)`, `product(business_id, sku)`.

## D4 — Timestamps autoritativos
- El reloj del cliente NO es confiable. `client_created_at` solo se muestra.
- El servidor pone `synced_at`/orden autoritativo al recibir la venta.

## D5 — Customizacion generica por rubro (llantas, repuestos, cualquier negocio mediano)
- `product.attributes` (JSONB): campos propios por rubro sin migraciones.
  - Llantas: `{"medida":"205/55R16","marca":"Michelin"}`
  - Repuestos: `{"oem":"90915-YZZE1","compatibilidad":"Toyota Corolla"}`
- `business.product_schema_json`: define que campos de `attributes` mostrar/editar en la UI.
- White-label por `business.theme_json` y `business.texts_json` (ya en el plan).

## D6 — UI minimalista (requisito del cliente)
- Principio de diseno: shadcn/ui con estetica neutra, mucho espacio en blanco, sin adornos.
- POS = una sola pantalla, botones grandes, flujo de venta en el minimo de toques.
- Mobile-first (el vendedor del pueblo usa celular/tablet).

## D8 — Costos y ganancia
- `product.cost` = precio de compra UNITARIO (base para la ganancia).
- `product.cost_wholesale` = precio de compra POR MAYOR (informativo).
- Ganancia por unidad = precio venta - costo unitario.
- `sale_item.unit_cost_snapshot`: se guarda el costo al momento de la venta -> la ganancia
  historica no cambia aunque luego se edite el costo del producto (igual que el snapshot de precio).
- Reportes exponen ganancia hoy/semana/mes por ubicacion y total (solo ventas completadas).

## D9 — Dashboard modular por widgets (crecer "a la derecha")
- `WIDGET_REGISTRY` (array de {id, title, size, component}). Agregar un widget =
  crear el componente + una entrada en el registry. El DashboardPage NO se toca.
- Layout por usuario en `user_dashboard_config.widgets` (lista ordenada de ids activos).
- Un solo endpoint `/reports/dashboard` alimenta todos los widgets (1 llamada, eficiente en KVM1).
- Proyección: regresión lineal sobre ventas diarias (30d) + banda por error estándar. Sin ML.
- Recharts va en un chunk aparte (lazy load del Panel) para no penalizar el POS del vendedor.
- Impresión: recibo aislado por clase `body.print-receipt`; reportes/dashboard imprimen con
  `.no-print` en nav/botones. Export "Excel" = CSV con BOM (Excel lo abre nativo).

## D10 — Permisos por ubicación (multi-sucursal)
- `location.is_central` marca la central; `product.location_id` = ubicación dueña del producto.
- Claim `isCentral` en el JWT (se calcula en login según la ubicación del usuario).
- **Vista:** usuario de la central ve TODAS las ubicaciones; los demás sólo la suya
  (productos, ventas, inventario). Helper `viewScope`.
- **Acción (crear/editar/cancelar):** sólo admin y sólo sobre su PROPIA ubicación
  (central actúa en central; sucursal en la suya). Helper `canActOnLocation`.
- **Ajuste de inventario:** excepción — la central ajusta el de CUALQUIER ubicación;
  la sucursal sólo la suya. Requiere MOTIVO obligatorio, guardado en el historial del producto
  (`stock_adjust`, entityId = productId). Helper `canAdjustInventory`.
- El backend devuelve `canManage`/`canAdjust` por fila para que la UI oculte acciones.
- Vendedores: ven Productos/Inventario de su sucursal en solo-lectura (+ historial) y venden en su POS.
- Historial: `GET /products/:id/history` (auditoría del producto: creación, edición, precio,
  ajustes de stock con motivo, transferencias). Modal al hacer clic.
- Listas grandes: scroll infinito / "Cargar más" (`useInfiniteList` con useInfiniteQuery) en
  Productos, Ventas y Actividad.

## D7 — Dinero y zona horaria
- Dinero: `numeric` (DECIMAL) en BD, nunca float. Formato `Bs.` con 2 decimales.
- Guardar UTC, mostrar `America/La_Paz`.

## D11 — Modelo de cobro del SaaS (4 ago 2026)
- Se cobra **por negocio, con límites incluidos**, no por sucursal ni por usuario.
  Cobrar por usuario castiga justo el uso que se quiere fomentar (dar de alta a cada
  cajero); cobrar por sucursal obliga a recontar en cada ciclo y complica las altas y
  bajas a mitad de mes.
- Catálogo en UN solo sitio: `packages/shared/src/plans.ts`. La tabla `plan` se siembra
  desde ahí (`seed-plans`), así que no hay precios ni cupos escritos a mano en el código.
- `plan` y `subscription` quedan **fuera de RLS**, junto a `business`: son datos de
  plataforma y el panel super-admin tiene que poder verlos todos. RLS falla cerrado, así
  que con una política de tenant no vería ninguno.
- La **prueba vencida no se persiste**: se deduce de `trial_ends_at` al consultarla.
  Guardarla exigiría un cron, y un cron que no corre un día regala el servicio.
- **Dos reglas que protegen al cliente que ya paga**, deliberadas:
  1. La morosidad (`past_due`) NO corta el servicio; sólo avisa. Un POS que deja de
     vender por un pago atrasado le cuesta al negocio su día de caja.
  2. Un negocio SIN fila de suscripción opera sin restricciones. Un fallo en la capa de
     cobro no puede dejar una tienda sin vender. `seed-plans` hace que no ocurra.
- El bloqueo responde **402**, no 401: el cliente web refresca el token ante un 401 y
  cierra sesión si falla, y echar al usuario al login no es forma de decirle que renueve.
- La **lectura Z nunca depende del plan**: es el cierre de caja, parte del POS.

## D12 — Panel de plataforma: dos identidades, dos llaves (4 ago 2026)
- El super-admin es una **tabla aparte** (`platform_admin`), no un valor más del enum
  `role`. Si fuera un rol, cualquier fallo que dejara escribir el rol de un usuario —un
  PATCH mal validado, un seed descuidado— ascendería a un cliente a operador de la
  plataforma.
- Los tokens del panel se firman con **`JWT_PLATFORM_SECRET`, distinto** del de los
  negocios (segunda instancia de @fastify/jwt con namespace). Así el aislamiento no
  depende de comprobar un claim, sino de no tener la llave. El API **se niega a arrancar
  en producción** si falta o si coincide con `JWT_ACCESS_SECRET`.
- El panel **no tiene puerta trasera a los datos de los clientes**: para contar lo de un
  tenant entra a su contexto con `withTenant` y con `where business_id` explícito. No
  existe una consulta que lea las tablas de todos los negocios a la vez, y es a propósito.
- **Bitácora separada** (`platform_audit_log`): lo que la plataforma hace SOBRE un
  negocio es un acto tuyo, no suyo, y debe quedar registrado aunque él ya no pueda entrar.
  El `audit_log` del negocio sigue siendo sólo suyo.
- El panel vive en el **subdominio `admin.`** con token guardado bajo otra clave de
  localStorage: dar soporte con la sesión de un cliente abierta no pisa ninguna de las dos.
- **Sin churn en porcentaje.** Calcularlo exige histórico de estados, que no se guarda.
  Se muestran las bajas del mes, que es un número cierto, en lugar de una tasa inventada.

## D13 — Registro self-service y recuperación de contraseña (4 ago 2026)
- **Una sola función de alta** (`crearNegocio`, en `packages/db/src/create-tenant.ts`)
  para el CLI y para la pantalla de registro. Dos implementaciones acabarían divergiendo
  y creando negocios a medias: sin contador de recibos, por ejemplo, la primera venta
  falla. Hay un test que comprueba pieza por pieza que el negocio queda listo para vender.
- **Verificar el correo NO bloquea el uso.** El negocio vende desde el primer minuto y
  ve un aviso hasta confirmar. Exigirlo antes de entrar pierde altas por cada correo que
  tarda o cae en spam; el incentivo honesto es que sin correo confirmado no se puede
  recuperar la contraseña, y eso es literalmente lo que dice el aviso.
- **Del token sólo se guarda el sha256.** Lo que viaja al correo son 256 bits aleatorios;
  la tabla `auth_token` guarda su hash. Quien leyera esa tabla no entraría en ninguna
  cuenta. sha256 pelado y no argon2 a propósito: no hay contraseña que adivinar, así que
  un hash lento no compraría seguridad y sí retrasaría cada petición.
- `auth_token` va **fuera de RLS**: el enlace se abre sin sesión y hay que encontrar el
  token antes de saber de qué negocio es. El control de acceso ahí es el token mismo.
- **Un enlace, un uso.** Pedir uno nuevo invalida el anterior; si no, un correo viejo
  interceptado seguiría abriendo la cuenta días después.
- **"Olvidé mi contraseña" responde siempre igual**, exista el correo o no. Distinguirlo
  convertiría el endpoint en una forma de averiguar quién tiene cuenta en cada negocio.
- **Correo transaccional con dos drivers**: Resend por HTTP (sin dependencias) y, si no
  hay `RESEND_API_KEY`, escritura en el log. Así el flujo entero se prueba en local y en
  staging sin cuenta ni dominio verificado, y sin enviarle nada por error a nadie.
  Un fallo al enviar NO rompe el alta: la persona no puede arreglarlo reintentando.
- **Topes de 5/hora por IP** en registro y recuperación. Lo que se frena no es la fuerza
  bruta, es usar el endpoint como máquina gratis de correo.

## D14 — Arqueo de caja (4 ago 2026)
- **El esperado se congela al cerrar** (`expected_amount` guardado, no recalculado). Una
  venta offline que sincroniza mañana, o una anulación posterior, cambiarían el número y
  el arqueo de ayer dejaría de cuadrar solo. Un cierre es una foto de lo que se contó.
- **Las ventas se cuentan por `client_created_at`**, no por `synced_at`: el billete entró
  al cajón cuando se vendió, aunque el servidor se entere tres horas después.
- **Se añadió `cash_movement`, que no estaba en el plan.** Sin registrar retiros e
  ingresos, cada vez que alguien saca plata para pagar a un proveedor el cierre marca un
  faltante. Un arqueo que siempre descuadra enseña a ignorar los descuadres, que es justo
  lo contrario de para lo que existe. El motivo es obligatorio: un movimiento sin motivo
  es indistinguible de un faltante.
- **Qué es efectivo y qué no**: suman apertura, ventas en efectivo, abonos de fiado en
  efectivo e ingresos; resta retiros. Tarjeta y QR no (ese dinero no está en el cajón),
  fiado tampoco (no entró nada), anuladas tampoco (se devolvió).
- Los abonos de fiado se atribuyen a la ubicación **del usuario que los cobró**:
  `customer_payment` no tiene ubicación, y quien cobró tenía el cajón delante. Es la
  única atribución posible sin añadir una columna.
- **Un cajón, un turno**: índice parcial único sobre `location_id where closed_at is null`.
  Con dos cajas abiertas sobre el mismo cajón físico, ningún arqueo significa nada.
- **La caja es operativa, no de análisis**: la abre y la cierra quien está en el mostrador,
  así que `/caja` no es sólo para admin. La lectura Z por día sí sigue siéndolo.
- La pantalla enseña el **desglose entero**, no sólo el esperado, y la diferencia aparece
  **mientras se teclea lo contado**: es el momento en que todavía se puede volver a contar.

## D15 — Revocación de sesiones (4 ago 2026)
- El agujero real no era el tenant suspendido (a ése ya lo corta la puerta de suscripción
  en cada petición), sino el **empleado dado de baja**: seguía trabajando hasta que
  caducara su access token y **renovando sesión durante los 30 días** del refresh.
- **Dos frenos, uno por tipo de token**: el refresh apunta a una fila de
  `refresh_session` (revocable en el acto); el access lleva dentro
  `app_user.token_version` y deja de valer en cuanto ese contador sube.
- **Contador, no fecha de corte.** Con una fecha habría que compararla contra el `iat`
  del token, que va en segundos enteros: un token emitido en el mismo segundo que la
  revocación sobreviviría, y apretar la comparación dejaría fuera a quien vuelve a
  entrar en ese mismo segundo. Un entero no tiene ese hueco.
- **No se rota el refresh en cada uso.** La rotación con detección de reúso es más
  estricta, pero en un POS con conexión mala un reintento tras un corte llega con el
  token anterior y dejaría a la caja fuera en mitad de una venta.
- Cambiar tu **propia** contraseña desde el perfil no cierra tus otras sesiones (ya estás
  autenticado y tienes el botón al lado). El restablecimiento **por correo** sí las
  cierra: ahí puede que no seas tú quien está en control.
- Los tokens sin `tv` (los anteriores a este cambio) se tratan como versión 0, que es la
  que tiene todo usuario sin revocaciones: desplegarlo no echa a nadie de golpe.

## D16 — Legales y exportación de datos (4 ago 2026)
- **Se guarda la VERSIÓN de los términos aceptados**, no sólo la fecha. Los términos
  cambian; sin la versión, dentro de un año no habría forma de saber qué aceptó cada
  negocio, que es justo lo que hace falta poder demostrar.
- La aceptación se exige **en el esquema de la petición**, no sólo en el formulario: un
  alta por API sin aceptar dejaría un negocio sin constancia.
- Los textos legales son un **borrador redactado a partir de lo que el sistema hace de
  verdad** (planes, prueba, morosidad que no corta, dónde viven los datos, qué se guarda
  en el navegador) y NO están revisados por un abogado. Los datos de la empresa quedan
  como marcadores `[ENTRE CORCHETES]`: inventar una razón social o un NIT sería peor que
  dejarlos vacíos, y así el hueco es visible.
- La **exportación es JSON y no CSV**: el CSV para Excel ya existe en los reportes; esto
  es la copia completa con las relaciones intactas, que sirve para migrar de sistema.
  Nunca incluye hashes de contraseña. Se arma en UNA transacción para que sea coherente.

## D17 — Lo que destapó la revisión con dos agentes (4 ago 2026)
- **Un fallo silencioso es peor que uno ruidoso.** `viewScope()` devolvía el centinela
  `'__none__'` para un usuario sin ubicación; comparado contra una columna `uuid`
  reventaba con 22P02, y como el frontend pinta lista vacía cuando la petición falla, el
  vendedor veía "un negocio recién creado" en vez de un error. Arreglado en tres capas:
  UUID nulo (válido, no coincide con nada), el API exige ubicación para un vendedor, y
  el formulario deja de llamarla opcional.
- **El amplificador era general**: 16 de 17 pantallas ignoraban el error de su consulta.
  Se enganchó `queryCache.onError` —único punto por el que pasan todas— en vez de tocar
  las 17. El 401 y el 402 quedan fuera del aviso a propósito: uno lo maneja el refresco
  de sesión y el otro releé la suscripción, con lo que la app pasa sola a la pantalla de
  bloqueo. Eso arregló que **suspender a un negocio no hiciera nada en la pestaña ya
  abierta**: el servidor cortaba pero el cajero seguía cobrando contra la cola offline.
- **Un 500 no cuenta lo que salió mal.** El error crudo de Postgres llegaba al navegador
  con nombre de columna y tipo. Ahora un manejador único los tapa y los registra enteros
  en el log; por debajo de 500 el mensaje se conserva, que sí le sirve a quien llama.
- **El servidor no se cree cualquier cosa.** Los precios siguen llegando del cliente
  (son un snapshot y el POS vende sin conexión), pero se exige que la aritmética cuadre
  consigo misma, que no haya negativos, que el descuento no supere al subtotal, que la
  fecha no esté en el futuro —desaparecería de todo arqueo— y que la ubicación y los
  productos sean del negocio.
- **Descuento del vendedor con tope configurable** (`business.max_seller_discount_pct`,
  10% por defecto). Cualquier cajero podía descontar el total y cobrar Bs. 0. El número
  lo pone el dueño porque depende del rubro; el administrador no tiene tope.
- **La bitácora pasa a TODOS los planes.** Estaba sólo en Pro, y el plan Básico es justo
  el del negocio con empleados: cobrar por el único control contra el fraude interno era
  vender la cerradura aparte de la puerta. Pro se diferencia por el panel de análisis.
- **Un hipo del servidor no cierra la sesión.** `/auth/me` borraba los tokens ante
  cualquier fallo; ahora sólo ante un 401.
- **No prometer con dos días de datos**: la proyección marca `confiable: false` con menos
  de 7 días, en vez de dar una cifra exacta y sin margen extrapolada de una tarde.

## D18 — Operación: CI, salud y capacidad (4 ago 2026)
- **El staging no medía lo que decía medir.** Limitaba memoria pero no CPU, así que usaba
  los 16 núcleos de la máquina de desarrollo y daba cifras de capacidad 3-4× infladas.
  Con `cpuset: "0"` en ambos contenedores —el VPS es 1 vCPU para el stack entero— el
  techo real resultó ser ~240 req/s, no ~650.
- **La señal para migrar de servidor es el p95, no el número de clientes.** Medido: p95
  cruza los 300 ms alrededor de 40 peticiones en vuelo; cero errores en todos los casos
  (el pool de 8 encola bien). Y ~1,5 KB por venta, que es el dato para planificar disco.
- **`/health` comprueba la base de datos**, no sólo que el proceso responda, y devuelve
  503 cuando falla. Un "ok" con la base caída es el falso positivo que vuelve inútil un
  monitor de uptime.
- **Avisos por correo en vez de Sentry.** Sentry v8 arrastra OpenTelemetry, que en un VPS
  de 1 vCPU no es gratis; y el mailer de Resend ya estaba puesto. Los avisos van
  AGRUPADOS —uno por ventana de 10 min con la cuenta y las rutas— porque cien correos
  idénticos se filtran, y un aviso filtrado no avisa de nada.
- **La documentación de la API se genera**, no se escribe: una lista de endpoints a mano
  se queda obsoleta en una semana y entonces manda a quien la lee a rutas que ya no
  existen. No cubre los cuerpos: eso vive en Zod, en una sola fuente compartida.
- **El CI no comprueba formato, a propósito.** 88 archivos no pasan `prettier --check`;
  un CI que falla desde el primer día enseña a ignorarlo. Formatear el repo es una
  limpieza aparte que no debe mezclarse con cambios de verdad.
- **El CI sí comprueba que no falte una migración.** El esquema se cambia a mano con
  `db:generate`, y olvidarlo se descubriría al desplegar, con la base ya en producción.
