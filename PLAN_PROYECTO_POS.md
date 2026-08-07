# Plan de Proyecto: Sistema POS Multi-Sucursal White-Label ("VentaFácil")

> **Instrucciones para Claude Code:** Este documento es el plan maestro del proyecto. Léelo completo antes de empezar. Implementa fase por fase, en orden. Al terminar cada fase, verifica los criterios de aceptación antes de continuar. Mantén este archivo como referencia y no cambies decisiones de arquitectura sin consultarlo.

---

## 1. Contexto del negocio

- Cliente inicial: vendedor de llantas con **2 ubicaciones**: La Paz (ciudad, internet rápido) y un pueblo (internet lento e intermitente).
- Roles: **Admin** (el dueño, en La Paz) y **Vendedor** (trabajador en el pueblo). Deben poder agregarse más ubicaciones y usuarios.
- El sistema debe ser **genérico y white-label**: productos de cualquier rubro, colores, logo y textos personalizables por cliente, para revenderlo a otros negocios.
- Requisitos duros:
  1. Registrar productos (fácil y rápido).
  2. Registrar ventas.
  3. Reportes de ventas por ubicación (y comparativos).
  4. Funcionar con internet lento/intermitente (**offline-first en el punto de venta**).
  5. Imprimir recibo/nota de venta (térmica 58/80mm y PDF).
  6. Log de auditoría de acciones (ventas, cancelaciones, cambios de precio, etc.).
  7. Muy fácil de usar (vendedores sin experiencia técnica).
  8. **Crecer "a la derecha"**: arquitectura preparada para agregar módulos futuros (widgets de dashboard, proyección de ventas, inventario avanzado, etc.).

## 2. Stack tecnológico (decisión final)

| Capa            | Tecnología                                                           | Justificación                                      |
| --------------- | -------------------------------------------------------------------- | -------------------------------------------------- |
| Monorepo        | pnpm workspaces + Turborepo                                          | Estándar, simple, builds incrementales             |
| Frontend        | React 18 + Vite + TypeScript                                         | Rápido, PWA fácil con vite-plugin-pwa              |
| UI              | TailwindCSS + shadcn/ui                                              | Theming con variables CSS (clave para white-label) |
| Estado servidor | TanStack Query                                                       | Cache, reintentos, ideal para conexiones malas     |
| Offline         | Dexie.js (IndexedDB) + cola de sincronización propia                 | Ventas offline con UUID generado en cliente        |
| Backend         | Node.js + Fastify + TypeScript                                       | Ligero y rápido                                    |
| ORM             | Drizzle ORM                                                          | Type-safe, migraciones SQL claras                  |
| Base de datos   | PostgreSQL 16                                                        | Reportes, JSON para auditoría, robustez            |
| Auth            | JWT (access + refresh) con roles                                     | Simple, sin dependencias externas                  |
| Validación      | Zod (compartido front/back en packages/config)                       | Una sola fuente de verdad                          |
| Gráficos        | Recharts                                                             | Dashboard y widgets                                |
| PDF/Recibos     | HTML + CSS @media print (térmica) y pdfmake (PDF)                    | Sin hardware especial en fase 1                    |
| Tests           | Vitest + Playwright (e2e del flujo de venta)                         | El flujo de venta es crítico                       |
| Deploy          | Docker Compose (API + Postgres) en VPS; frontend en Cloudflare Pages | Barato, simple                                     |

## 3. Estructura del monorepo

```
ventafacil/
├── apps/
│   ├── web/                  # PWA: POS + Admin (React + Vite)
│   │   ├── src/
│   │   │   ├── features/
│   │   │   │   ├── pos/          # pantalla de venta (vendedor)
│   │   │   │   ├── products/     # CRUD productos
│   │   │   │   ├── sales/        # historial, cancelaciones
│   │   │   │   ├── reports/      # reportes y dashboard
│   │   │   │   ├── locations/    # ubicaciones
│   │   │   │   ├── users/        # usuarios y roles
│   │   │   │   ├── settings/     # white-label: tema, logo, textos
│   │   │   │   └── audit/        # visor del log de acciones
│   │   │   ├── offline/          # Dexie, cola de sync, hooks
│   │   │   ├── theme/            # ThemeProvider (variables CSS desde BD)
│   │   │   └── lib/
│   └── api/                  # Fastify
│       ├── src/
│       │   ├── modules/          # un módulo por dominio (mismo naming que features)
│       │   ├── plugins/          # auth, tenant, audit
│       │   └── index.ts
├── packages/
│   ├── db/                   # esquema Drizzle + migraciones + seed
│   ├── shared/               # tipos, esquemas Zod, constantes, utils
│   └── ui/                   # componentes UI compartidos (futuro)
├── docker-compose.yml
├── turbo.json
└── pnpm-workspace.yaml
```

**Regla de crecimiento a la derecha:** cada funcionalidad nueva = un `feature/` en web + un `module/` en api + esquemas en `shared`. Nunca lógica de negocio en componentes UI.

## 4. Modelo de datos

Multi-tenant con columna `business_id` en TODAS las tablas (una sola BD para todos los clientes).

```
business        (id, name, logo_url, theme_json, texts_json, currency, tax_rate, created_at)
location        (id, business_id, name, address, is_active)
app_user        (id, business_id, location_id nullable, name, username, password_hash,
                 role ENUM('admin','seller'), is_active)
product         (id, business_id, sku, barcode nullable, name, description,
                 category_id, price DECIMAL, cost DECIMAL nullable, image_url nullable,
                 is_active, created_at, updated_at)
category        (id, business_id, name)
inventory       (id, business_id, product_id, location_id, quantity, min_stock nullable)
                 UNIQUE(product_id, location_id)
sale            (id UUID generado en CLIENTE, business_id, location_id, user_id,
                 status ENUM('completed','cancelled'), subtotal, discount, total,
                 payment_method ENUM('cash','card','qr','transfer'),
                 client_created_at, synced_at nullable, cancelled_reason nullable,
                 cancelled_by nullable, receipt_number SERIAL por business)
sale_item       (id, sale_id, product_id, product_name_snapshot, unit_price_snapshot,
                 quantity, line_total)
audit_log       (id, business_id, user_id, location_id nullable, action VARCHAR,
                 entity VARCHAR, entity_id, before_json JSONB nullable,
                 after_json JSONB nullable, created_at)
cash_register   (id, business_id, location_id, user_id, opened_at, closed_at nullable,
                 opening_amount, closing_amount nullable, expected_amount nullable)  -- Fase 5
```

**Decisiones clave:**

- `sale.id` es UUID **generado en el dispositivo** → las ventas offline nunca colisionan al sincronizar (idempotencia: si el UUID ya existe, el servidor responde 200 sin duplicar).
- `sale_item` guarda **snapshot** de nombre y precio → los reportes históricos no cambian si el admin edita el producto.
- Las ventas **nunca se borran**: cancelar = `status='cancelled'` + registro en `audit_log`.
- `theme_json` ejemplo: `{"primary":"#1e40af","secondary":"#f59e0b","radius":"0.5rem"}`.
- `texts_json` ejemplo: `{"app_name":"Llantas El Rápido","receipt_footer":"¡Gracias por su compra!"}`.

## 5. Arquitectura offline-first (crítica)

1. **Catálogo local:** al iniciar sesión, la PWA descarga productos + precios + config del tema a IndexedDB. Se refresca en background cuando hay conexión (estrategia stale-while-revalidate).
2. **Venta offline:** el vendedor registra la venta → se guarda en Dexie con `sync_status='pending'` y UUID local → el recibo se imprime de inmediato (no espera al servidor).
3. **Cola de sincronización:** un worker revisa conectividad (evento `online` + ping cada 30s) y sube las ventas pendientes en orden. Reintentos con backoff exponencial.
4. **Indicador visible:** badge en la UI: "✓ Sincronizado" / "⏳ 3 ventas pendientes" / "⚠ Sin conexión". El vendedor siempre sabe el estado.
5. **Restricciones offline:** vender SÍ; cancelar ventas, editar productos y ver reportes requieren conexión (evita conflictos complejos).
6. **PWA:** service worker precachea la app completa → carga instantánea incluso sin señal.

## 6. Fases de implementación

### Fase 0 — Fundaciones (setup)

- [ ] Inicializar monorepo (pnpm + turbo), TypeScript estricto, ESLint, Prettier.
- [ ] Docker Compose con PostgreSQL.
- [ ] `packages/db`: esquema Drizzle completo (sección 4) + migración inicial + seed (1 negocio demo, 2 ubicaciones, admin, vendedor, 20 productos de llantas).
- [ ] `packages/shared`: esquemas Zod de todas las entidades.
- [ ] API base: Fastify + auth JWT + middleware de tenant (`business_id` desde el token) + middleware de auditoría.
- [ ] Web base: Vite + React + Tailwind + shadcn/ui + router + layout con ThemeProvider leyendo `theme_json`.
- **Criterio de aceptación:** login funciona, tema se aplica desde BD, seed carga.

### Fase 1 — MVP online (núcleo de valor)

- [ ] CRUD de productos con búsqueda, categorías e imagen opcional. Importación CSV simple.
- [ ] CRUD de ubicaciones y usuarios (solo admin).
- [ ] **Pantalla POS** (la más importante — máxima simpleza):
  - Búsqueda por nombre/SKU con teclado grande, carrito, cantidad, método de pago, botón COBRAR gigante.
  - Diseñada mobile-first (el vendedor del pueblo probablemente usa celular/tablet).
- [ ] Recibo imprimible: vista HTML con `@media print` para térmica 80mm + botón "Descargar PDF". Numeración correlativa por negocio.
- [ ] Historial de ventas con filtros (fecha, ubicación, vendedor, estado).
- [ ] Cancelación de venta (solo admin, exige motivo, registra en audit_log).
- [ ] Reporte básico: total vendido hoy/semana/mes por ubicación, tabla comparativa.
- **Criterio de aceptación:** flujo completo venta→recibo→reporte funciona; test e2e Playwright del flujo de venta pasa.

### Fase 2 — Offline y PWA

- [ ] vite-plugin-pwa: instalable, precache de la app.
- [ ] Dexie: catálogo local + cola de ventas pendientes.
- [ ] Worker de sincronización con reintentos e idempotencia por UUID.
- [ ] Indicador de estado de conexión/sincronización.
- [ ] Endpoint batch `POST /sales/sync` (acepta array, responde por ítem).
- **Criterio de aceptación:** simular offline en DevTools → registrar 3 ventas → imprimir recibos → reconectar → las 3 aparecen en el servidor sin duplicados.

### Fase 3 — Auditoría completa

- [ ] Auditar: crear/editar/eliminar producto, cambio de precio (before/after), venta, cancelación, login, cambio de usuario, cambio de tema.
- [ ] Pantalla "Registro de actividad" para admin: filtros por usuario, acción, fecha, ubicación; detalle con diff before/after.
- **Criterio de aceptación:** cambiar un precio y verlo en el log con valor anterior y nuevo.

### Fase 4 — White-label (customización)

- [ ] Pantalla de configuración (admin): subir logo, elegir colores (primario/secundario), editar textos (nombre de app, pie de recibo, moneda, tasa de impuesto).
- [ ] El recibo usa logo y textos del negocio.
- [ ] Script CLI `pnpm new-tenant` que crea un negocio nuevo con su admin (para onboarding de nuevos clientes en minutos).
- **Criterio de aceptación:** crear un segundo negocio "Ferretería Demo" con otros colores/logo y verificar aislamiento total de datos.

### Fase 5 — Reportes avanzados y dashboard con widgets

- [ ] **Dashboard modular por widgets** (arquitectura de crecimiento a la derecha):
  - Cada widget es un componente autocontenido registrado en un `widgetRegistry` (id, título, componente, endpoint, tamaño).
  - El admin activa/desactiva y reordena widgets; layout persistido por usuario en BD (`user_dashboard_config`).
  - Widgets iniciales: ventas del día, ventas por ubicación (barras), tendencia 30 días (línea), top 10 productos, ticket promedio, ventas por vendedor, productos con stock bajo.
- [ ] **Estimación de crecimiento de ventas:** proyección con media móvil (7/30 días) + regresión lineal simple sobre ventas históricas, por ubicación y global. Widget "Proyección próximo mes" con banda de confianza simple. (Sin ML pesado; con 6+ meses de datos se puede evaluar algo más sofisticado.)
- [ ] Exportar reportes a Excel (xlsx) y PDF.
- [ ] Cierre de caja diario (lectura Z): total por método de pago por vendedor/ubicación.
- **Criterio de aceptación:** agregar un widget nuevo requiere solo crear el componente y registrarlo (sin tocar el layout).

### Fase 6 — Extras según demanda (backlog)

- Control de stock con descuento automático al vender + alertas de stock mínimo + transferencias entre ubicaciones.
- Escáner de código de barras (cámara del celular con `html5-qrcode`).
- Descuentos y promociones.
- Clientes frecuentes / cuentas por cobrar (fiado — muy común en Bolivia).
- Facturación electrónica SIAT (Impuestos Nacionales Bolivia) — proyecto aparte, evaluar solo si el cliente lo exige.
- Notificaciones (resumen diario por WhatsApp/Telegram al admin).
- Modo multi-caja por ubicación.

## 7. Convenciones para el desarrollo

- **Idioma de la UI:** español (textos en `texts_json` + archivo i18n `es.json` para poder traducir después).
- **Commits:** convencionales (`feat:`, `fix:`, `chore:`).
- **API REST:** `/api/v1/{recurso}`, respuestas `{ data, error }`, paginación con `?page=&limit=`.
- **Toda mutación pasa por el middleware de auditoría.**
- **Toda query filtra por `business_id` del token** — nunca confiar en IDs del cliente.
- **Zona horaria:** guardar UTC, mostrar `America/La_Paz`.
- **Moneda:** DECIMAL en BD, nunca float. Formato Bs. con 2 decimales.

## 8. Aprendizajes de proyectos similares (investigación)

- Odoo POS y ERPNext (referentes open source) operan online/offline y etiquetan cada transacción con su sucursal para reportes por dimensión → replicamos con `location_id` en `sale`.
- Los POS multi-tenant maduros (Webkul SaaS POS) restringen operaciones en offline (ej. sin descuentos offline) para simplificar conflictos → adoptado en sección 5.6.
- TailPOS y similares confirman: recibos térmicos ESC/POS + lecturas X/Z de cierre de caja son features esperadas en retail pequeño → cierre de caja en Fase 5.
- OSPOS demuestra que una UI simple con reportes sólidos es suficiente para negocios pequeños; no sobre-ingenierizar.

## 9. Orden de trabajo para Claude Code

1. Ejecuta Fase 0 completa. Muestra la estructura creada y espera confirmación.
2. Continúa fase por fase. Al final de cada una, corre los tests y verifica el criterio de aceptación.
3. Si una decisión no está cubierta por este plan, elige la opción más simple que no bloquee las fases futuras y documéntala en `DECISIONS.md`.
4. Mantén un `CHANGELOG.md` por fase.
