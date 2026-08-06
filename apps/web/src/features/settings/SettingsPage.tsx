import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Page, PageHeader } from '@/components/ui/page';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { aplicarColorDeMarca, textoSobre } from '@/lib/color';
import { ModoSelector } from '@/theme/ModoSelector';
import type { BusinessConfig } from '@/theme/ThemeProvider';

// Tema por defecto = el del diseño (VentaFácil POS). "Restablecer" vuelve aquí.
const DESIGN_DEFAULTS = { primary: '#2f68d8', secondary: '#f59e0b', radius: '12px' };

/**
 * Presets rápidos: PAREJA de colores, no sólo el primario.
 *
 * Antes el preset cambiaba el primario y dejaba el secundario anterior, así que elegir
 * "Esmeralda" te dejaba un verde con el naranja de antes. El acento de cada pareja está
 * elegido para contrastar con su primario sin pelearse con él, que es exactamente el
 * trabajo que un preset debería ahorrarle a quien no quiere pensar en colores.
 */
const THEME_PRESETS = [
  { name: 'Azul', color: '#2f68d8', secondary: '#f59e0b' },
  { name: 'Esmeralda', color: '#27794c', secondary: '#d98324' },
  { name: 'Violeta', color: '#6d5ae0', secondary: '#e0a03a' },
  { name: 'Naranja', color: '#e0662f', secondary: '#2a7194' },
  { name: 'Rojo', color: '#c23b2f', secondary: '#377483' },
  { name: 'Grafito', color: '#3a3a42', secondary: '#c9992e' },
];

// "12px" | "0.5rem" -> número de px para el slider (rem*16).
function radiusToPx(r: string): number {
  const rem = r.trim().endsWith('rem');
  const n = parseFloat(r) || 0;
  return Math.round(rem ? n * 16 : n);
}

// Reduce la imagen a máx 256px y devuelve un data URI liviano (para el logo).
function fileToLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 256;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function SettingsPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data } = useQuery({
    queryKey: ['business', 'edit'],
    queryFn: () => api.get<BusinessConfig>('/business/me'),
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState({
    name: '',
    primary: DESIGN_DEFAULTS.primary,
    secondary: DESIGN_DEFAULTS.secondary,
    radius: DESIGN_DEFAULTS.radius,
    appName: '',
    receiptFooter: '',
    currency: 'BOB',
    taxRate: '0',
    maxSellerDiscountPct: 10,
    logoUrl: null as string | null,
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      name: data.name,
      primary: data.theme?.primary ?? DESIGN_DEFAULTS.primary,
      secondary: data.theme?.secondary ?? DESIGN_DEFAULTS.secondary,
      radius: data.theme?.radius ?? DESIGN_DEFAULTS.radius,
      appName: data.texts?.app_name ?? data.name,
      receiptFooter: data.texts?.receipt_footer ?? '',
      currency: data.currency,
      taxRate: String(Number(data.taxRate)), // "0.0000" -> "0"
      maxSellerDiscountPct: data.maxSellerDiscountPct ?? 10,
      logoUrl: data.logoUrl,
    });
  }, [data]);

  // Vista previa instantánea (como el diseño): aplica color/radio al vuelo mientras editas.
  // Pasa por el mismo helper que el ThemeProvider, así que el texto sobre cada color se
  // recalcula igual aquí que en el resto de la app: la vista previa no puede mentir.
  useEffect(() => {
    const root = document.documentElement.style;
    aplicarColorDeMarca('primary', form.primary);
    aplicarColorDeMarca('secondary', form.secondary);
    root.setProperty('--radius', form.radius);
  }, [form.primary, form.secondary, form.radius]);

  // Al salir sin guardar, restaura el tema realmente persistido del negocio.
  const savedTheme = data?.theme;
  useEffect(() => {
    return () => {
      const root = document.documentElement.style;
      aplicarColorDeMarca('primary', savedTheme?.primary ?? DESIGN_DEFAULTS.primary);
      aplicarColorDeMarca('secondary', savedTheme?.secondary ?? DESIGN_DEFAULTS.secondary);
      root.setProperty('--radius', savedTheme?.radius ?? DESIGN_DEFAULTS.radius);
    };
  }, [savedTheme]);

  const save = useMutation({
    mutationFn: () =>
      api.patch('/business', {
        name: form.name,
        logoUrl: form.logoUrl,
        theme: { primary: form.primary, secondary: form.secondary, radius: form.radius },
        texts: {
          ...(data?.texts ?? {}),
          app_name: form.appName,
          receipt_footer: form.receiptFooter,
        },
        currency: form.currency,
        taxRate: form.taxRate,
        maxSellerDiscountPct: Number(form.maxSellerDiscountPct) || 0,
      }),
    onSuccess: () => {
      // Refresca el negocio en toda la app -> ThemeProvider re-aplica colores/textos/logo.
      qc.invalidateQueries({ queryKey: ['business'] });
      setSaved(true);
      setError(null);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Error al guardar'),
  });

  async function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const logoUrl = await fileToLogo(file);
      setForm((f) => ({ ...f, logoUrl }));
    } catch {
      setError('No se pudo procesar la imagen');
    }
  }

  return (
    <Page className="mx-auto max-w-2xl">
      <PageHeader
        titulo="Configuración del negocio"
        descripcion="Identidad, colores y reglas de venta. El logo y los colores se ven también en el login de tu negocio."
      />

      <Card>
        <CardHeader>
          <h2 className="text-lg font-medium">Identidad</h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="text-sm text-muted">Nombre del negocio</label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <label className="text-sm text-muted">Nombre de la app (en recibos y cabecera)</label>
          <Input
            value={form.appName}
            onChange={(e) => setForm({ ...form, appName: e.target.value })}
          />

          <label className="text-sm text-muted">Logo</label>
          <div className="flex items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-theme border border-border bg-surface">
              {form.logoUrl ? (
                <img src={form.logoUrl} alt="logo" className="max-h-full max-w-full" />
              ) : (
                <span className="text-xs text-muted">sin logo</span>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onLogo}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              Subir logo
            </Button>
            {form.logoUrl && (
              <Button variant="ghost" onClick={() => setForm({ ...form, logoUrl: null })}>
                Quitar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <h2 className="text-lg font-medium">Colores y bordes</h2>
          <button
            type="button"
            onClick={() =>
              setForm((f) => ({
                ...f,
                primary: DESIGN_DEFAULTS.primary,
                secondary: DESIGN_DEFAULTS.secondary,
                radius: DESIGN_DEFAULTS.radius,
              }))
            }
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-fg"
            title="Volver al tema por defecto (VentaFácil POS)"
          >
            <RotateCcw size={15} /> Restablecer
          </button>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <p className="-mt-2 text-sm text-muted">Se aplica a toda la app al instante.</p>

          {/* Presets rápidos: cada uno fija primario y secundario a la vez. */}
          <div className="flex flex-wrap gap-2">
            {THEME_PRESETS.map((t) => {
              const active =
                form.primary.toLowerCase() === t.color.toLowerCase() &&
                form.secondary.toLowerCase() === t.secondary.toLowerCase();
              return (
                <button
                  key={t.color}
                  type="button"
                  onClick={() =>
                    setForm((f) => ({ ...f, primary: t.color, secondary: t.secondary }))
                  }
                  className={`inline-flex items-center gap-2 rounded-theme border px-3 py-2 text-sm font-semibold ${
                    active
                      ? 'border-primary bg-primary/10 text-fg'
                      : 'border-border bg-surface text-muted hover:bg-muted/10'
                  }`}
                >
                  {/* Los dos colores del preset, para verlos juntos antes de elegir. */}
                  <span
                    className="inline-block h-4 w-4 rounded-full border border-black/5"
                    style={{
                      background: `linear-gradient(135deg, ${t.color} 55%, ${t.secondary} 55%)`,
                    }}
                  />
                  {t.name}
                  {t.color === DESIGN_DEFAULTS.primary && (
                    <span className="text-[10px] text-muted">· def.</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-6">
            <ColorField
              label="Primario"
              value={form.primary}
              onChange={(v) => setForm({ ...form, primary: v })}
            />
            <ColorField
              label="Secundario"
              value={form.secondary}
              onChange={(v) => setForm({ ...form, secondary: v })}
            />
          </div>

          {/* Modo claro / oscuro. Va aquí, con el resto de la apariencia, pero NO se
              guarda con el negocio: es del dispositivo (ver theme/modo.ts). El control
              es compartido porque Mi perfil también lo ofrece: esta ruta es sólo del
              dueño, y la preferencia es de cada persona. */}
          <div className="border-t border-border pt-5">
            <ModoSelector />
          </div>

          {/* Radio de bordes. */}
          <div className="flex flex-col gap-2">
            <label className="text-sm text-muted">
              Radio de bordes · {radiusToPx(form.radius)}px
            </label>
            <input
              type="range"
              min={0}
              max={22}
              value={radiusToPx(form.radius)}
              onChange={(e) => setForm({ ...form, radius: `${e.target.value}px` })}
              className="w-56 accent-[var(--color-primary)]"
            />
          </div>

          <div className="flex items-end gap-2">
            <div
              className="h-10 rounded-theme px-4 text-sm font-medium leading-10"
              style={{ background: form.primary, color: textoSobre(form.primary) }}
            >
              Vista previa
            </div>
            <div
              className="h-10 rounded-theme px-4 text-sm font-medium leading-10"
              style={{ background: form.secondary, color: textoSobre(form.secondary) }}
            >
              Secundario
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-medium">Recibo y moneda</h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="text-sm text-muted">Pie del recibo</label>
          <Input
            value={form.receiptFooter}
            onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted">Moneda</label>
              <Input
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm text-muted">Tasa de impuesto (%)</label>
              <Input
                inputMode="decimal"
                value={form.taxRate}
                onChange={(e) => setForm({ ...form, taxRate: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm text-muted">Descuento máximo del vendedor (%)</label>
              <Input
                type="number"
                min="0"
                max="100"
                value={form.maxSellerDiscountPct}
                onChange={(e) => setForm({ ...form, maxSellerDiscountPct: Number(e.target.value) })}
              />
              <p className="mt-1 text-xs text-muted">
                Cuánto puede rebajar un vendedor sin permiso. En 0, sólo el administrador descuenta.
                Tú no tienes tope.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex items-center gap-3">
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Guardando…' : 'Guardar cambios'}
        </Button>
        {saved && <span className="text-sm text-success">✓ Guardado</span>}
      </div>
    </Page>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm text-muted">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-14 rounded border border-border"
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="w-28" />
      </div>
    </div>
  );
}
