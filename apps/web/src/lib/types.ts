import type { PaymentMethod, SaleStatus } from '@ventafacil/shared';

export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  categoryId: string | null;
  price: string;
  // Opcionales porque el servidor OMITE las claves para el vendedor (no las manda en
  // `null`): el costo no viaja hacia quien no debe verlo. Si aquí dijeran `string | null`
  // el compilador dejaría pasar código que da por hecho un costo que nunca llega.
  cost?: string | null; // precio de compra unitario
  costWholesale?: string | null; // precio de compra por mayor
  imageUrl: string | null;
  attributes: Record<string, unknown>;
  isActive: boolean;
  locationId: string | null;
  locationName: string | null;
  canManage: boolean;
  // Stock actual y mínimo en la ubicación dueña del producto (para el POS).
  stock: number | null;
  minStock: number | null;
}

export interface Category {
  id: string;
  name: string;
}

export interface Location {
  id: string;
  name: string;
  address: string | null;
  isCentral: boolean;
  isActive: boolean;
}

export interface InventoryRow {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  locationId: string;
  locationName: string;
  quantity: number;
  minStock: number | null;
  canAdjust: boolean;
}

export interface HistoryEntry {
  id: string;
  action: string;
  entity: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
  userName: string | null;
}

export interface AppUserRow {
  id: string;
  name: string;
  username: string;
  role: 'admin' | 'seller';
  locationId: string | null;
  isActive: boolean;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  /** Suma de "total" de todo el conjunto filtrado (opcional; lo devuelve /sales). */
  sumTotal?: string;
}

export interface SaleRow {
  id: string;
  receiptNumber: number | null;
  total: string;
  status: SaleStatus;
  paymentMethod: PaymentMethod;
  clientCreatedAt: string;
  locationName: string | null;
  sellerName: string | null;
  customerName: string | null;
}

export interface SaleItem {
  id: string;
  productId: string | null;
  productNameSnapshot: string;
  unitPriceSnapshot: string;
  quantity: number;
  lineTotal: string;
}

export interface SaleDetail extends SaleRow {
  subtotal: string;
  discount: string;
  items: SaleItem[];
}

export interface DashboardData {
  kpi: { todayTotal: string; todayCount: number; yesterdayTotal: string; avgTicket: string };
  trend: Array<{ date: string; total: number }>;
  /** Los 30 días ANTERIORES a `trend`, para comparar periodo contra periodo. */
  trendPrev?: Array<{ date: string; total: number }>;
  byLocation: Array<{ name: string; total: string; count: number }>;
  bySeller: Array<{ name: string; total: string; count: number }>;
  topProducts: Array<{ name: string; qty: number; revenue: string }>;
  lowStock: Array<{ name: string; location: string; quantity: number; minStock: number }>;
  projection: { nextMonth: string; low: string; high: string; avgDaily: string; method: string };
}

export interface CashZ {
  date: string;
  rows: Array<{
    seller: string;
    location: string;
    paymentMethod: string;
    total: string;
    count: number;
  }>;
  grandTotal: string;
}

// ── Caja / arqueo ──────────────────────────────────────────────
export interface CashBreakdown {
  openingAmount: string;
  cashSales: string;
  movementsIn: string;
  movementsOut: string;
  /** Lo cobrado en efectivo que después se anuló, ya sumado dentro de `cashSales`. */
  cancelledCash: string;
  /** Lo que DEBERÍA haber en el cajón. */
  expected: string;
  byPaymentMethod: Array<{ paymentMethod: string; total: string; count: number }>;
  salesCount: number;
}

export interface CashMovement {
  id: string;
  type: 'in' | 'out';
  amount: string;
  reason: string;
  createdAt: string;
}

export interface CashRegister {
  id: string;
  locationId: string;
  userId: string;
  closedBy: string | null;
  openedAt: string;
  closedAt: string | null;
  openingAmount: string;
  closingAmount: string | null;
  expectedAmount: string | null;
  notes: string | null;
}

export interface CashCurrent {
  register: CashRegister;
  breakdown: CashBreakdown;
  movements: CashMovement[];
}

export interface CashHistoryRow {
  id: string;
  locationName: string;
  openedBy: string;
  openedAt: string;
  closedAt: string | null;
  openingAmount: string;
  expectedAmount: string | null;
  closingAmount: string | null;
  notes: string | null;
  /** `null` mientras el turno sigue abierto. */
  difference: string | null;
}

/** Un comprador: a quién se le vendió. Sin saldo — el fiado ya no existe. */
export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
}

export interface AuditRow {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
  userName: string | null;
  locationName: string | null;
}

export interface ReportSummary {
  byLocation: Array<{
    locationId: string;
    locationName: string;
    today: string;
    week: string;
    month: string;
    todayCount: number;
    profitToday: string;
    profitWeek: string;
    profitMonth: string;
    rangeTotal: string;
    rangeCount: number;
    rangeProfit: string;
  }>;
  hasRange: boolean;
  totals: { today: string; week: string; month: string; range: string };
  profit: { today: string; week: string; month: string; range: string };
  rangeCount: number;
}
