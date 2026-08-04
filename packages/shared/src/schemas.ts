import { z } from 'zod';
import { PAYMENT_METHODS, ROLES, SALE_STATUS } from './constants.js';

/**
 * Dinero: string decimal para no perder precision (nunca float).
 *
 * NO admite negativos. Antes sí, y eso dejaba abrir una caja con -200, cerrarla
 * contando -999 y registrar ventas con total negativo. Ninguno de esos valores tiene
 * sentido en un punto de venta, y aceptarlos convierte cualquier bug del cliente en un
 * descuadre contable silencioso.
 */
export const money = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Monto invalido (usa hasta 2 decimales, sin negativos)');

/** Para los pocos sitios donde un negativo SÍ tiene sentido (ajustes, diferencias). */
export const moneyConSigno = z
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

/**
 * Contraseñas: 8 caracteres como mínimo en todo lo que se crea desde fuera.
 *
 * Los usuarios que da de alta un admin siguen con 6 (`createUserSchema`) para no
 * romper a quien ya los tiene así; pero quien se registra solo, y quien restablece su
 * contraseña, empiezan con el listón más alto.
 */
export const passwordNueva = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres');

// ── Registro self-service ──────────────────────────────────────
export const registerSchema = z.object({
  businessName: z.string().min(2, 'Escribe el nombre del negocio').max(80),
  // El subdominio. Se valida el formato aquí y la disponibilidad en el servidor.
  slug: z.string().min(3).max(30),
  adminName: z.string().min(2, 'Escribe tu nombre').max(80),
  email: z.string().email('Correo inválido').max(200),
  username: z.string().min(3, 'El usuario debe tener al menos 3 caracteres').max(40),
  password: passwordNueva,
  /**
   * Aceptación de los términos. Se exige en el esquema y no sólo en el formulario:
   * un alta por API sin aceptar nada dejaría un negocio sin constancia de haber
   * aceptado, que es justo lo que hace falta poder demostrar.
   */
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: 'Debes aceptar los términos para continuar' }),
  }),
});

// ── Recuperación de contraseña ─────────────────────────────────
export const forgotPasswordSchema = z.object({
  email: z.string().email().max(200),
  /** Slug del negocio. Lo pone el frontend desde el subdominio. */
  business: z.string().min(1).optional(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20),
  password: passwordNueva,
});

export const verifyEmailSchema = z.object({
  token: z.string().min(20),
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

/** Dos importes en string decimal son iguales dentro de un centavo. */
const igual = (a: string, b: string) => Math.abs(Number(a) - Number(b)) < 0.005;

export const createSaleSchema = z
  .object({
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
  })
  /**
   * La aritmética tiene que cuadrar consigo misma.
   *
   * Los precios llegan del cliente a propósito —son un SNAPSHOT del momento de la
   * venta, y el POS vende sin conexión, así que el servidor no puede recalcularlos con
   * los precios de hoy sin falsear el histórico. Pero sí puede exigir que lo que llega
   * sea coherente: antes se aceptaba `total: "1.00"` con `subtotal: "30.00"`, o una
   * línea de Bs. 9999 para un producto de Bs. 10.
   */
  .refine((d) => d.items.every((it) => igual(it.lineTotal, String(Number(it.unitPriceSnapshot) * it.quantity))), {
    message: 'El total de una línea no coincide con precio × cantidad',
    path: ['items'],
  })
  .refine((d) => igual(d.subtotal, String(d.items.reduce((a, it) => a + Number(it.lineTotal), 0))), {
    message: 'El subtotal no coincide con la suma de las líneas',
    path: ['subtotal'],
  })
  .refine((d) => Number(d.discount) <= Number(d.subtotal), {
    message: 'El descuento no puede superar al subtotal',
    path: ['discount'],
  })
  .refine((d) => igual(d.total, String(Number(d.subtotal) - Number(d.discount))), {
    message: 'El total no coincide con subtotal menos descuento',
    path: ['total'],
  })
  /**
   * Una venta con fecha futura desaparecería de todo arqueo (el turno filtra por
   * `client_created_at`), así que el dinero estaría en el cajón sin figurar en ninguna
   * parte. Se admite un margen de holgura por relojes mal puestos.
   */
  .refine((d) => new Date(d.clientCreatedAt).getTime() < Date.now() + 24 * 3_600_000, {
    message: 'La fecha de la venta no puede estar en el futuro',
    path: ['clientCreatedAt'],
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
    /**
     * Sin correo no hay forma de recuperar la contraseña. Se puede añadir desde el
     * perfil, que es como los usuarios anteriores al registro self-service (que no
     * tienen ninguno) dejan de depender de que alguien se la resetee a mano.
     */
    email: z.string().email('Correo inválido').max(200).nullable().optional(),
    currentPassword: z.string().min(1).optional(),
    newPassword: z.string().min(6).optional(),
  })
  .refine(
    (d) => d.name !== undefined || d.newPassword !== undefined || d.email !== undefined,
    {
      message: 'No hay cambios para guardar',
    },
  )
  .refine((d) => d.newPassword === undefined || !!d.currentPassword, {
    message: 'Ingresa tu contraseña actual',
    path: ['currentPassword'],
  });

// ── Caja / arqueo ──────────────────────────────────────────────
export const CASH_MOVEMENT_TYPES = ['in', 'out'] as const;
export type CashMovementType = (typeof CASH_MOVEMENT_TYPES)[number];

export const openCashSchema = z.object({
  /** Efectivo con el que arranca el cajón. Puede ser 0. */
  openingAmount: money,
  /** Sólo la central elige ubicación; el resto abre la suya. */
  locationId: z.string().uuid().optional(),
});

export const closeCashSchema = z.object({
  /** Lo que la persona CONTÓ de verdad, no lo que el sistema espera. */
  countedAmount: money,
  notes: z.string().max(500).optional(),
});

export const cashMovementSchema = z.object({
  type: z.enum(CASH_MOVEMENT_TYPES, { required_error: 'Indica si entra o sale dinero' }),
  amount: money
    .refine((v) => Number(v) > 0, 'El monto debe ser mayor a cero'),
  // Un movimiento sin motivo es indistinguible de un faltante.
  reason: z
    .string({ required_error: 'Explica el motivo' })
    .min(3, 'Explica el motivo')
    .max(200),
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
