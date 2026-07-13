import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Pencil, Plus, Search, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { useAuth } from '@/features/auth/AuthProvider';
import { HistoryModal } from '@/features/inventory/HistoryModal';
import { api, ApiError } from '@/lib/api';
import { money } from '@/lib/format';
import type { Location, Product } from '@/lib/types';
import { useInfiniteList } from '@/lib/useInfinite';
import { useBusiness } from '@/theme/ThemeProvider';

export function ProductsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const business = useBusiness();
  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState('');
  const [editing, setEditing] = useState<Product | null | 'new'>(null);
  const [history, setHistory] = useState<{ id: string; name: string } | null>(null);
  const isAdmin = user?.role === 'admin';
  const isCentral = !!user?.isCentral;

  // Sólo la central filtra por ubicación; la sucursal siempre ve la suya.
  const { data: locations } = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<Location[]>('/locations'),
    enabled: isCentral,
  });

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (locationId) params.set('locationId', locationId);
  const qs = params.toString();
  const { items, total, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteList<Product>(
    ['products', 'admin', search, locationId],
    `/products${qs ? `?${qs}` : ''}`,
  );
  const reload = () => qc.invalidateQueries({ queryKey: ['products'] });

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Productos</h1>
        {/* Sólo la central da de alta / importa productos y asigna su ubicación. */}
        {isCentral && (
          <div className="flex gap-2">
            <CsvImport schema={business?.productSchema ?? []} onDone={reload} />
            <Button onClick={() => setEditing('new')}>
              <Plus size={18} /> Nuevo
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
          <Input
            className="pl-10"
            placeholder="Buscar por nombre o SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {isCentral && (
          <Select className="max-w-xs" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Todas las ubicaciones</option>
            {locations?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="ds-table w-full">
            <thead className="text-left text-muted">
              <tr>
                <th className="p-3">SKU</th>
                <th className="p-3">Nombre</th>
                <th className="p-3">Ubicación</th>
                <th className="p-3 text-right">Precio</th>
                {isAdmin && <th className="p-3 text-right">Costo unit.</th>}
                {isAdmin && <th className="p-3 text-right">Ganancia</th>}
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="p-3 font-mono text-xs">{p.sku}</td>
                  <td className="p-3">{p.name}</td>
                  <td className="p-3 text-muted">{p.locationName ?? '—'}</td>
                  <td className="p-3 text-right font-medium">{money(p.price)}</td>
                  {isAdmin && <td className="p-3 text-right text-muted">{p.cost ? money(p.cost) : '—'}</td>}
                  {isAdmin && (
                    <td className="p-3 text-right">
                      {p.cost ? (
                        <span className="text-green-600">{money(Number(p.price) - Number(p.cost))}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                  )}
                  <td className="p-3">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setHistory({ id: p.id, name: p.name })} className="text-muted hover:text-primary" title="Historial">
                        <History size={16} />
                      </button>
                      {p.canManage && (
                        <button onClick={() => setEditing(p)} className="text-muted hover:text-primary" title="Editar">
                          <Pencil size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length === 0 && <p className="py-8 text-center text-muted">Sin productos</p>}
        </CardContent>
      </Card>

      {hasNextPage && (
        <Button variant="outline" className="self-center" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
          {isFetchingNextPage ? 'Cargando…' : `Cargar más (${items.length}/${total})`}
        </Button>
      )}

      {editing && (
        <ProductForm
          product={editing === 'new' ? null : editing}
          schema={business?.productSchema ?? []}
          locations={locations ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            reload();
            setEditing(null);
          }}
        />
      )}
      {history && <HistoryModal productId={history.id} title={`Historial · ${history.name}`} onClose={() => setHistory(null)} />}
    </div>
  );
}

// Importación CSV simple. Cabecera esperada: sku,name,price + columnas de atributos por rubro.
function CsvImport({
  schema,
  onDone,
}: {
  schema: Array<{ key: string; label: string; type: string; required?: boolean }>;
  onDone: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<string | null>(null);

  const attrKeys = schema.map((s) => s.key);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const header = lines[0]?.split(',').map((h) => h.trim().toLowerCase()) ?? [];
    const rows = lines.slice(1).map((line) => {
      const cols = line.split(',');
      const get = (name: string) => cols[header.indexOf(name)]?.trim() ?? '';
      const attributes: Record<string, string> = {};
      for (const k of attrKeys) if (header.includes(k)) attributes[k] = get(k);
      return { sku: get('sku'), name: get('name'), price: get('price') || '0', attributes };
    });
    try {
      const r = await api.post<{ created: number; skipped: number }>('/products/import', { rows });
      setResult(`Importados: ${r.created} · Omitidos: ${r.skipped}`);
      onDone();
    } catch {
      setResult('Error al importar');
    }
    if (ref.current) ref.current.value = '';
  }

  return (
    <>
      <input ref={ref} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
      <Button variant="outline" onClick={() => ref.current?.click()} title="sku,name,price + atributos">
        <Upload size={18} /> CSV
      </Button>
      {result && (
        <Modal open onClose={() => setResult(null)} title="Importación CSV">
          <p className="text-sm">{result}</p>
        </Modal>
      )}
    </>
  );
}

function ProductForm({
  product,
  schema,
  locations,
  onClose,
  onSaved,
}: {
  product: Product | null;
  schema: Array<{ key: string; label: string; type: string; required?: boolean }>;
  locations: Location[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !product;
  const [form, setForm] = useState({
    sku: product?.sku ?? '',
    name: product?.name ?? '',
    price: product?.price ?? '',
    cost: product?.cost ?? '',
    costWholesale: product?.costWholesale ?? '',
    attributes: (product?.attributes ?? {}) as Record<string, unknown>,
    // Sólo al crear: la central decide sucursal dueña y stock inicial.
    locationId: locations[0]?.id ?? '',
    initialStock: '',
    minStock: '',
  });
  const [error, setError] = useState<string | null>(null);

  const margin = Number(form.price || 0) - Number(form.cost || 0);
  const marginPct = Number(form.price) > 0 ? (margin / Number(form.price)) * 100 : 0;

  const save = useMutation({
    mutationFn: () => {
      const base = {
        sku: form.sku.trim() || undefined,
        name: form.name,
        price: form.price,
        cost: form.cost || null,
        costWholesale: form.costWholesale || null,
        attributes: form.attributes,
      };
      if (product) return api.patch(`/products/${product.id}`, base);
      return api.post('/products', {
        ...base,
        locationId: form.locationId || undefined,
        initialStock: form.initialStock ? Number(form.initialStock) : 0,
        minStock: form.minStock ? Number(form.minStock) : null,
      });
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Error al guardar'),
  });

  return (
    <Modal open onClose={onClose} title={product ? 'Editar producto' : 'Nuevo producto'}>
      <div className="flex flex-col gap-3">
        {isNew && (
          <>
            <label className="text-sm text-muted">Sucursal / Central</label>
            <Select value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.isCentral ? ' (Central)' : ''}
                </option>
              ))}
            </Select>
          </>
        )}
        <label className="text-sm text-muted">SKU {isNew && <span className="text-xs">(opcional · se genera solo)</span>}</label>
        <Input
          value={form.sku}
          placeholder={isNew ? 'Se genera automáticamente' : undefined}
          onChange={(e) => setForm({ ...form, sku: e.target.value })}
        />
        <label className="text-sm text-muted">Nombre</label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <label className="text-sm text-muted">Precio de venta</label>
        <Input
          inputMode="decimal"
          value={form.price}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
        />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-muted">Compra unitario</label>
            <Input
              inputMode="decimal"
              value={form.cost}
              onChange={(e) => setForm({ ...form, cost: e.target.value })}
            />
          </div>
          <div>
            <label className="text-sm text-muted">Compra por mayor</label>
            <Input
              inputMode="decimal"
              value={form.costWholesale}
              onChange={(e) => setForm({ ...form, costWholesale: e.target.value })}
            />
          </div>
        </div>
        {Number(form.cost) > 0 && (
          <div className="rounded-theme bg-muted/10 p-2 text-sm">
            Ganancia por unidad:{' '}
            <span className="font-semibold text-green-600">
              {money(margin)} ({marginPct.toFixed(0)}%)
            </span>
          </div>
        )}
        {schema.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <label className="text-sm text-muted">
              {f.label}
              {f.required ? ' *' : ''}
            </label>
            <Input
              value={String(form.attributes[f.key] ?? '')}
              onChange={(e) =>
                setForm({ ...form, attributes: { ...form.attributes, [f.key]: e.target.value } })
              }
            />
          </div>
        ))}
        {isNew && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted">Stock inicial</label>
              <Input
                inputMode="numeric"
                value={form.initialStock}
                onChange={(e) => setForm({ ...form, initialStock: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm text-muted">Stock mínimo</label>
              <Input
                inputMode="numeric"
                value={form.minStock}
                onChange={(e) => setForm({ ...form, minStock: e.target.value })}
              />
            </div>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          Guardar
        </Button>
      </div>
    </Modal>
  );
}
