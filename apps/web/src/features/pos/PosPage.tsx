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
import { findByBarcode, findByCode, searchCatalog, syncCatalog } from '@/offline/catalog';
import { enqueueSale, syncPending } from '@/offline/sync';
import { motivoParaConfirmar } from '@/features/pos/confirmar';
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
  /** Motivo por el que se pide confirmación antes de cobrar; null = cobra directo. */
  const [confirmar, setConfirmar] = useState<string | null>(null);
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

  // Compradores (a quién se le vendió): sólo con conexión.
  const { data: customers } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get<Customer[]>('/customers'),
    enabled: navigator.onLine,
  });

  /**
   * Dónde se registra la venta: siempre la ubicación del usuario.
   *
   * Antes el carrito traía un desplegable para que un admin eligiera otra sucursal. El
   * API ya no lo acepta, y con razón: una venta cobrada aquí que se anota en Norte deja
   * a la caja de Norte esperando un dinero que nadie le entregó, y al cerrar el turno el
   * cajero de allá arrastra un faltante que no cometió.
   *
   * Se conserva la caída a `locations[0]` para el caso raro del usuario sin ubicación:
   * el API lo rechaza igual, pero así la pantalla no se queda sin nada que enviar.
   */
  const activeLocation = user?.locationId || locations[0]?.id || '';

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
  /**
   * Tope de descuento del vendedor. El administrador no tiene: se supone que es su
   * mercadería. Sin esto, cualquier cajero ponía un descuento igual al total y cobraba
   * Bs. 0 — y el servidor lo aceptaba.
   */
  const topePct = user?.role === 'seller' ? (business?.maxSellerDiscountPct ?? 0) : 100;
  const topeDescuento = (subtotal * topePct) / 100;
  const pedido = online ? Math.max(0, Number(discount) || 0) : 0;
  const discountNum = Math.min(pedido, subtotal, topeDescuento);
  const descuentoRecortado = pedido > topeDescuento + 0.005;
  const total = subtotal - discountNum;

  function addToCart(p: Product) {
    setCart((c) => {
      const found = c.find((l) => l.product.id === p.id);
      if (found)
        return c.map((l) => (l.product.id === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...c, { product: p, quantity: 1 }];
    });
  }
  function setQty(id: string, delta: number) {
    setCart((c) =>
      c
        .map((l) => (l.product.id === id ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );
  }

  /**
   * Enter en el buscador: agrega el producto, que es lo que necesita un escáner.
   *
   * Este campo YA buscaba por código de barras (ver `searchCatalog`), pero no lo decía y,
   * sobre todo, no hacía nada al pulsar Enter. Un lector de códigos USB —el que hay en la
   * mayoría de los mostradores— se comporta como un teclado: escribe el código de golpe y
   * pulsa Enter. Sin manejarlo, escanear llenaba el buscador y ahí se quedaba: había que
   * soltar la pistola y tocar la tarjeta con el dedo, que es justo lo que se compró el
   * lector para no hacer. El botón de la cámara (`ScanLine`) cubría el otro caso, el del
   * teléfono, y por eso el hueco pasó desapercibido.
   *
   * Se agrega cuando NO hay ambigüedad: un código de barras o un SKU identifican a uno
   * solo. Si el texto da varios resultados —"llanta"— no se elige por él; se deja la
   * lista, que es lo que quería quien estaba escribiendo.
   */
  async function alPulsarEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    const texto = search.trim();
    if (!texto) return;

    /*
      Se consulta la BASE, no la lista pintada.

      `products` viene de `useLiveQuery`, que mientras la consulta nueva corre sigue
      devolviendo el resultado de la ANTERIOR. Un lector USB teclea el código de golpe y
      pulsa Enter en el mismo instante, así que la lista todavía no se ha enterado: el
      primer escaneo de cada producto no agregaba nada y había que volver a pasar la
      pistola. Con las prisas del mostrador, eso es peor que no tener la función.
    */
    const exacto = await findByCode(texto);
    if (exacto) {
      addToCart(exacto);
      showToast(`Agregado: ${exacto.name}`);
      // Se vacía para que el siguiente escaneo entre limpio, sin borrar a mano.
      setSearch('');
      return;
    }

    // Sin coincidencia exacta esto no fue un escaneo sino alguien escribiendo, y ahí la
    // lista pintada sí es lo que esa persona está mirando.
    const lista = products ?? [];
    if (lista.length === 1) {
      addToCart(lista[0]!);
      showToast(`Agregado: ${lista[0]!.name}`);
      setSearch('');
      return;
    }
    showToast(lista.length === 0 ? `Sin producto para "${texto}"` : 'Hay varios: elige uno', false);
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
    // Sellada con quién la cobró: la cola sobrevive al cierre de sesión, y sin esto se
    // subía con el token del siguiente que entrara, quedando a su nombre.
    await enqueueSale(input, user ? { userId: user.sub, businessId: user.businessId } : undefined);
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
        if (r.synced > 0) {
          detail = await api.get<SaleDetail>(`/sales/${id}`);
          // El catálogo local guarda el stock, y el POS lo pinta como "Disp. N". Sin
          // refrescarlo, el cajero seguía viendo el stock de ANTES de su propia venta:
          // un número falso justo donde mira para saber si le queda mercadería.
          // `products` es una useLiveQuery de Dexie: al actualizar el catálogo local,
          // la cuadrícula se repinta sola.
          await syncCatalog().catch(() => undefined);
        }
      } catch {
        /* queda pendiente en la cola */
      }
    }

    setReceipt(detail);
    showToast(
      detail.receiptNumber
        ? `Venta #${detail.receiptNumber} registrada`
        : 'Venta guardada · se sincroniza luego',
    );
    setCart([]);
    setDiscount('0');
    setCustomerId('');
    setMobileCartOpen(false);
    setBusy(false);
  }

  const canCheckout = cart.length > 0 && !!activeLocation && !busy;

  /**
   * La regla de cuándo se pregunta vive en `confirmar.ts`, fuera del componente.
   *
   * Es una decisión de producto, no un detalle de esta pantalla, y aquí dentro no se podía
   * probar: quedaba atrapada en una clausura que lee media docena de estados. El test que
   * se le escribió acabó probando una COPIA de la lógica —cero líneas del código real—,
   * que es la peor clase de test porque da confianza sin dar nada.
   */
  /** Lo que pulsa el botón: confirma si toca, y si no cobra directo. */
  function alPulsarCobrar() {
    const motivo = motivoParaConfirmar({ total, descuento: discountNum });
    if (motivo) setConfirmar(motivo);
    else void checkout();
  }
  const methods = PAYMENT_METHODS;
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
              placeholder="Nombre, SKU o código de barras — o escanea"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => void alPulsarEnter(e)}
              autoFocus
            />
          </div>
          <Button
            variant="outline"
            size="lg"
            className="h-12 px-3"
            onClick={() => setScanOpen(true)}
            title="Escanear código"
          >
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
            // Del token, no del hexadecimal: en oscuro estos tres se aclaran para
            // seguir leyéndose como agotado / poco / disponible.
            const dot = out
              ? 'var(--color-danger)'
              : low
                ? 'var(--color-warning)'
                : 'var(--color-success)';
            /*
              Sin existencias se puede vender igual, y se avisa.

              Antes el botón se deshabilitaba. Suena prudente y en el mostrador es peor:
              una llantería que acaba de recibir mercadería sin registrarla se queda sin
              poder cobrar, con el cliente delante — y lo que pasa entonces es que se
              cobra por fuera y la venta no se registra en ninguna parte. Vale más una
              existencia en rojo que una venta invisible.

              Cuando ya está en negativo se dice cuánto falta, en vez de repetir
              "Agotado": el número es lo que le dice al dueño cuánto tiene que ajustar.
            */
            const stockLabel =
              remaining != null && remaining < 0
                ? `Faltan ${Math.abs(remaining)}`
                : out
                  ? 'Sin stock'
                  : low
                    ? `Bajo · ${remaining}`
                    : `Disp. ${remaining}`;
            const cardBorder = out
              ? 'border-danger/40'
              : low
                ? 'border-warning/40'
                : 'border-border hover:border-primary';
            return (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                className={`flex min-h-[112px] flex-col gap-2 rounded-theme border bg-surface p-3.5 text-left shadow-card transition hover:shadow-card-hover active:scale-[0.98] ${cardBorder}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-[10px] font-medium text-muted">{p.sku}</span>
                  {remaining != null && (
                    <span
                      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[10px] font-bold ${textCol}`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
                      {stockLabel}
                    </span>
                  )}
                </div>
                <span className="line-clamp-2 text-[15px] font-semibold leading-tight">
                  {p.name}
                </span>
                {/*
                  La descripción, cuando la hay.

                  Ya estaba en la base y en la respuesta del catálogo; sólo no se enseñaba.
                  Es lo que resuelve la pregunta del mostrador cuando dos productos se
                  llaman casi igual —"Llanta 175/70R13" contra "Llanta 175/70R13 reforzada"—
                  y quien atiende no es quien compró la mercadería. Una línea, recortada:
                  la tarjeta tiene que seguir siendo una diana grande para el dedo.
                */}
                {p.description ? (
                  <span className="line-clamp-1 flex-1 text-[12px] leading-tight text-muted">
                    {p.description}
                  </span>
                ) : (
                  <span className="flex-1" />
                )}
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
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileCartOpen(false)}
        />
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
            <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary-soft px-1.5 text-xs font-bold text-primary">
              {cart.reduce((n, l) => n + l.quantity, 0)}
            </span>
          )}
          <div className="flex-1" />
          {cart.length > 0 && (
            <button onClick={() => setCart([])} className="text-sm text-muted hover:text-fg">
              Vaciar
            </button>
          )}
          <button
            onClick={() => setMobileCartOpen(false)}
            className="text-muted md:hidden"
            title="Cerrar"
          >
            <X size={18} />
          </button>
        </div>
        <CardContent className="flex max-h-[70vh] flex-col gap-3 pt-4">
          <div className="flex-1 overflow-y-auto">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted">
                <ShoppingCart size={28} className="opacity-40" />
                <span className="font-semibold">Carrito vacío</span>
                <span className="text-sm">Toca un producto para agregarlo.</span>
              </div>
            ) : (
              cart.map((l) => (
                <div
                  key={l.product.id}
                  className="flex items-center gap-3 border-b border-border/70 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{l.product.name}</div>
                    <div className="text-xs text-muted">{money(l.product.price)} c/u</div>
                  </div>
                  <div className="flex items-center overflow-hidden rounded-[11px] border border-border">
                    <button
                      onClick={() => setQty(l.product.id, -1)}
                      className="flex h-9 w-9 items-center justify-center bg-bg text-fg hover:bg-muted/10"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="w-7 text-center text-sm font-semibold">{l.quantity}</span>
                    <button
                      onClick={() => setQty(l.product.id, 1)}
                      className="flex h-9 w-9 items-center justify-center bg-bg text-fg hover:bg-muted/10"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  <span className="min-w-[64px] text-right text-sm font-bold">
                    {money((Number(l.product.price) * l.quantity).toFixed(2))}
                  </span>
                  <button
                    onClick={() => setQty(l.product.id, -l.quantity)}
                    className="text-danger"
                    title="Eliminar"
                  >
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
                      active
                        ? 'border-primary-line bg-primary-soft text-primary'
                        : 'border-border bg-surface text-muted hover:bg-fg/[0.06]'
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
              <Select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="flex-1"
              >
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

          {descuentoRecortado && (
            <p className="text-[12px] text-warning">
              Como vendedor puedes descontar hasta el {topePct}% ({money(topeDescuento)}). Para más,
              pide a un administrador.
            </p>
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

          <Button
            size="xl"
            className="h-14 w-full text-base"
            disabled={!canCheckout}
            onClick={alPulsarCobrar}
          >
            {busy ? 'Cobrando…' : `Cobrar · ${money(total)}`}
          </Button>
        </CardContent>
      </Card>

      {/*
        Sólo aparece cuando la venta se sale de lo normal (ver `motivoParaConfirmar`).
        El botón que confirma repite el total: si alguien llegó aquí por un roce, lo que
        tiene que leer es cuánto va a cobrar, no la palabra "aceptar".
      */}
      {confirmar && (
        <Modal open onClose={() => setConfirmar(null)} title="Confirma la venta">
          <p className="text-[15px] leading-[1.6]">{confirmar}</p>
          <div className="mt-5 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmar(null)}>
              Volver
            </Button>
            <Button
              className="flex-1"
              onClick={() => {
                setConfirmar(null);
                void checkout();
              }}
            >
              Cobrar {money(total)}
            </Button>
          </div>
        </Modal>
      )}

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
        <div className="no-print fixed inset-x-4 bottom-24 z-[60] mx-auto flex max-w-sm items-center gap-2.5 rounded-theme bg-fg px-4 py-3 text-sm font-semibold text-bg shadow-lg md:bottom-6">
          {toast.ok ? (
            <Check size={16} className="text-success-inv" />
          ) : (
            <CloudOff size={16} className="text-warning-inv" />
          )}
          {toast.text}
        </div>
      )}
    </div>
  );
}

/** Alta rápida de comprador desde el POS, para adjuntarlo a la venta. */
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
    mutationFn: () =>
      api.post<Customer>('/customers', { name: name.trim(), phone: phone.trim() || null }),
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
        <Button
          disabled={name.trim().length < 1 || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </Modal>
  );
}
