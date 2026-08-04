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
