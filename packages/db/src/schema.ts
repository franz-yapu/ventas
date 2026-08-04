import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ── Enums ──────────────────────────────────────────────────────
export const roleEnum = pgEnum('role', ['admin', 'seller']);
export const saleStatusEnum = pgEnum('sale_status', ['completed', 'cancelled']);
// 'credit' = fiado (queda como cuenta por cobrar del cliente).
export const paymentMethodEnum = pgEnum('payment_method', ['cash', 'card', 'qr', 'transfer', 'credit']);
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'trial',
  'active',
  'past_due',
  'suspended',
  'cancelled',
]);

// ── Negocio (tenant) ───────────────────────────────────────────
export const business = pgTable('business', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  // Identificador corto y único del negocio para resolver el tenant en login
  // (multi-negocio en una misma BD). Nulo = instalación de un solo negocio.
  slug: text('slug').unique(),
  logoUrl: text('logo_url'),
  themeJson: jsonb('theme_json').notNull().default({}),
  textsJson: jsonb('texts_json').notNull().default({}),
  // Define que campos custom (product.attributes) muestra la UI por rubro.
  productSchemaJson: jsonb('product_schema_json').notNull().default([]),
  currency: text('currency').notNull().default('BOB'),
  taxRate: numeric('tax_rate', { precision: 6, scale: 4 }).notNull().default('0'),
  // Prefijo del SKU automático de productos (ej. 'P' -> P000001; 'LLA-' -> LLA-000001).
  skuPrefix: text('sku_prefix').notNull().default('P'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Contador correlativo de recibos POR negocio (asignado por el servidor en sync).
export const businessCounter = pgTable('business_counter', {
  businessId: uuid('business_id')
    .primaryKey()
    .references(() => business.id, { onDelete: 'cascade' }),
  lastReceiptNumber: integer('last_receipt_number').notNull().default(0),
  // Correlativo para generar el SKU automático de productos (cuando no se indica uno).
  lastSku: integer('last_sku').notNull().default(0),
});

// ── Capa SaaS: planes y suscripciones ──────────────────────────
//
// Van FUERA de RLS, junto a `business`, porque son datos de la PLATAFORMA y no del
// negocio: el panel super-admin (#7) tiene que poder listar todos los tenants, y RLS
// falla cerrado — con una política de tenant no vería ninguno. Desde el lado del
// negocio siempre se consultan con `where business_id = <el del token>`, igual que
// `business`.

/** Catálogo de planes. Se siembra desde `PLAN_CATALOG` (@ventafacil/shared). */
export const plan = pgTable('plan', {
  // El código es la clave: es estable, legible en la base y viaja al frontend.
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  priceMonthly: numeric('price_monthly', { precision: 12, scale: 2 }).notNull().default('0'),
  currency: text('currency').notNull().default('BOB'),
  // null = sin límite.
  maxLocations: integer('max_locations'),
  maxUsers: integer('max_users'),
  maxProducts: integer('max_products'),
  features: jsonb('features').notNull().default([]),
  // Los no públicos no se ofrecen en el alta (ej. el plan interno `propietario`).
  isPublic: boolean('is_public').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

/** Una suscripción por negocio: se cobra por negocio, no por sucursal ni por usuario. */
export const subscription = pgTable('subscription', {
  businessId: uuid('business_id')
    .primaryKey()
    .references(() => business.id, { onDelete: 'cascade' }),
  planCode: text('plan_code')
    .notNull()
    .references(() => plan.code, { onDelete: 'restrict' }),
  status: subscriptionStatusEnum('status').notNull().default('trial'),
  // Fin de la prueba gratis. Que la prueba haya vencido se DEDUCE de esta fecha; no
  // hay un cron que marque estados, porque un cron que no corre regala el servicio.
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  // Hasta cuándo está pagado el periodo en curso (lo usará el cobro automático, #11).
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  suspendedReason: text('suspended_reason'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Operador de la plataforma: tú, por encima de cualquier negocio.
 *
 * Es una tabla APARTE de `app_user` a propósito. Si el super-admin fuera un rol más
 * del enum (`admin | seller | platform`), cualquier fallo que dejara escribir el rol
 * de un usuario — un PATCH mal validado, un seed descuidado — convertiría a un cliente
 * en operador de la plataforma. Con dos tablas y dos secretos de firma distintos, un
 * token de negocio no puede llegar a ser un token de plataforma ni por error.
 */
export const platformAdmin = pgTable('platform_admin', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Bitácora de lo que hace la plataforma SOBRE un negocio (suspender, reactivar,
 * cambiar de plan).
 *
 * No se mezcla con `audit_log`: aquélla es del negocio, está bajo RLS y el cliente la
 * ve en su pantalla de Actividad. Suspender a alguien es un acto tuyo, no suyo, y
 * necesita quedar registrado aunque el negocio ya no pueda entrar.
 */
export const platformAuditLog = pgTable(
  'platform_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id').references(() => platformAdmin.id, { onDelete: 'set null' }),
    // Se conserva el nombre por si el admin se borra: la bitácora no debe quedar muda.
    adminEmail: text('admin_email').notNull(),
    action: text('action').notNull(),
    businessId: uuid('business_id').references(() => business.id, { onDelete: 'set null' }),
    businessName: text('business_name'),
    beforeJson: jsonb('before_json'),
    afterJson: jsonb('after_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('platform_audit_date_idx').on(t.createdAt)],
);

export const location = pgTable(
  'location',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => business.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    address: text('address'),
    // La ubicación central: sus usuarios admin ven todas las ubicaciones (las demás solo la suya).
    isCentral: boolean('is_central').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [index('location_business_idx').on(t.businessId)],
);

export const appUser = pgTable(
  'app_user',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => business.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id').references(() => location.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    username: text('username').notNull(),
    // Sin correo no se puede recuperar la contraseña. Es nulo porque los usuarios
    // anteriores al registro self-service no tienen ninguno; se añade desde el perfil.
    email: text('email'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    passwordHash: text('password_hash').notNull(),
    role: roleEnum('role').notNull().default('seller'),
    isActive: boolean('is_active').notNull().default(true),
    /**
     * Versión de los tokens del usuario. Cada token firmado la lleva dentro; si no
     * coincide con ésta, no vale. Subirla en uno echa a la persona de todas partes.
     *
     * Es un CONTADOR y no una fecha de corte a propósito. Con una fecha habría que
     * compararla contra el `iat` del token, que va en segundos enteros: un token
     * emitido en el mismo segundo que la revocación sobreviviría, y apretar la
     * comparación dejaría fuera a quien vuelve a entrar en ese mismo segundo. Un
     * entero no tiene ese hueco.
     */
    tokenVersion: integer('token_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('app_user_business_username_uq').on(t.businessId, t.username),
    // Único POR NEGOCIO, no global: la misma persona puede ser dueña de dos negocios
    // con el mismo correo. Postgres admite varios NULL, así que los usuarios sin
    // correo no chocan entre sí.
    unique('app_user_business_email_uq').on(t.businessId, t.email),
    index('app_user_business_idx').on(t.businessId),
  ],
);

/**
 * Enlaces de un solo uso que viajan por correo: restablecer la contraseña y verificar
 * la dirección.
 *
 * Se guarda el **hash** del token, nunca el token. Lo que llega al correo es un valor
 * aleatorio de 256 bits; en la base sólo queda su sha256. Así, quien consiguiera leer
 * la tabla no podría entrar en ninguna cuenta.
 *
 * Va FUERA de RLS a propósito: el enlace se abre SIN sesión, y hay que encontrar el
 * token antes de saber de qué negocio es. El control de acceso aquí es el token en sí
 * — 256 bits aleatorios no se adivinan.
 */
/**
 * Sesiones abiertas: una fila por refresh token vivo.
 *
 * El refresh token deja de ser autosuficiente y pasa a ser un puntero a esta tabla —
 * si la fila no está, o está revocada, el token no vale aunque la firma sea correcta.
 * Sin esto, dar de baja a un empleado no lo echaba: seguía renovando su sesión durante
 * los 30 días de vida del refresh.
 *
 * NO se rota el refresh en cada uso, a propósito. La rotación con detección de reúso
 * es más estricta, pero en un POS con conexión mala un reintento tras un corte llega
 * con el token anterior y dejaría a la caja fuera en mitad de la venta. Aquí el token
 * se mantiene y lo que se valida es la fila, que ya permite revocar en el acto.
 */
export const refreshSession = pgTable(
  'refresh_session',
  {
    // Es el `jti` que viaja dentro del refresh token.
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => business.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** Para que la persona reconozca sus sesiones al listarlas. */
    userAgent: text('user_agent'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('refresh_session_user_idx').on(t.userId, t.revokedAt)],
);

export const authTokenPurposeEnum = pgEnum('auth_token_purpose', [
  'password_reset',
  'email_verify',
]);

export const authToken = pgTable(
  'auth_token',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => business.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    purpose: authTokenPurposeEnum('purpose').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // Un enlace usado no vuelve a valer, aunque no haya caducado.
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('auth_token_user_idx').on(t.userId, t.purpose)],
);

export const category = pgTable(
  'category',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => business.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
  },
  (t) => [index('category_business_idx').on(t.businessId)],
);

export const product = pgTable(
  'product',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => business.id, { onDelete: 'cascade' }),
    // Ubicación dueña del producto (central o una sucursal).
    locationId: uuid('location_id').references(() => location.id, { onDelete: 'set null' }),
    sku: text('sku').notNull(),
    barcode: text('barcode'),
    name: text('name').notNull(),
    description: text('description'),
    categoryId: uuid('category_id').references(() => category.id, { onDelete: 'set null' }),
    price: numeric('price', { precision: 12, scale: 2 }).notNull(),
    // cost = precio de compra UNITARIO (usado para calcular ganancia).
    cost: numeric('cost', { precision: 12, scale: 2 }),
    // precio de compra POR MAYOR (informativo, para comparar contra el unitario).
    costWholesale: numeric('cost_wholesale', { precision: 12, scale: 2 }),
    imageUrl: text('image_url'),
    // Campos propios por rubro sin migraciones (llantas: medida; repuestos: OEM).
    attributes: jsonb('attributes').notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('product_business_sku_uq').on(t.businessId, t.sku),
    index('product_business_name_idx').on(t.businessId, t.name),
    index('product_business_barcode_idx').on(t.businessId, t.barcode),
    index('product_business_location_idx').on(t.businessId, t.locationId),
  ],
);

export const inventory = pgTable(
  'inventory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => business.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => location.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull().default(0),
    minStock: integer('min_stock'),
  },
  (t) => [
    unique('inventory_product_location_uq').on(t.productId, t.locationId),
    index('inventory_business_idx').on(t.businessId),
  ],
);

// Clientes frecuentes (Fase 6): para ventas al fiado y cuentas por cobrar.
export const customer = pgTable(
  'customer',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => business.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phone: text('phone'),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('customer_business_idx').on(t.businessId, t.name)],
);

// Abonos del cliente (pagos contra su saldo de fiado).
export const customerPayment = pgTable(
  'customer_payment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => business.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => appUser.id, { onDelete: 'set null' }),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    method: paymentMethodEnum('method').notNull().default('cash'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('customer_payment_customer_idx').on(t.customerId)],
);

export const sale = pgTable(
  'sale',
  {
    // UUID generado en el CLIENTE (idempotencia offline).
    id: uuid('id').primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => business.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => location.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id').references(() => customer.id, { onDelete: 'set null' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id, { onDelete: 'restrict' }),
    status: saleStatusEnum('status').notNull().default('completed'),
    subtotal: numeric('subtotal', { precision: 12, scale: 2 }).notNull(),
    discount: numeric('discount', { precision: 12, scale: 2 }).notNull().default('0'),
    total: numeric('total', { precision: 12, scale: 2 }).notNull(),
    paymentMethod: paymentMethodEnum('payment_method').notNull(),
    // Correlativo por negocio, asignado por el SERVIDOR al sincronizar.
    receiptNumber: integer('receipt_number'),
    clientCreatedAt: timestamp('client_created_at', { withTimezone: true }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledReason: text('cancelled_reason'),
    cancelledBy: uuid('cancelled_by').references(() => appUser.id, { onDelete: 'set null' }),
  },
  (t) => [
    // Indice principal de reportes (por negocio, ubicacion y fecha).
    index('sale_business_location_date_idx').on(t.businessId, t.locationId, t.clientCreatedAt),
    index('sale_business_status_idx').on(t.businessId, t.status),
    unique('sale_business_receipt_uq').on(t.businessId, t.receiptNumber),
  ],
);

export const saleItem = pgTable(
  'sale_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sale.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => product.id, { onDelete: 'set null' }),
    productNameSnapshot: text('product_name_snapshot').notNull(),
    unitPriceSnapshot: numeric('unit_price_snapshot', { precision: 12, scale: 2 }).notNull(),
    // Snapshot del costo unitario al momento de la venta -> ganancia historica correcta
    // aunque luego cambie el costo del producto.
    unitCostSnapshot: numeric('unit_cost_snapshot', { precision: 12, scale: 2 }),
    quantity: integer('quantity').notNull(),
    lineTotal: numeric('line_total', { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [index('sale_item_sale_idx').on(t.saleId)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => business.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => appUser.id, { onDelete: 'set null' }),
    locationId: uuid('location_id').references(() => location.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    beforeJson: jsonb('before_json'),
    afterJson: jsonb('after_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_business_date_idx').on(t.businessId, t.createdAt),
    index('audit_business_entity_idx').on(t.businessId, t.entity, t.entityId),
  ],
);

// Layout del dashboard por usuario (Fase 5): lista ordenada de ids de widgets activos.
export const userDashboardConfig = pgTable('user_dashboard_config', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => appUser.id, { onDelete: 'cascade' }),
  businessId: uuid('business_id')
    .notNull()
    .references(() => business.id, { onDelete: 'cascade' }),
  widgets: jsonb('widgets').notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Turno de caja (arqueo). Se abre con el efectivo con el que arranca el cajón y se
 * cierra contando lo que hay dentro.
 *
 *   openingAmount  — con cuánto se abrió.
 *   expectedAmount — lo que DEBERÍA haber según el sistema, congelado al cerrar.
 *   closingAmount  — lo que la persona CONTÓ de verdad.
 *
 * La diferencia entre los dos últimos es el punto de todo esto, y por eso el esperado
 * se guarda en vez de recalcularse: una venta que sincroniza tarde, o una anulación
 * posterior, cambiarían el número y el arqueo de ayer dejaría de cuadrar solo.
 */
export const cashRegister = pgTable(
  'cash_register',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => business.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => location.id, { onDelete: 'cascade' }),
    // Quién abrió. Quién cerró puede ser otra persona: los turnos se relevan.
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id, { onDelete: 'restrict' }),
    closedBy: uuid('closed_by').references(() => appUser.id, { onDelete: 'set null' }),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    openingAmount: numeric('opening_amount', { precision: 12, scale: 2 }).notNull(),
    closingAmount: numeric('closing_amount', { precision: 12, scale: 2 }),
    expectedAmount: numeric('expected_amount', { precision: 12, scale: 2 }),
    /** Explicación de la diferencia, si la hubo. */
    notes: text('notes'),
  },
  (t) => [
    index('cash_register_business_idx').on(t.businessId),
    index('cash_register_location_idx').on(t.locationId, t.openedAt),
    // UNA sola caja abierta por ubicación. Es un cajón físico: dos turnos abiertos a la
    // vez sobre el mismo cajón harían que ninguno de los dos arqueos signifique nada.
    // Índice PARCIAL: sólo restringe las filas sin cerrar.
    uniqueIndex('cash_register_una_abierta_uq')
      .on(t.locationId)
      .where(sql`closed_at is null`),
  ],
);

/**
 * Entradas y salidas de efectivo que NO son ventas: se saca plata para pagar a un
 * proveedor, se mete cambio, se retira la recaudación a media tarde.
 *
 * Sin esto, cada retiro aparecería como un descuadre. Y un arqueo que siempre descuadra
 * enseña a la gente a ignorar los descuadres, que es justo lo contrario de para lo que
 * sirve un arqueo.
 */
export const cashMovementTypeEnum = pgEnum('cash_movement_type', ['in', 'out']);

export const cashMovement = pgTable(
  'cash_movement',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => business.id, { onDelete: 'cascade' }),
    cashRegisterId: uuid('cash_register_id')
      .notNull()
      .references(() => cashRegister.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => appUser.id, { onDelete: 'set null' }),
    type: cashMovementTypeEnum('type').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    /** Obligatorio: un movimiento sin motivo es indistinguible de un faltante. */
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('cash_movement_register_idx').on(t.cashRegisterId)],
);
