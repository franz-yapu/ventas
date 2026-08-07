/**
 * Qué se puede registrar en la bitácora, y cómo se llama en español.
 *
 * Vive aquí, y no en la pantalla, porque el servidor y la web tenían dos listas que se
 * fueron separando en silencio: el API emitía **21** acciones y `AuditPage` sabía traducir
 * **8**. Las otras trece salían crudas en la única pantalla que un dueño tiene para
 * vigilar a su gente — leía `transfer`, `open`, `close`, `stock_adjust` y tenía que
 * adivinar. La bitácora es el control contra el fraude interno; si no se entiende, no
 * controla nada.
 *
 * Con la lista aquí y los rótulos tipados como `Record<AuditAction, string>`, añadir una
 * acción nueva sin ponerle nombre **no compila**. Es la única forma de que no vuelva a
 * separarse: acordarse no funcionó.
 */

export const AUDIT_ACTIONS = [
  'login',
  'create',
  'update',
  'delete',
  'cancel',
  'sale',
  'payment',
  'price_change',
  'stock_adjust',
  'transfer',
  'import',
  'export',
  'open',
  'close',
  'revoke_sessions',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  login: 'Inicio de sesión',
  create: 'Creación',
  update: 'Edición',
  delete: 'Eliminación',
  cancel: 'Anulación',
  sale: 'Venta',
  payment: 'Abono de fiado',
  price_change: 'Cambio de precio',
  stock_adjust: 'Ajuste de stock',
  transfer: 'Transferencia entre sucursales',
  import: 'Importación',
  export: 'Exportación de datos',
  open: 'Apertura de caja',
  close: 'Cierre de caja',
  revoke_sessions: 'Cierre de sesiones',
};

export const AUDIT_ENTITIES = [
  'app_user',
  'business',
  'category',
  'customer',
  'inventory',
  'location',
  'product',
  'sale',
  'cash_register',
  'cash_movement',
] as const;

export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

export const AUDIT_ENTITY_LABELS: Record<AuditEntity, string> = {
  app_user: 'Usuario',
  business: 'Negocio',
  category: 'Categoría',
  customer: 'Cliente',
  inventory: 'Inventario',
  location: 'Sucursal',
  product: 'Producto',
  sale: 'Venta',
  cash_register: 'Caja',
  cash_movement: 'Movimiento de caja',
};

/**
 * Las acciones del PANEL DE PLATAFORMA no están aquí a propósito.
 *
 * Van a `platform_audit_log`, que es otra tabla y otra pantalla: lo que hacemos nosotros
 * sobre la cartera de clientes no se mezcla con lo que hace el personal de un negocio
 * sobre su propio inventario. Si algún día se enseñan, tendrán su propia lista.
 */
