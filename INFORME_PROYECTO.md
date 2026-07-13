# 📋 Informe del proyecto VentaFácil (POS)

Sistema de **punto de venta multi-tenant, multi-sucursal, offline-first y white-label**.

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18 + Vite + TanStack Query + TailwindCSS (PWA) |
| Offline | Dexie.js (IndexedDB) + cola de sync propia |
| Backend | Node.js + Fastify + TypeScript |
| ORM / BD | Drizzle ORM + PostgreSQL 16 |
| Auth | JWT (access + refresh) con argon2 |
| Validación | Zod compartido front/back (`packages/shared`) |

Todas las respuestas de la API usan el formato `{ data, error }` bajo el prefijo `/api/v1`.

---

## 1. Roles del sistema

Solo existen **dos roles** (`packages/shared/src/constants.ts`):

| Rol | Quién es | Qué puede hacer |
|-----|----------|-----------------|
| **`admin`** | El dueño | Todo: crear/editar/cancelar (productos, categorías, ubicaciones, usuarios, inventario), cancelar ventas, editar el negocio, ver reportes/panel/caja/auditoría. |
| **`seller`** (vendedor) | Trabajador de mostrador | Solo operar: registrar ventas, ver productos/inventario, gestionar clientes/abonos, configurar su propio dashboard. |

**Dimensión ortogonal de ubicación** (viaja en el JWT como `isCentral`):

- **Central** (`location.isCentral = true`): ve y actúa sobre **todas** las sucursales.
- **Sucursal** (no central): solo ve y opera sobre **su propia** ubicación.

→ 4 combinaciones efectivas: admin-central, admin-sucursal, seller-central, seller-sucursal.

**Dos capas de permisos:**
- **Rol** → guards `requireAuth` / `requireAdmin` (backend) + rutas `adminOnly` y menús (frontend).
- **Ubicación** → funciones "scope" (`lib/scope.ts`): `viewScope` (qué ve), `canActOnLocation` (dónde escribe), `canAdjustInventory`. El backend devuelve flags por fila (`canManage`, `canAdjust`) para que la UI muestre solo los botones permitidos.

---

## 2. Autenticación

**Flujo:**
1. `POST /auth/login` (usuario + contraseña) → verifica con **argon2** → emite **access token (15 min)** + **refresh token (30 días)**. Rol y ubicación salen del token, nunca del formulario. Audita `login`.
2. Front guarda tokens en `localStorage` (`vf_access`/`vf_refresh`) y rehidrata con `GET /auth/me`.
3. **Refresh automático**: ante `401`, la capa HTTP llama `POST /auth/refresh` una vez y reintenta.
4. **Logout**: limpia tokens.

**Funcionalidades:** login, refresh automático transparente, sesión persistente, `GET /auth/me`.

**Campos del usuario** (tabla `app_user`):

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | uuid | PK |
| `businessId` | uuid | tenant |
| `locationId` | uuid? | ubicación asignada (null = sin ubicación) |
| `name` | text | nombre visible |
| `username` | text | único por negocio |
| `passwordHash` | text | argon2 (nunca se expone) |
| `role` | enum | `admin` \| `seller` (default `seller`) |
| `isActive` | bool | default true |
| `createdAt` | timestamp | |

**Claims del JWT:** `sub` (userId), `businessId`, `locationId`, `isCentral`, `role`, `name`, `typ` (`access`/`refresh`).

> ⚠️ **Seguridad a corregir:** access y refresh se firman con el **mismo secreto** (`jwtRefreshSecret` está definido pero no se usa) y los secretos por defecto son placeholders inseguros.

---

## 3. Secciones y flujos por rol

Menú/protección en `Layout.tsx` / `App.tsx`. Desktop: nav lateral; móvil: nav inferior.

| Sección | Ruta | Vendedor | Admin |
|---------|------|:---:|:---:|
| Vender (POS) | `/` | ✅ | ✅ |
| Ventas (historial) | `/ventas` | ✅ | ✅ |
| Productos | `/productos` | ✅ solo ver | ✅ CRUD |
| Inventario | `/inventario` | ✅ solo ver | ✅ ajustar/transferir |
| Panel (dashboard) | `/panel` | ❌ | ✅ |
| Reportes | `/reportes` | ❌ | ✅ |
| Caja (corte Z) | `/caja` | ❌ | ✅ |
| Ubicaciones | `/ubicaciones` | ❌ | ✅ |
| Usuarios | `/usuarios` | ❌ | ✅ |
| Actividad (auditoría) | `/actividad` | ❌ | ✅ |
| Configuración | `/configuracion` | ❌ | ✅ |

---

### 3.1 POS — "Vender" (`/`) · vendedor y admin

Pantalla principal, **offline-first**. Catálogo (leído siempre desde IndexedDB) a la izquierda, carrito a la derecha.

**Flujo de venta:**
1. Busca por nombre/SKU **o** escanea código de barras (cámara).
2. Toca productos → carrito; ajusta cantidades con +/−. Stock pintado verde/ámbar/rojo (agotado = bloqueado).
3. Elige método de pago (efectivo, tarjeta, QR, transferencia — **el fiado no está disponible en POS offline**).
4. *(Solo online)* asigna/crea comprador y aplica descuento en Bs.
5. **COBRAR**: genera **UUID en el cliente**, **encola en IndexedDB primero** (nunca se pierde) y muestra **recibo provisional** (`PROV-xxxx`) al instante. Con conexión sincroniza y trae el correlativo real.
6. Imprime recibo térmico 80 mm o inicia nueva venta.

**Funcionalidades:** búsqueda local, escáner de código de barras, carrito, control de stock en vivo, selector de sucursal (solo admin), alta rápida de cliente, descuento, cobro offline, recibo provisional, impresión.

**Endpoints:** `POST /sales`, `POST /sales/sync`, `GET /sales/:id`, `GET /customers`, `POST /customers`.

---

### 3.2 Ventas — historial (`/ventas`) · ver todos / cancelar admin

**Funcionalidades:** listado paginado con filtros (ubicación —solo central—, estado, rango de fechas), **suma total** del filtro, ver/imprimir recibo (todos), **cancelar** (solo admin, ventas `completed`).

**Cancelación:** exige **motivo obligatorio (≥3)**, marca `cancelled` (**nunca borra**), **devuelve el stock**, queda auditada. El recibo muestra "*** ANULADO ***".

**Campos de la venta** (tabla `sale`):

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | uuid | **generado en el cliente** (idempotencia offline) |
| `businessId` / `locationId` | uuid | tenant / sucursal |
| `customerId` | uuid? | comprador (opcional) |
| `userId` | uuid | vendedor (del token) |
| `status` | enum | `completed` \| `cancelled` |
| `subtotal` / `discount` / `total` | numeric | montos |
| `paymentMethod` | enum | `cash` `card` `qr` `transfer` `credit` |
| `receiptNumber` | int? | correlativo asignado por el **servidor** al sincronizar |
| `clientCreatedAt` | timestamp | fecha real de la venta (cliente) |
| `syncedAt` | timestamp | fecha de sincronización |
| `cancelledReason` / `cancelledBy` | text / uuid | anulación |

**Campos de cada línea** (tabla `sale_item`): `productId?`, `productNameSnapshot`, `unitPriceSnapshot`, `unitCostSnapshot` (costo congelado → ganancia histórica correcta), `quantity`, `lineTotal`.

**Endpoints:** `GET /sales`, `GET /sales/:id`, `POST /sales/:id/cancel`.

---

### 3.3 Productos (`/productos`) · ver todos / CRUD admin

**Funcionalidades:** listado con scroll infinito; crear/editar/importar (solo admin); filtro por ubicación (solo central); admin ve **costo y ganancia**; historial por producto; campos dinámicos por rubro; importación CSV (hasta 1000 filas); ganancia y margen % en vivo.

**Campos del producto** (tabla `product`):

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | uuid | PK |
| `businessId` | uuid | tenant |
| `locationId` | uuid? | ubicación dueña del producto |
| `sku` | text | único por negocio |
| `barcode` | text? | código de barras (escáner) |
| `name` | text | |
| `description` | text? | |
| `categoryId` | uuid? | categoría |
| `price` | numeric | precio de venta |
| `cost` | numeric? | compra **unitario** (para ganancia) |
| `costWholesale` | numeric? | compra **por mayor** (informativo) |
| `imageUrl` | text? | |
| `attributes` | jsonb | **campos custom por rubro** (llantas: medida; repuestos: OEM) definidos en `business.productSchemaJson` |
| `isActive` | bool | |
| `createdAt` / `updatedAt` | timestamp | |

**Endpoints:** `GET /products`, `GET /products/:id/history`, `POST /products`, `PATCH /products/:id`, `POST /products/import`.

---

### 3.4 Inventario (`/inventario`) · ver todos / ajustar según permiso

**Funcionalidades:** stock por ubicación (filas bajo el mínimo en rojo); **ajustar** stock/mínimo con **motivo obligatorio**; **transferir** stock entre ubicaciones (transacción, valida stock suficiente); historial por producto en texto legible ("Stock 5 → 8 · Motivo: conteo físico"). Botones solo donde hay permiso (`canAdjust`).

**Campos** (tabla `inventory`):

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | uuid | PK |
| `businessId` | uuid | tenant |
| `productId` | uuid | producto |
| `locationId` | uuid | ubicación |
| `quantity` | int | stock actual (default 0) |
| `minStock` | int? | umbral de alerta |
| — | — | único por (producto, ubicación) |

**Endpoints:** `GET /inventory`, `PATCH /inventory/:id`, `POST /inventory/transfer`.

---

### 3.5 Panel / Dashboard (`/panel`) · admin

**Funcionalidades:** KPIs **personalizables por usuario** (activar/desactivar y reordenar widgets, guardado por usuario); exportar Excel/PDF. Widgets: ventas de hoy, total del mes, ticket promedio, **proyección** (regresión lineal 30 días con banda de confianza), tendencia 30 días, ventas por ubicación/vendedor, top 10 productos, stock bajo. Arquitectura extensible vía `registry.ts`.

**Campos** (tabla `user_dashboard_config`): `userId` (PK), `businessId`, `widgets` (jsonb, lista ordenada de IDs), `updatedAt`.

**Endpoints:** `GET /reports/dashboard`, `GET /dashboard-config`, `PUT /dashboard-config`.

---

### 3.6 Reportes (`/reportes`) · admin

**Funcionalidades:** reutiliza widgets + **comparativo por sucursal**: vendido y **ganancia** (ingreso neto − costo congelado) de hoy/mes y de un rango configurable, con totales. Zona horaria `America/La_Paz`; solo ventas `completed`.

**Endpoints:** `GET /reports/summary`, `GET /reports/dashboard`.

---

### 3.7 Caja — Corte Z (`/caja`) · admin

**Funcionalidades:** lectura Z por fecha: totales por **vendedor × ubicación × método de pago** con gran total; exporta a Excel.

**Endpoint:** `GET /reports/cash-z?date=YYYY-MM-DD`.

> ⏳ La tabla `cash_register` (apertura/cierre con fondo inicial y arqueo: `openingAmount`, `closingAmount`, `expectedAmount`) está **declarada pero sin endpoints** (Fase 5 pendiente). El corte Z actual es solo lectura de totales, no un arqueo real.

---

### 3.8 Ubicaciones (`/ubicaciones`) · admin

**Funcionalidades:** listar, crear y editar (incluye activar/desactivar).

**Campos** (tabla `location`): `id`, `businessId`, `name`, `address?`, `isCentral` (ve todas las ubicaciones), `isActive`.

**Endpoints:** `GET /locations`, `POST /locations`, `PATCH /locations/:id`.

---

### 3.9 Usuarios (`/usuarios`) · admin

**Funcionalidades:** listar y crear/editar usuarios con rol (seller/admin) y ubicación; contraseña con argon2; activar/desactivar. Validación: nombre ≥1, usuario ≥3, contraseña ≥6. 409 si username duplicado.

**Campos:** ver tabla `app_user` en §2.

**Endpoints:** `GET /users`, `POST /users`, `PATCH /users/:id`.

---

### 3.10 Clientes / Fiado · dentro del POS (sin página propia)

**Funcionalidades:** listar con saldo de fiado (deudores primero); alta rápida desde el POS; ver detalle (datos + saldo + ventas a crédito + abonos); **registrar abonos**. El saldo = SUM(ventas `credit` completadas) − SUM(abonos). Visibles a todo el negocio (sin scope por ubicación).

**Campos del cliente** (tabla `customer`): `id`, `businessId`, `name`, `phone?`, `notes?`, `isActive`, `createdAt`.

**Campos del abono** (tabla `customer_payment`): `id`, `businessId`, `customerId`, `userId?`, `amount`, `method` (enum de pago), `note?`, `createdAt`.

**Endpoints:** `GET /customers`, `POST /customers`, `GET /customers/:id`, `POST /customers/:id/payments`.

---

### 3.11 Configuración / White-label (`/configuracion`) · admin

**Funcionalidades:** personalizar marca — nombre del negocio y de la app, **logo** (reducido a PNG liviano), colores primario/secundario, pie de recibo, moneda, tasa de impuesto, y **esquema de atributos por rubro** (`productSchema`). Al guardar, el `ThemeProvider` re-aplica colores/textos/logo en toda la app vía variables CSS.

**Campos** (tabla `business`):

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | uuid | PK (tenant) |
| `name` | text | nombre del negocio |
| `logoUrl` | text? | logo (data URI PNG) |
| `themeJson` | jsonb | `{ primary, secondary, radius }` |
| `textsJson` | jsonb | `{ app_name, receipt_footer }` |
| `productSchemaJson` | jsonb | campos custom que muestra la UI por rubro |
| `currency` | text | default `BOB` |
| `taxRate` | numeric | tasa de impuesto |
| `createdAt` | timestamp | |

Contador de recibos (tabla `business_counter`): `businessId` (PK), `lastReceiptNumber` (correlativo atómico por negocio).

**Endpoints:** `GET /business/me`, `PATCH /business`. Categorías: `GET/POST /categories`, `DELETE /categories/:id`.

---

### 3.12 Actividad / Auditoría (`/actividad`) · admin

**Funcionalidades:** registro filtrable (acción, entidad, usuario, rango de fechas) con **diff antes/después**. Admin de sucursal solo ve su ubicación. Acciones registradas: `login`, `create`, `update`, `price_change`, `import`, `stock_adjust`, `transfer`, `sale`, `cancel`, `payment`, `delete`.

**Campos** (tabla `audit_log`): `id`, `businessId`, `userId?`, `locationId?`, `action`, `entity`, `entityId?`, `beforeJson?`, `afterJson?`, `createdAt` — todos tomados del token.

**Endpoint:** `GET /audit`.

---

## 4. Flujos clave transversales

- **Venta (`persistSale`)**: idempotente por UUID del cliente (reintentos/sync no duplican), correlativo de recibo atómico por negocio, **snapshots** de nombre/precio/costo por línea, descuento de stock solo si `completed`. ⚠️ No valida stock ≥ 0 al vender (puede quedar negativo).
- **Cancelación**: solo admin + permiso de ubicación, motivo obligatorio, marca `cancelled`, devuelve stock, audita. Nunca borra.
- **Auditoría**: toda mutación relevante queda registrada con usuario, ubicación y diff.
- **Proyección**: regresión lineal por mínimos cuadrados sobre la tendencia de 30 días con banda de confianza (o promedio simple si <3 días de datos).
- **Multi-tenant**: todo filtra por `businessId` del token; la identidad nunca viene del body.

---

## 5. Modo offline (offline-first)

1. El **catálogo** se replica a IndexedDB (Dexie); el POS busca/escanea siempre sobre la copia local → **vende sin internet**.
2. Cada venta se **encola localmente antes** de tocar la red y emite recibo provisional (`PROV-xxxx`).
3. Un **worker de sync** (arranca con la sesión, escucha `online` + ping cada 30 s) sube la cola en lote a `POST /sales/sync`, **idempotente por UUID**; al confirmarse llega el correlativo real.
4. **`SyncIndicator`** en la barra superior: ámbar "sin conexión · N por subir", azul "N pendientes", verde "sincronizado" (clic = sincronizar ahora).
5. Restricciones offline por consistencia: **sin descuentos, sin comprador y sin fiado**.

**Almacenamiento local** (Dexie, BD `ventafacil`): tablas `catalog` (productos), `pendingSales` (cola de ventas: `id`, `payload`, `status`, `attempts`, `lastError`, `createdAt`), `meta` (ubicaciones cacheadas, `lastSyncAt`).

---

## 6. Estado del proyecto

- ✅ **Implementado:** auth, productos, inventario+transferencias, ventas+cancelaciones, sync offline, clientes/fiado, reportes, dashboard configurable, corte Z (lectura), auditoría, white-label, multi-sucursal/multi-tenant.
- ⏳ **Pendiente:** apertura/cierre de caja real con fondo y arqueo (tabla `cash_register` existe pero sin endpoints — Fase 5).

---

## Anexo — Enums del sistema

| Enum | Valores |
|------|---------|
| `role` | `admin`, `seller` |
| `sale_status` | `completed`, `cancelled` |
| `payment_method` | `cash`, `card`, `qr`, `transfer`, `credit` (fiado) |
| `sync_status` (offline) | `pending`, `synced`, `error` |

Moneda por defecto: **BOB** (`Bs.`) · Zona horaria: **America/La_Paz**
</content>
</invoke>
