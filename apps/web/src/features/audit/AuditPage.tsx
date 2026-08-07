import { useQuery } from '@tanstack/react-query';
import { Eye, History } from 'lucide-react';
import { useState } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Exportar } from '@/components/Exportar';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { currentWeek, dateTime } from '@/lib/format';
import type { AppUserRow, AuditRow } from '@/lib/types';
import { useInfiniteList } from '@/lib/useInfinite';
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS } from '@ventafacil/shared';
import { EmptyState, Page, PageHeader, SkeletonRows } from '@/components/ui/page';

/*
  Los rótulos vienen de `@ventafacil/shared`, no de aquí.

  Estaban escritos en esta pantalla y se habían quedado en 8 de las 21 acciones que emite
  el servidor: `transfer`, `open`, `close`, `stock_adjust` y nueve más salían crudas, en
  la única pantalla que tiene un dueño para vigilar a su gente. Ahora la lista es una y
  está tipada: añadir una acción sin nombre en español no compila.
*/
const ACTION_LABELS: Record<string, string> = AUDIT_ACTION_LABELS;
const ENTITY_LABELS: Record<string, string> = AUDIT_ENTITY_LABELS;
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
  // Por defecto, la semana actual (lunes a domingo).
  const [from, setFrom] = useState(() => currentWeek().from);
  const [to, setTo] = useState(() => currentWeek().to);
  const [detail, setDetail] = useState<AuditRow | null>(null);

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<AppUserRow[]>('/users'),
  });

  const params = new URLSearchParams();
  if (action) params.set('action', action);
  if (entity) params.set('entity', entity);
  if (userId) params.set('userId', userId);
  // Rango de fechas: 'from' desde el inicio del día; 'to' hasta el fin del día.
  if (from) params.set('from', new Date(`${from}T00:00:00`).toISOString());
  if (to) params.set('to', new Date(`${to}T23:59:59.999`).toISOString());

  const { items, total, hasNextPage, fetchNextPage, isFetchingNextPage, isLoading } =
    useInfiniteList<AuditRow>(
      ['audit', action, entity, userId, from, to],
      `/audit?${params.toString()}`,
    );

  return (
    <Page>
      <PageHeader
        titulo="Registro de actividad"
        descripcion="Quién cambió qué y cuándo. Se escribe solo y no se puede editar."
      acciones={<Exportar seccion="actividad" filtros={{ from, to }} />}
      />

      <div className="flex flex-wrap gap-2">
        <Select
          filter
          className="max-w-[12rem]"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        >
          <option value="">Toda acción</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select
          filter
          className="max-w-[12rem]"
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
        >
          <option value="">Toda entidad</option>
          {Object.entries(ENTITY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select
          filter
          className="max-w-[12rem]"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        >
          <option value="">Todo usuario</option>
          {users?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-1">
          <label className="flex shrink-0 items-center gap-2 text-sm text-muted">
            Desde
            <Input
              type="date"
              filter
              className="max-w-[10rem]"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="flex shrink-0 items-center gap-2 text-sm text-muted">
            Hasta
            <Input
              type="date"
              filter
              className="max-w-[10rem]"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
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
                      <button
                        onClick={() => setDetail(a)}
                        className="text-muted hover:text-primary"
                        title="Ver detalle"
                      >
                        <Eye size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {isLoading && <SkeletonRows filas={6} />}
          {!isLoading && items.length === 0 && (
            <EmptyState
              icono={History}
              titulo="Sin actividad en este filtro"
              descripcion="Prueba con otra acción o rango de fechas. Aquí sólo entra lo que cambia datos: ventas canceladas, precios, usuarios, configuración."
            />
          )}
        </CardContent>
      </Card>

      {/* Móvil: tarjetas apiladas en vez de tabla. */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {items.map((a) => (
          <div
            key={a.id}
            className="rounded-[14px] border border-border bg-surface p-[15px] shadow-card"
          >
            <div className="flex items-center justify-between gap-3">
              <Badge tone={ACTION_TONE[a.action] ?? 'neutral'}>
                {ACTION_LABELS[a.action] ?? a.action}
              </Badge>
              <span className="text-[12px] text-muted">{dateTime(a.createdAt)}</span>
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-3">
              <div className="text-[12px] leading-[1.5] text-muted">
                <span className="font-medium text-fg">{a.userName ?? '—'}</span> ·{' '}
                {ENTITY_LABELS[a.entity] ?? a.entity}
                <br />
                {a.locationName ?? '—'}
              </div>
              {(a.before || a.after) && (
                <button
                  onClick={() => setDetail(a)}
                  className="shrink-0 text-muted hover:text-primary"
                  title="Ver detalle"
                >
                  <Eye size={18} />
                </button>
              )}
            </div>
          </div>
        ))}
        {!isLoading && items.length === 0 && (
          <EmptyState
            icono={History}
            titulo="Sin actividad en este filtro"
            descripcion="Prueba con otra acción o rango de fechas."
          />
        )}
      </div>

      {hasNextPage && (
        <Button
          variant="outline"
          className="self-center"
          disabled={isFetchingNextPage}
          onClick={() => fetchNextPage()}
        >
          {isFetchingNextPage ? 'Cargando…' : `Cargar más (${items.length}/${total})`}
        </Button>
      )}

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title="Detalle del cambio"
        className="max-w-lg"
      >
        {detail && <Diff before={detail.before} after={detail.after} />}
      </Modal>
    </Page>
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
              <tr key={k} className={changed ? 'bg-warning-bg' : ''}>
                <td className="p-2 font-medium">{k}</td>
                <td className="p-2 text-muted">{b}</td>
                <td className={`p-2 ${changed ? 'font-semibold text-success' : ''}`}>{a}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
