import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { money } from '@/lib/format';
import type { DashboardData } from '@/lib/types';

function WidgetCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <h3 className="text-sm font-medium text-muted">{title}</h3>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// Tarjeta KPI calcada del prototipo: etiqueta 12px, valor 27px w800, delta 12px.
// El delta va verde cuando sube ('up'), rojo cuando baja ('down') y gris si es informativo.
function KpiCard({
  label,
  value,
  delta,
  tone = 'muted',
}: {
  label: string;
  value: string;
  delta?: ReactNode;
  tone?: 'up' | 'down' | 'muted';
}) {
  const deltaColor =
    tone === 'up' ? 'text-success' : tone === 'down' ? 'text-danger' : 'text-muted';
  return (
    <Card>
      <CardContent className="p-[18px]">
        <div className="text-xs font-semibold text-muted">{label}</div>
        <div className="mt-1.5 text-[27px] font-extrabold leading-none tracking-[-0.03em]">
          {value}
        </div>
        {delta != null && (
          <div className={`mt-1.5 text-xs font-semibold ${deltaColor}`}>{delta}</div>
        )}
      </CardContent>
    </Card>
  );
}

export function KpiToday({ data }: { data: DashboardData }) {
  // Delta real "vs ayer": total de hoy contra el de ayer (mismas cifras autoritativas del KPI).
  const today = Number(data.kpi.todayTotal);
  const yesterday = Number(data.kpi.yesterdayTotal);
  const pct = yesterday > 0 ? Math.round(((today - yesterday) / yesterday) * 100) : null;
  return (
    <KpiCard
      label="Ventas de hoy"
      value={money(data.kpi.todayTotal)}
      tone={pct == null ? 'muted' : pct >= 0 ? 'up' : 'down'}
      delta={
        pct == null ? `${data.kpi.todayCount} ventas` : `${pct >= 0 ? '+' : ''}${pct}% vs ayer`
      }
    />
  );
}

export function MonthTotal({ data }: { data: DashboardData }) {
  const total = data.byLocation.reduce((a, l) => a + Number(l.total), 0);
  const count = data.byLocation.reduce((a, l) => a + l.count, 0);
  return (
    <KpiCard
      label="Ventas del mes"
      value={money(total)}
      delta={`${count} venta${count === 1 ? '' : 's'}`}
    />
  );
}

export function AvgTicket({ data }: { data: DashboardData }) {
  return (
    <KpiCard
      label="Ticket promedio (mes)"
      value={money(data.kpi.avgTicket)}
      delta={`${data.kpi.todayCount} ventas hoy`}
    />
  );
}

export function Projection({ data }: { data: DashboardData }) {
  const p = data.projection;
  return (
    <KpiCard
      label="Proyección próximo mes"
      value={money(p.nextMonth)}
      delta={`Rango ${money(p.low)} – ${money(p.high)}`}
    />
  );
}

/**
 * Tendencia de 30 días, con los 30 anteriores detrás para comparar.
 *
 * Una línea sola sube y baja pero no dice si eso es bueno: hay que recordar cómo fue el
 * mes pasado. Con la serie anterior en gris punteado, la respuesta está en el mismo
 * gráfico. Se alinean por POSICIÓN (día 1 con día 1, no por fecha), que es como se
 * compara un periodo con el anterior.
 */
export function Trend30({ data }: { data: DashboardData }) {
  const prev = data.trendPrev ?? [];
  const chart = data.trend.map((t, i) => ({
    ...t,
    label: t.date.slice(5),
    anterior: prev[i]?.total ?? null,
  }));
  const hayComparativa = prev.length > 0;

  return (
    <WidgetCard title="Tendencia 30 días">
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={chart} margin={{ left: -20, right: 8, top: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={5} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip formatter={(v: number) => money(v)} />
          {/* El periodo anterior va primero para que quede DEBAJO: es el telón de
              fondo, no el dato que se viene a mirar. */}
          {hayComparativa && (
            <Line
              type="monotone"
              dataKey="anterior"
              name="30 días antes"
              stroke="var(--color-secondary)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              connectNulls
            />
          )}
          <Line
            type="monotone"
            dataKey="total"
            name="Estos 30 días"
            stroke="var(--color-primary)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
      {hayComparativa && (
        <div className="mt-1 flex items-center justify-end gap-4 text-[11px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-[2px] w-4 bg-primary" /> Estos 30 días
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-[2px] w-4"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(90deg, var(--color-secondary) 0 4px, transparent 4px 7px)',
              }}
            />
            30 días antes
          </span>
        </div>
      )}
    </WidgetCard>
  );
}

export function SalesByLocation({ data }: { data: DashboardData }) {
  const chart = data.byLocation.map((l) => ({ name: l.name, total: Number(l.total) }));
  return (
    <WidgetCard title="Ventas por ubicación (mes)">
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={chart} margin={{ left: -20, right: 8, top: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip formatter={(v: number) => money(v)} />
          {/* La que más vende va en el primario y el resto en el acento: con todas del
              mismo color hay que leer el eje para saber cuál gana. Vienen ordenadas por
              total de mayor a menor desde el API, así que la primera ES la mayor. */}
          <Bar dataKey="total" radius={[4, 4, 0, 0]}>
            {chart.map((l, i) => (
              <Cell
                key={l.name}
                fill={i === 0 ? 'var(--color-primary)' : 'var(--color-secondary)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </WidgetCard>
  );
}

export function TopProducts({ data }: { data: DashboardData }) {
  return (
    <WidgetCard title="Top 10 productos (mes)">
      <ul className="flex flex-col gap-1 text-sm">
        {data.topProducts.map((p, i) => (
          <li key={p.name} className="flex justify-between gap-2">
            <span className="truncate">
              {i + 1}. {p.name}
            </span>
            <span className="shrink-0 font-medium">{p.qty} u.</span>
          </li>
        ))}
        {data.topProducts.length === 0 && <li className="text-muted">Sin datos</li>}
      </ul>
    </WidgetCard>
  );
}

export function SalesBySeller({ data }: { data: DashboardData }) {
  return (
    <WidgetCard title="Ventas por vendedor (mes)">
      <ul className="flex flex-col gap-1 text-sm">
        {data.bySeller.map((s) => (
          <li key={s.name} className="flex justify-between gap-2">
            <span className="truncate">{s.name}</span>
            <span className="shrink-0 font-medium">{money(s.total)}</span>
          </li>
        ))}
        {data.bySeller.length === 0 && <li className="text-muted">Sin datos</li>}
      </ul>
    </WidgetCard>
  );
}

export function LowStock({ data }: { data: DashboardData }) {
  return (
    <WidgetCard title="Productos con stock bajo">
      <ul className="flex flex-col gap-1 text-sm">
        {data.lowStock.map((s, i) => (
          <li key={i} className="flex justify-between gap-2">
            <span className="truncate">
              {s.name} <span className="text-muted">({s.location})</span>
            </span>
            <span className="shrink-0 font-medium text-red-600">{s.quantity}</span>
          </li>
        ))}
        {data.lowStock.length === 0 && <li className="text-muted">Todo con stock suficiente ✓</li>}
      </ul>
    </WidgetCard>
  );
}
