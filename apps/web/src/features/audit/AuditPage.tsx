import { useQuery } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import { useState } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import type { AppUserRow, AuditRow } from '@/lib/types';
import { useInfiniteList } from '@/lib/useInfinite';

const ACTION_LABELS: Record<string, string> = {
  login: 'Inicio de sesión',
  create: 'Creación',
  update: 'Edición',
  price_change: 'Cambio de precio',
  delete: 'Eliminación',
  cancel: 'Cancelación',
  sale: 'Venta',
  import: 'Importación',
};
const ENTITY_LABELS: Record<string, string> = {
  app_user: 'Usuario',
  product: 'Producto',
  category: 'Categoría',
  location: 'Ubicación',
  sale: 'Venta',
};
// Tono del chip por tipo de acción (coincide con el prototipo).
const ACTION_TONE: Record<string, BadgeTone> = {
  create: 'success',
  sale: 'success',
  update: 'info',
  price_change: 'warning',
  stock_adjust: 'warning',
  transfer: 'info',
  import: 'info',
  cancel: 'danger',
  delete: 'danger',
  login: 'neutral',
  payment: 'success',
};

export function AuditPage() {
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detail, setDetail] = useState<AuditRow | null>(null);

  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => api.get<AppUserRow[]>('/users') });

  const params = new URLSearchParams();
  if (action) params.set('action', action);
  if (entity) params.set('entity', entity);
  if (userId) params.set('userId', userId);
  // Rango de fechas: 'from' desde el inicio del día; 'to' hasta el fin del día.
  if (from) params.set('from', new Date(`${from}T00:00:00`).toISOString());
  if (to) params.set('to', new Date(`${to}T23:59:59.999`).toISOString());

  const { items, total, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteList<AuditRow>(
    ['audit', action, entity, userId, from, to],
    `/audit?${params.toString()}`,
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">Registro de actividad</h1>

      <div className="flex flex-wrap gap-2">
        <Select filter className="max-w-[12rem]" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">Toda acción</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select filter className="max-w-[12rem]" value={entity} onChange={(e) => setEntity(e.target.value)}>
          <option value="">Toda entidad</option>
          {Object.entries(ENTITY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select filter className="max-w-[12rem]" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Todo usuario</option>
          {users?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-1">
          <label className="text-sm text-muted">Desde</label>
          <Input type="date" filter className="max-w-[10rem]" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          <label className="text-sm text-muted">Hasta</label>
          <Input type="date" filter className="max-w-[10rem]" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      <Card className="hidden md:block">
        <CardContent className="overflow-x-auto p-0">
          <table className="ds-table w-full">
            <thead className="text-left text-muted">
              <tr>
                <th className="p-3">Fecha</th>
                <th className="p-3">Usuario</th>
                <th className="p-3">Acción</th>
                <th className="p-3">Entidad</th>
                <th className="p-3">Ubicación</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0">
                  <td className="p-3 whitespace-nowrap text-muted">{dateTime(a.createdAt)}</td>
                  <td className="p-3 font-medium">{a.userName ?? '—'}</td>
                  <td className="p-3">
                    <Badge tone={ACTION_TONE[a.action] ?? 'neutral'}>
                      {ACTION_LABELS[a.action] ?? a.action}
                    </Badge>
                  </td>
                  <td className="p-3">{ENTITY_LABELS[a.entity] ?? a.entity}</td>
                  <td className="p-3 text-muted">{a.locationName ?? '—'}</td>
                  <td className="p-3 text-right">
                    {(a.before || a.after) && (
                      <button onClick={() => setDetail(a)} className="text-muted hover:text-primary" title="Ver detalle">
                        <Eye size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length === 0 && <p className="py-8 text-center text-muted">Sin actividad</p>}
        </CardContent>
      </Card>

      {/* Móvil: tarjetas apiladas en vez de tabla. */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {items.map((a) => (
          <div key={a.id} className="rounded-[14px] border border-border bg-surface p-[15px] shadow-card">
            <div className="flex items-center justify-between gap-3">
              <Badge tone={ACTION_TONE[a.action] ?? 'neutral'}>{ACTION_LABELS[a.action] ?? a.action}</Badge>
              <span className="text-[12px] text-muted">{dateTime(a.createdAt)}</span>
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-3">
              <div className="text-[12px] leading-[1.5] text-muted">
                <span className="font-medium text-fg">{a.userName ?? '—'}</span> · {ENTITY_LABELS[a.entity] ?? a.entity}
                <br />
                {a.locationName ?? '—'}
              </div>
              {(a.before || a.after) && (
                <button onClick={() => setDetail(a)} className="shrink-0 text-muted hover:text-primary" title="Ver detalle">
                  <Eye size={18} />
                </button>
              )}
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="py-8 text-center text-muted">Sin actividad</p>}
      </div>

      {hasNextPage && (
        <Button variant="outline" className="self-center" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
          {isFetchingNextPage ? 'Cargando…' : `Cargar más (${items.length}/${total})`}
        </Button>
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Detalle del cambio" className="max-w-lg">
        {detail && <Diff before={detail.before} after={detail.after} />}
      </Modal>
    </div>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// Diff before/after: une claves y resalta las que cambiaron.
function Diff({
  before,
  after,
}: {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}) {
  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]));
  if (keys.length === 0) return <p className="text-sm text-muted">Sin datos comparables.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-muted">
          <tr>
            <th className="p-2">Campo</th>
            <th className="p-2">Antes</th>
            <th className="p-2">Después</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const b = fmt(before?.[k]);
            const a = fmt(after?.[k]);
            const changed = b !== a;
            return (
              <tr key={k} className={changed ? 'bg-amber-50' : ''}>
                <td className="p-2 font-medium">{k}</td>
                <td className="p-2 text-muted">{b}</td>
                <td className={`p-2 ${changed ? 'font-semibold text-green-700' : ''}`}>{a}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
