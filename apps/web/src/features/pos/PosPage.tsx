import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { PAYMENT_METHODS } from '@ventafacil/shared';
import {
  ArrowRightLeft,
  Banknote,
  Check,
  CloudOff,
  CreditCard,
  Minus,
  Plus,
  Printer,
  QrCode,
  ScanLine,
  Search,
  ShoppingCart,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { useAuth } from '@/features/auth/AuthProvider';
import { Receipt } from '@/features/sales/Receipt';
import { api } from '@/lib/api';
import { money, PAYMENT_LABELS } from '@/lib/format';
import { cn } from '@/lib/utils';
import { printReceipt } from '@/lib/print';
import type { Customer, Location, Product, SaleDetail } from '@/lib/types';
import { getCachedLocations } from '@/offline/db';
import { findByBarcode, searchCatalog, syncCatalog } from '@/offline/catalog';
import { enqueueSale, syncPending } from '@/offline/sync';
import { useBusiness } from '@/theme/ThemeProvider';

// El escáner (html5-qrcode) se carga sólo al abrirlo.
const BarcodeScanner = lazy(() =>
  import('@/features/pos/BarcodeScanner').then((m) => ({ default: m.BarcodeScanner })),
);

interface CartLine {
  product: Product;
  quantity: number;
}

export function PosPage() {
  const { user } = useAuth();
  const business = useBusiness();
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payment, setPayment] = useState<string>('cash');
  const [receipt, setReceipt] = useState<SaleDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [scanOpen, setScanOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const showToast = (text: string, ok = true) => {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 2600);
  };
  const [discount, setDiscount] = useState('0');
  const [customerId, setCustomerId] = useState('');
  const [newCustOpen, setNewCustOpen] = useState(false);

  // Refresca el catálogo local al entrar (si hay conexión). La UI siempre lee de Dexie.
  useEffect(() => {
    getCachedLocations().then(setLocations);
    if (navigator.onLine) {
      // Al terminar el sync, vuelve a leer ubicaciones (evita que queden vacías en el 1er uso).
      syncCatalog()
        .then(() => getCachedLocations().then(setLocations))
        .catch(() => {});
    }
  }, []);

  // Búsqueda reactiva sobre el catálogo local -> funciona offline.
  const products = useLiveQuery(() => searchCatalog(search), [search], [] as Product[]);

  // Clientes (para fiado): sólo con conexión.
  const { data: customers } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get<Customer[]>('/customers'),
    enabled: navigator.onLine,
  });

  const [locationId, setLocationId] = useState('');
  const activeLocation = locationId || user?.locationId || locations[0]?.id || '';

  const subtotal = useMemo(
    () => cart.reduce((sum, l) => sum + Number(l.product.price) * l.quantity, 0),
    [cart],
  );
  // Cantidad ya agregada al carrito por producto (para descontar del stock mostrado).
  const cartQtyById = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of cart) m.set(l.product.id, l.quantity);
    return m;
  }, [cart]);
  // Descuentos sólo con conexión (evita conflictos offline, según el plan).
  const online = navigator.onLine;
  const discountNum = online ? Math.min(Math.max(0, Number(discount) || 0), subtotal) : 0;
  const total = subtotal - discountNum;

  function addToCart(p: Product) {
    setCart((c) => {
      const found = c.find((l) => l.product.id === p.id);
      if (found) return c.map((l) => (l.product.id === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...c, { product: p, quantity: 1 }];
    });
  }
  function setQty(id: string, delta: number) {
    setCart((c) =>
      c.map((l) => (l.product.id === id ? { ...l, quantity: l.quantity + delta } : l)).filter((l) => l.quantity > 0),
    );
  }

  async function onScanned(code: string) {
    const product = await findByBarcode(code);
    setScanOpen(false);
    if (product) {
      addToCart(product);
      showToast(`Agregado: ${product.name}`);
    } else {
      showToast(`Sin producto para el código ${code}`, false);
    }
  }

  async function checkout() {
    if (cart.length === 0 || !activeLocation) return;
    setBusy(true);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const lines = cart.map((l) => ({
      productId: l.product.id,
      productNameSnapshot: l.product.name,
      unitPriceSnapshot: l.product.price,
      unitCostSnapshot: l.product.cost,
      quantity: l.quantity,
      lineTotal: (Number(l.product.price) * l.quantity).toFixed(2),
    }));
    const input = {
      id,
      locationId: activeLocation,
      customerId: customerId || null,
      status: 'completed' as const,
      subtotal: subtotal.toFixed(2),
      discount: discountNum.toFixed(2),
      total: total.toFixed(2),
      paymentMethod: payment as 'cash',
      clientCreatedAt: now,
      items: lines,
    };

    // Se guarda SIEMPRE en la cola local primero (offline-first): la venta nunca se pierde.
    await enqueueSale(input);
    const locName = locations.find((l) => l.id === activeLocation)?.name ?? null;
    const custName = customers?.find((c) => c.id === customerId)?.name ?? null;

    // Recibo provisional inmediato (no espera al servidor).
    let detail: SaleDetail = {
      id,
      receiptNumber: null,
      status: 'completed',
      subtotal: subtotal.toFixed(2),
      discount: discountNum.toFixed(2),
      total: total.toFixed(2),
      paymentMethod: input.paymentMethod,
      clientCreatedAt: now,
      locationName: locName,
      sellerName: user?.name ?? null,
      customerName: custName,
      items: lines.map((l, i) => ({
        id: String(i),
        productId: l.productId,
        productNameSnapshot: l.productNameSnapshot,
        unitPriceSnapshot: l.unitPriceSnapshot,
        quantity: l.quantity,
        lineTotal: l.lineTotal,
      })),
    };

    // Si hay conexión, intenta subir de inmediato para mostrar el correlativo real.
    if (navigator.onLine) {
      try {
        const r = await syncPending();
        if (r.synced > 0) detail = await api.get<SaleDetail>(`/sales/${id}`);
      } catch {
        /* queda pendiente en la cola */
      }
    }

    setReceipt(detail);
    showToast(
      detail.receiptNumber ? `Venta #${detail.receiptNumber} registrada` : 'Venta guardada · se sincroniza luego',
    );
    setCart([]);
    setDiscount('0');
    setCustomerId('');
    setMobileCartOpen(false);
    setBusy(false);
  }

  const canCheckout = cart.length > 0 && !!activeLocation && !busy;
  // Sin fiado: el método 'credit' no se ofrece nunca.
  const methods = PAYMENT_METHODS.filter((m) => m !== 'credit');
  const PAY_ICON: Record<string, typeof Banknote> = {
    cash: Banknote,
    card: CreditCard,
    qr: QrCode,
    transfer: ArrowRightLeft,
  };

  return (
    <div className="grid gap-4 p-4 md:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-3">
        {!online && (
          <div className="flex items-center gap-2.5 rounded-theme border border-warning/25 bg-warning-bg px-3.5 py-2.5 text-sm font-semibold text-warning">
            <CloudOff size={16} />
            Sin conexión — puedes vender; se sincroniza al recuperar internet.
          </div>
        )}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
            <Input
              className="h-12 pl-10 text-lg"
              placeholder="Buscar producto por nombre o SKU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <Button variant="outline" size="lg" className="h-12 px-3" onClick={() => setScanOpen(true)} title="Escanear código">
            <ScanLine size={22} />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {products?.map((p) => {
            // Stock restante = existencia menos lo ya cargado en el carrito.
            const remaining = p.stock == null ? null : p.stock - (cartQtyById.get(p.id) ?? 0);
            const out = remaining != null && remaining <= 0;
            const low = remaining != null && p.minStock != null && remaining <= p.minStock && !out;
            const textCol = out ? 'text-danger' : low ? 'text-warning' : 'text-success';
            const dot = out ? '#c25848' : low ? '#c99a1e' : '#4aa06f';
            const stockLabel = out ? 'Agotado' : low ? `Bajo · ${remaining}` : `Disp. ${remaining}`;
            const cardBorder = out
              ? 'border-danger/40'
              : low
                ? 'border-warning/40'
                : 'border-border hover:border-primary';
            return (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                disabled={out}
                className={`flex min-h-[112px] flex-col gap-2 rounded-theme border bg-surface p-3.5 text-left shadow-card transition hover:shadow-card-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-card disabled:active:scale-100 ${cardBorder}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-[10px] font-medium text-muted">{p.sku}</span>
                  {remaining != null && (
                    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[10px] font-bold ${textCol}`}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
                      {stockLabel}
                    </span>
                  )}
                </div>
                <span className="line-clamp-2 flex-1 text-[15px] font-semibold leading-tight">{p.name}</span>
                <span className="text-[17px] font-bold">{money(p.price)}</span>
              </button>
            );
          })}
          {products && products.length === 0 && (
            <p className="col-span-full py-8 text-center text-muted">Sin resultados</p>
          )}
        </div>
      </div>

      {/* Backdrop de la hoja de carrito en móvil. */}
      {mobileCartOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMobileCartOpen(false)} />
      )}

      <Card
        className={cn(
          'flex-col self-start',
          mobileCartOpen
            ? 'flex max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-50 max-md:max-h-[85vh] max-md:rounded-b-none'
            : 'hidden md:flex',
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3.5">
          <span className="text-base font-bold">Carrito</span>
          {cart.length > 0 && (
            <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-bold text-primary">
              {cart.reduce((n, l) => n + l.quantity, 0)}
            </span>
          )}
          <div className="flex-1" />
          {cart.length > 0 && (
            <button onClick={() => setCart([])} className="text-sm text-muted hover:text-fg">
              Vaciar
            </button>
          )}
          <button onClick={() => setMobileCartOpen(false)} className="text-muted md:hidden" title="Cerrar">
            <X size={18} />
          </button>
        </div>
        <CardContent className="flex max-h-[70vh] flex-col gap-3 pt-4">
          {user?.role === 'admin' && locations.length > 0 && (
            <Select value={activeLocation} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          )}

          <div className="flex-1 overflow-y-auto">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted">
                <ShoppingCart size={28} className="opacity-40" />
                <span className="font-semibold">Carrito vacío</span>
                <span className="text-sm">Toca un producto para agregarlo.</span>
              </div>
            ) : (
              cart.map((l) => (
                <div key={l.product.id} className="flex items-center gap-3 border-b border-border/70 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{l.product.name}</div>
                    <div className="text-xs text-muted">{money(l.product.price)} c/u</div>
                  </div>
                  <div className="flex items-center overflow-hidden rounded-[11px] border border-border">
                    <button onClick={() => setQty(l.product.id, -1)} className="flex h-9 w-9 items-center justify-center bg-bg text-fg hover:bg-muted/10">
                      <Minus size={14} />
                    </button>
                    <span className="w-7 text-center text-sm font-semibold">{l.quantity}</span>
                    <button onClick={() => setQty(l.product.id, 1)} className="flex h-9 w-9 items-center justify-center bg-bg text-fg hover:bg-muted/10">
                      <Plus size={14} />
                    </button>
                  </div>
                  <span className="min-w-[64px] text-right text-sm font-bold">
                    {money((Number(l.product.price) * l.quantity).toFixed(2))}
                  </span>
                  <button onClick={() => setQty(l.product.id, -l.quantity)} className="text-danger" title="Eliminar">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Método de pago: grilla de iconos (como el prototipo). */}
          <div>
            <div className="mb-2 text-xs font-semibold text-muted">Método de pago</div>
            <div className="grid grid-cols-4 gap-2">
              {methods.map((m) => {
                const Icon = PAY_ICON[m] ?? Banknote;
                const active = payment === m;
                const shortLabel = m === 'transfer' ? 'Transf.' : PAYMENT_LABELS[m];
                return (
                  <button
                    key={m}
                    onClick={() => setPayment(m)}
                    className={`flex flex-col items-center gap-1 rounded-theme border py-2.5 text-[11px] font-semibold transition active:scale-95 ${
                      active ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-surface text-muted hover:bg-muted/10'
                    }`}
                  >
                    <Icon size={18} />
                    {shortLabel}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Comprador en la venta (opcional). Sólo con conexión. */}
          {online && (
            <div className="flex items-center gap-2">
              <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="flex-1">
                <option value="">Comprador (opcional)</option>
                {customers?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Button
                variant="outline"
                className="h-10 px-3"
                onClick={() => setNewCustOpen(true)}
                title="Nuevo comprador"
              >
                <UserPlus size={18} />
              </Button>
            </div>
          )}

          {/* Descuento (sólo con conexión) */}
          {cart.length > 0 && (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted">Descuento (Bs.)</span>
              <Input
                inputMode="decimal"
                value={online ? discount : '0'}
                disabled={!online}
                onChange={(e) => setDiscount(e.target.value)}
                className="h-9 w-28 text-right"
                title={online ? '' : 'Los descuentos requieren conexión'}
              />
            </div>
          )}

          {discountNum > 0 && (
            <div className="flex items-center justify-between text-sm text-muted">
              <span>Subtotal</span>
              <span>{money(subtotal)}</span>
            </div>
          )}
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold text-muted">Total</span>
            <span className="text-[32px] font-extrabold tracking-tight">{money(total)}</span>
          </div>

          <Button size="xl" className="h-14 w-full text-base" disabled={!canCheckout} onClick={checkout}>
            {busy ? 'Cobrando…' : `Cobrar · ${money(total)}`}
          </Button>
        </CardContent>
      </Card>

      {scanOpen && (
        <Suspense fallback={null}>
          <BarcodeScanner onScan={onScanned} onClose={() => setScanOpen(false)} />
        </Suspense>
      )}

      {newCustOpen && (
        <NewCustomerModal
          onClose={() => setNewCustOpen(false)}
          onCreated={(id) => {
            setCustomerId(id);
            setNewCustOpen(false);
          }}
        />
      )}

      <Modal
        open={!!receipt}
        onClose={() => setReceipt(null)}
        title={receipt?.receiptNumber ? `Recibo #${receipt.receiptNumber}` : 'Recibo (provisional)'}
      >
        {receipt && (
          <div className="flex flex-col gap-4">
            <div className="max-h-[60vh] overflow-y-auto rounded border border-border">
              <Receipt sale={receipt} business={business} />
            </div>
            <div className="no-print flex gap-2">
              <Button className="flex-1" onClick={printReceipt}>
                <Printer size={18} /> Imprimir
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => setReceipt(null)}>
                Nueva venta
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Barra flotante de carrito (solo móvil): abre la hoja inferior. */}
      {cart.length > 0 && !mobileCartOpen && (
        <button
          onClick={() => setMobileCartOpen(true)}
          className="fixed inset-x-3 bottom-[76px] z-30 flex items-center justify-between rounded-theme bg-primary px-4 py-3.5 text-primary-fg shadow-lg md:hidden"
        >
          <span className="flex items-center gap-2 font-bold">
            <ShoppingCart size={18} />
            {cart.reduce((n, l) => n + l.quantity, 0)} · {money(total)}
          </span>
          <span className="font-bold">Ver carrito ›</span>
        </button>
      )}

      {/* Toast inferior (escáner / cobro), estilo del prototipo. */}
      {toast && (
        <div className="no-print fixed inset-x-4 bottom-24 z-[60] mx-auto flex max-w-sm items-center gap-2.5 rounded-theme bg-fg px-4 py-3 text-sm font-semibold text-white shadow-lg md:bottom-6">
          {toast.ok ? (
            <Check size={16} className="text-emerald-400" />
          ) : (
            <CloudOff size={16} className="text-amber-400" />
          )}
          {toast.text}
        </div>
      )}
    </div>
  );
}

/** Alta rápida de cliente desde el POS (para adjuntarlo a la venta / fiado). */
function NewCustomerModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const create = useMutation({
    mutationFn: () => api.post<Customer>('/customers', { name: name.trim(), phone: phone.trim() || null }),
    onSuccess: (cust) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      onCreated(cust.id);
    },
  });
  return (
    <Modal open onClose={onClose} title="Nuevo cliente">
      <div className="flex flex-col gap-3">
        <label className="text-sm text-muted">Nombre</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <label className="text-sm text-muted">Teléfono (opcional)</label>
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Button disabled={name.trim().length < 1 || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </Modal>
  );
}
