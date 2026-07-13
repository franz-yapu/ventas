import { z } from 'zod';
import { PAYMENT_METHODS, ROLES, SALE_STATUS } from './constants.js';

/** Dinero: string decimal para no perder precision (nunca float). */
export const money = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'Monto invalido (usa hasta 2 decimales)');

// ── White-label / negocio ──────────────────────────────────────
export const themeSchema = z.object({
  primary: z.string().default('#1e40af'),
  secondary: z.string().default('#f59e0b'),
  radius: z.string().default('0.5rem'),
});

export const textsSchema = z.record(z.string()).default({});

/** Define que campos custom (JSONB attributes) muestra la UI por rubro. */
export const productFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'number', 'select']).default('text'),
  options: z.array(z.string()).optional(),
  required: z.boolean().default(false),
});
export const productSchemaJson = z.array(productFieldSchema).default([]);

export const businessSettingsSchema = z.object({
  name: z.string().min(1),
  currency: z.string().default('BOB'),
  taxRate: money.default('0'),
  theme: themeSchema,
  texts: textsSchema,
  productSchema: productSchemaJson,
});

// ── Auth ───────────────────────────────────────────────────────
export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  // Slug del negocio (multi-negocio en una misma BD). Opcional: si hay un solo
  // negocio, el login lo resuelve solo. Requerido si hay varios.
  business: z.string().min(1).optional(),
});

// ── Usuarios / ubicaciones ─────────────────────────────────────
export const createUserSchema = z.object({
  name: z.string().min(1),
  username: z.string().min(3),
  password: z.string().min(6),
  role: z.enum(ROLES),
  locationId: z.string().uuid().nullable().optional(),
});

export const createLocationSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
});

// ── Productos ──────────────────────────────────────────────────
export const upsertProductSchema = z.object({
  // Opcional: si no se indica (o viene vacío, p.ej. celda de CSV en blanco) al crear,
  // el backend genera un SKU correlativo (Pxxxxxx).
  sku: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().min(1).optional(),
  ),
  barcode: z.string().nullable().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  price: money,
  // cost = precio de compra unitario; costWholesale = precio de compra por mayor.
  cost: money.nullable().optional(),
  costWholesale: money.nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  /** Campos custom por rubro (llantas: medida; repuestos: OEM). */
  attributes: z.record(z.unknown()).default({}),
  isActive: z.boolean().default(true),
  // Sólo al CREAR (la central asigna). Se ignoran al editar el producto.
  // locationId = sucursal dueña; initialStock/minStock siembran su fila de inventario.
  locationId: z.string().uuid().optional(),
  initialStock: z.coerce.number().int().min(0).optional(),
  minStock: z.coerce.number().int().min(0).nullable().optional(),
});

// ── Ventas (creadas en el cliente, offline-first) ──────────────
export const saleItemSchema = z.object({
  productId: z.string().uuid(),
  productNameSnapshot: z.string(),
  unitPriceSnapshot: money,
  // Costo unitario al momento de la venta (para ganancia historica).
  unitCostSnapshot: money.nullable().optional(),
  quantity: z.number().int().positive(),
  lineTotal: money,
});

export const createSaleSchema = z.object({
  /** UUID generado en el dispositivo -> idempotencia al sincronizar. */
  id: z.string().uuid(),
  locationId: z.string().uuid(),
  customerId: z.string().uuid().nullable().optional(),
  status: z.enum(SALE_STATUS).default('completed'),
  subtotal: money,
  discount: money.default('0'),
  total: money,
  paymentMethod: z.enum(PAYMENT_METHODS),
  // Acepta offset de zona (los dispositivos offline pueden enviar hora local con offset).
  clientCreatedAt: z.string().datetime({ offset: true }),
  items: z.array(saleItemSchema).min(1),
});

/** Sincronizacion en lote: acepta varias ventas, responde por item. */
export const syncSalesSchema = z.object({
  sales: z.array(createSaleSchema).max(200),
});

export const cancelSaleSchema = z.object({
  reason: z.string().min(3),
});

// ── Perfil propio (auto-edición) ───────────────────────────────
// El usuario autenticado edita su nombre y/o contraseña. Para cambiar la
// contraseña debe confirmar la actual. No permite tocar rol/ubicación/estado.
export const updateProfileSchema = z
  .object({
    name: z.string().min(1).optional(),
    currentPassword: z.string().min(1).optional(),
    newPassword: z.string().min(6).optional(),
  })
  .refine((d) => d.name !== undefined || d.newPassword !== undefined, {
    message: 'No hay cambios para guardar',
  })
  .refine((d) => d.newPassword === undefined || !!d.currentPassword, {
    message: 'Ingresa tu contraseña actual',
    path: ['currentPassword'],
  });

// ── Clientes / fiado ───────────────────────────────────────────
export const upsertCustomerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const customerPaymentSchema = z.object({
  amount: money,
  method: z.enum(PAYMENT_METHODS).default('cash'),
  note: z.string().nullable().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type UpsertProductInput = z.infer<typeof upsertProductSchema>;
export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type SyncSalesInput = z.infer<typeof syncSalesSchema>;
export type BusinessSettings = z.infer<typeof businessSettingsSchema>;
