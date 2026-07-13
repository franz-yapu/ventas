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
  uuid,
} from 'drizzle-orm/pg-core';

// ── Enums ──────────────────────────────────────────────────────
export const roleEnum = pgEnum('role', ['admin', 'seller']);
export const saleStatusEnum = pgEnum('sale_status', ['completed', 'cancelled']);
// 'credit' = fiado (queda como cuenta por cobrar del cliente).
export const paymentMethodEnum = pgEnum('payment_method', ['cash', 'card', 'qr', 'transfer', 'credit']);

// ── Negocio (tenant) ───────────────────────────────────────────
export const business = pgTable('business', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
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
    passwordHash: text('password_hash').notNull(),
    role: roleEnum('role').notNull().default('seller'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('app_user_business_username_uq').on(t.businessId, t.username),
    index('app_user_business_idx').on(t.businessId),
  ],
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

// Cash register (Fase 5) — lo dejamos declarado para no re-migrar despues.
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
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id, { onDelete: 'restrict' }),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    openingAmount: numeric('opening_amount', { precision: 12, scale: 2 }).notNull(),
    closingAmount: numeric('closing_amount', { precision: 12, scale: 2 }),
    expectedAmount: numeric('expected_amount', { precision: 12, scale: 2 }),
  },
  (t) => [index('cash_register_business_idx').on(t.businessId)],
);
