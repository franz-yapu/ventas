import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { PAYMENT_METHODS } from '@ventafacil/shared';
import { Check, CloudOff, Minus, Plus, Printer, ScanLine, Search, Trash2, UserPlus } from 'lucide-react';
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
    setBusy(false);
  }

  const canCheckout = cart.length > 0 && !!activeLocation && !busy;
  // Sin fiado: el método 'credit' no se ofrece nunca.
  const methods = PAYMENT_METHODS.filter((m) => m !== 'credit');

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
            const stockClass = out
              ? 'bg-red-500/15 text-red-600 dark:text-red-400'
              : low
                ? 'bg-amber-500/20 text-amber-700 dark:text-amber-400'
                : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400';
            const cardBorder = out
              ? 'border-red-500/50'
              : low
                ? 'border-amber-500/50'
                : 'border-border hover:border-primary';
            return (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                disabled={out}
                className={`flex flex-col rounded-theme border bg-surface p-3 text-left transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${cardBorder}`}
              >
                <span className="line-clamp-2 min-h-[2.5rem] text-sm font-medium">{p.name}</span>
                <span className="mt-1 text-xs text-muted">{p.sku}</span>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="font-semibold text-primary">{money(p.price)}</span>
                  {remaining != null && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${stockClass}`}>
                      {out ? 'Agotado' : `${remaining} u.`}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          {products && products.length === 0 && (
            <p className="col-span-full py-8 text-center text-muted">Sin resultados</p>
          )}
        </div>
      </div>

      <Card className="flex flex-col self-start">
        <CardContent className="flex max-h-[70vh] flex-col gap-3">
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
              <p className="py-8 text-center text-muted">Toca un producto para agregarlo</p>
            ) : (
              cart.map((l) => (
                <div key={l.product.id} className="flex items-center gap-2 border-b border-border py-2">
                  <div className="flex-1">
                    <div className="text-sm font-medium">{l.product.name}</div>
                    <div className="text-xs text-muted">{money(l.product.price)}</div>
                  </div>
                  <button onClick={() => setQty(l.product.id, -1)} className="rounded border border-border p-1">
                    <Minus size={14} />
                  </button>
                  <span className="w-6 text-center">{l.quantity}</span>
                  <button onClick={() => setQty(l.product.id, 1)} className="rounded border border-border p-1">
                    <Plus size={14} />
                  </button>
                  <button onClick={() => setQty(l.product.id, -l.quantity)} className="p-1 text-red-500">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
          </div>

          <Select value={payment} onChange={(e) => setPayment(e.target.value)}>
            {methods.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_LABELS[m]}
              </option>
            ))}
          </Select>

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
          <div className="flex items-center justify-between text-2xl font-bold">
            <span>Total</span>
            <span>{money(total)}</span>
          </div>

          <Button size="xl" className="w-full" disabled={!canCheckout} onClick={checkout}>
            {busy ? 'Cobrando…' : 'COBRAR'}
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
