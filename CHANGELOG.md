# CHANGELOG

## Fase 0 — Fundaciones (COMPLETA ✓)

### Hecho y verificado
- Monorepo pnpm + Turborepo, TypeScript estricto, Prettier.
- `docker-compose.yml` con PostgreSQL 16 tuneado para VPS KVM1 (1 vCPU / 4 GB).
  Postgres en puerto host **5434** (5432/5433 estaban ocupados en la maquina de dev).
- `packages/shared`: esquemas Zod de todas las entidades + constantes.
- `packages/db`: esquema Drizzle completo (11 tablas), migracion inicial generada y aplicada,
  seed demo (negocio de llantas, 2 ubicaciones, admin+vendedor, 20 productos, 40 inventarios).
  - Correcciones de la revision incorporadas: `business_id` + indices en todo,
    `product.attributes` JSONB (customizacion por rubro), `business_counter` para
    correlativo de recibos por negocio, timestamps autoritativos del servidor.
- `apps/api` (Fastify 5): plugins auth (JWT access+refresh, requireAuth/requireAdmin) y audit.
  Endpoints: `GET /health`, `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`,
  `GET /api/v1/auth/me`, `GET /api/v1/business/me`.
  - Verificado: login OK, clave mala -> 401, tema servido desde BD, login auditado.

- `apps/web` (Vite + React 18 + Tailwind + router + TanStack Query):
  ThemeProvider que lee `theme_json` desde la BD y lo aplica a variables CSS,
  componentes UI minimalistas (Button/Input/Card), pantalla de login, home protegida,
  cliente API con refresh automático de token.
  - Verificado en navegador real (Playwright): sin sesión -> /login; login admin OK;
    negocio y tema cargados desde BD; sesión persiste al recargar; sin errores de consola.
  - White-label probado: cambiar `theme_json` en la BD tiñe toda la UI SIN tocar codigo.

### Criterio de aceptación de Fase 0: CUMPLIDO
"login funciona, tema se aplica desde BD, seed carga" — verificado end-to-end.

### Credenciales demo
- admin / admin123 · vendedor / vende123

## Fase 1 — MVP online (COMPLETA ✓)

### Backend (Fastify)
- Productos: CRUD + búsqueda (nombre/SKU/barcode) + paginación + import CSV.
- Categorías, ubicaciones y usuarios (admin) con CRUD.
- Ventas: creación con UUID de cliente + correlativo de recibo por negocio (atómico),
  idempotencia por UUID, historial con filtros, detalle para recibo, cancelación (admin, con motivo).
- Reportes: comparativo hoy/semana/mes por ubicación (zona horaria La Paz).
- Toda mutación auditada; cambio de precio registra before/after.

### Frontend (React, minimalista, responsivo)
- Layout con navegación por rol (sidebar en desktop, barra inferior en móvil).
- POS mobile-first: búsqueda, catálogo táctil, carrito, método de pago, botón COBRAR grande.
- Recibo térmico 80mm imprimible (`@media print`) con logo/textos del negocio.
- Historial de ventas con filtros + cancelación. Productos con campos dinámicos por rubro + import CSV.
- Reportes con tarjetas y tabla comparativa.

### Verificado (Playwright, navegador real)
- Flujo completo venta→recibo→reporte→historial→cancelación: OK, sin errores de consola.
- POS en móvil (390px) como vendedor: OK. Import CSV: OK.
- Responsivo sin scroll horizontal en móvil/tablet/desktop.
- RBAC: vendedor no puede cancelar ni crear productos (403).

### Criterio de aceptación de Fase 1: CUMPLIDO
"flujo completo venta→recibo→reporte funciona; test e2e del flujo de venta pasa."

## Costos y ganancia (agregado antes de Fase 2)
- `product.cost` (compra unitario) + `product.cost_wholesale` (compra por mayor).
- `sale_item.unit_cost_snapshot`: ganancia histórica correcta aunque cambie el costo.
- Productos muestran ganancia por unidad; reportes muestran ganancia hoy/semana/mes por ubicación.
- Verificado: producto 250/costo 175/ganancia 75; tarjetas y tabla de ganancia OK.

## Fase 2 — Offline y PWA (COMPLETA ✓)

### Backend
- `POST /sales/sync`: lote de ventas offline, responde POR ÍTEM (ok/duplicated/error),
  idempotente por UUID (reusa la lógica de recibo correlativo).
- Endurecidas las rutas de listado (query inválida -> 400 en vez de 500).

### Frontend
- PWA con vite-plugin-pwa: instalable, service worker precachea la app (carga offline).
- Dexie (IndexedDB): catálogo local (búsqueda offline) + cola de ventas pendientes.
- POS offline-first: la venta se encola SIEMPRE primero; recibo con folio provisional
  impreso al instante; si hay conexión sube al toque y muestra el correlativo real.
- Worker de sync: al volver online (evento) + ping cada 30s; idempotente; reintentos.
- Indicador visible: "Sincronizado" / "N pendientes" / "Sin conexión".

### Verificado (Playwright)
- Aceptación: online→offline→3 ventas con folio provisional→reconectar→
  las 3 en el servidor con recibos 1,2,3, IDs únicos, SIN duplicados, sin errores.
- PWA: service worker activo; recarga offline carga la app desde precache.

### Criterio de aceptación de Fase 2: CUMPLIDO

## Fase 3 — Auditoría completa (COMPLETA ✓)

### Backend
- `GET /audit` (solo admin): registro con filtros (acción, entidad, usuario, ubicación, fecha)
  + paginación, join con nombre de usuario y ubicación, incluye before/after JSON.
- Ya auditado en fases previas: login, crear/editar producto, cambio de precio (before/after),
  crear/editar usuario, crear/eliminar categoría, crear/editar ubicación, venta, cancelación, import.

### Frontend
- Pantalla "Registro de actividad" (admin) con filtros y tabla.
- Detalle con **diff before/after**: une claves, resalta las que cambiaron (antes → después).
- Nuevo ítem de navegación "Actividad".

### Verificado (Playwright)
- Aceptación: cambiar el precio de un producto (250 → 299.99) y verlo en el log
  como "Cambio de precio" con valor anterior y nuevo en el diff. Sin errores de consola.
- Responsividad se mantiene con 7 ítems de nav (móvil/tablet/desktop sin scroll horizontal).

### Criterio de aceptación de Fase 3: CUMPLIDO

### Nota
- "Cambio de tema" y "eliminar producto" (listados en el plan) se auditarán al implementarse
  en Fase 4 (white-label) — aún no existen esos endpoints.

## Fase 4 — White-label / customización (COMPLETA ✓)

### Backend
- `PATCH /business` (admin): nombre, logo, colores (theme), textos, moneda, impuesto.
  Auditado (cubre el "cambio de tema" pendiente de Fase 3). Logo como data URI (máx 400KB).
- `taxRate` acepta hasta 4 decimales (numeric(6,4)).
- CLI `pnpm new-tenant "<Negocio>" <user> <pass>`: crea negocio + ubicación "Principal" + admin.

### Frontend
- Pantalla "Configuración": nombre, subir logo (con downscale a 256px), color primario/secundario
  con vista previa, pie de recibo, moneda, impuesto. Al guardar re-aplica el tema en toda la app.
- El recibo usa el logo y los textos del negocio.
- Nuevo ítem de navegación "Config".

### Bug corregido (real)
- El POS cargaba las ubicaciones una sola vez al montar; en el primer uso, mientras sincronizaba
  el catálogo, quedaban vacías y COBRAR se deshabilitaba. Ahora se refrescan al terminar el sync.

### Verificado (Playwright)
- Configuración: cambiar color (→ #16a34a) y verlo aplicado; recibo con logo y pie nuevos.
- Aislamiento total: segundo negocio "Ferretería Demo" (CLI) ve su propio negocio, 0 productos,
  tema por defecto (no el de Llantas). Sin errores de consola.

### Criterio de aceptación de Fase 4: CUMPLIDO
Segundo negocio con otros colores/logo y aislamiento total de datos.

### Estado del demo
- 2 negocios: "Llantas El Rapido" (20 productos) y "Ferreteria Demo" (vacío, admin ferreadmin/ferre123).

## Fase 5 — Reportes avanzados y dashboard con widgets (COMPLETA ✓)

### Backend
- `GET /reports/dashboard`: KPIs (hoy, ticket promedio), tendencia 30 días, ventas por
  ubicación y por vendedor, top 10 productos, stock bajo, y proyección — todo en 1 llamada.
- Proyección: regresión lineal sobre ventas diarias + banda por error estándar (`lib/projection.ts`).
- `GET /reports/cash-z`: cierre de caja (lectura Z) por método de pago × vendedor × ubicación.
- `GET/PUT /dashboard-config`: layout de widgets por usuario (tabla `user_dashboard_config`).

### Frontend
- Dashboard modular con `WIDGET_REGISTRY` (crecer "a la derecha"): 9 widgets, gráficos Recharts
  (tendencia línea, ubicación barras). Panel "Personalizar": activar/desactivar y reordenar,
  layout persistido por usuario.
- Página "Caja" (lectura Z) con export. Export Excel (CSV) y PDF (print) en el Panel.
- Recharts en chunk aparte (lazy load): bundle principal 135KB gzip (POS liviano),
  dashboard 108KB gzip sólo al abrir el Panel.

### Verificado (Playwright)
- Dashboard: 9 widgets, 2 gráficos Recharts, proyección, export CSV descarga, Caja Z con datos.
- Personalizar: desactivar un widget + guardar + recargar -> persiste.
- **Criterio de aceptación**: agregar un widget nuevo ("Ventas del mes") aparece sólo creando
  el componente y registrándolo, SIN tocar DashboardPage (9 widgets confirmados).
- Responsivo (nav scrollable en móvil) sin scroll horizontal de página. Sin errores de consola.

### Criterio de aceptación de Fase 5: CUMPLIDO

### Datos demo
- ~125 ventas de los últimos 30 días generadas para poblar la analítica.

## Fase 6 — Extras (COMPLETA ✓, 4 features elegidas)

### 1) Control de stock automático + alertas + transferencias
- Vender descuenta stock (dentro de la transacción idempotente -> también offline al sincronizar).
- Cancelar una venta devuelve el stock.
- `POST /inventory/transfer` entre ubicaciones; `GET/PATCH /inventory` para ver/ajustar.
- Página "Inventario" (admin): editar cantidad/mínimo, transferir, resalta stock bajo.
- Verificado: vender -2, idempotencia no duplica, cancelar restaura, transferir origen-3/destino+3.

### 2) Escáner de código de barras
- Botón de cámara en el POS (html5-qrcode, chunk lazy) -> escanea y agrega al carrito.
- Búsqueda por barcode en el catálogo local (funciona offline). Verificado el lookup.

### 3) Descuentos y promociones
- Descuento (Bs.) al total en el POS, reflejado en recibo y reportes. Restringido offline.
- Ganancia recalculada como ingreso NETO - COGS -> el descuento reduce la ganancia correctamente.
- Verificado: descuento 50 sobre 250 -> total 200 en recibo.

### 4) Clientes frecuentes / fiado
- Método de pago "Fiado" (enum 'credit'); tablas `customer` y `customer_payment`; `sale.customer_id`.
- Ventas al fiado -> cuenta por cobrar; abonos; saldo por cliente; deudores primero.
- POS: fiado exige cliente + conexión. Página "Clientes" con saldo, detalle y abonos.
- Verificado: venta fiado 200 -> saldo 200; abono 80 -> saldo 120.

### No incluido (requiere decisión/credenciales externas)
- Facturación SIAT (proyecto aparte), notificaciones WhatsApp/Telegram (API externa),
  multi-caja con apertura/cierre (la lectura Z ya existe en Fase 5).

### Verificado (Playwright): las 4 features OK, responsivo (nav scrollable en móvil), sin errores.

## Permisos por ubicación + historial + paginación (refinamiento post-Fase 6)

### Modelo multi-sucursal
- `location.is_central` + `product.location_id` (migración; admin→central, productos repartidos).
- Claim `isCentral` en el JWT. Helpers de alcance: `viewScope`, `canActOnLocation`, `canAdjustInventory`.
- Vendedor/sucursal: ve SÓLO su ubicación (productos, ventas, inventario), en solo-lectura; vende en su POS.
- Central: ve todas las ubicaciones; gestiona sólo las suyas; ve las sucursales en solo-lectura.
- Ajuste de inventario: la central ajusta cualquier ubicación; requiere MOTIVO obligatorio.

### Historial e interacción
- `GET /products/:id/history`: historial de acciones del producto (incluye ajustes de stock con motivo,
  cambios de precio, transferencias). Modal al hacer clic en Productos o Inventario.
- Ajuste de stock por MODAL con motivo obligatorio.

### Paginación
- Scroll infinito / "Cargar más" en Productos, Ventas y Actividad (`useInfiniteList`).

### Verificado (Playwright)
- Admin ve 20 productos y edita central pero NO sucursal (403 backend / sin botón en UI); ve todas las ventas.
- Vendedor ve sólo su sucursal (8 productos, sus ventas), sin botones de acción, con historial.
- Ajuste sin motivo bloqueado; con motivo aparece en el historial. Paginación "Cargar más" OK.

---
## Estado global
Fases 0–6 completas y verificadas end-to-end, con permisos multi-sucursal, historial por producto
y paginación. POS offline-first, white-label, auditoría, inventario, ganancias, dashboard, fiado,
escáner. Listo para VPS KVM1. Bundle principal ~140KB gzip; dashboard y escáner en chunks aparte.
