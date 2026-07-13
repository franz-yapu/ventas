import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
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
  const deltaColor = tone === 'up' ? 'text-success' : tone === 'down' ? 'text-danger' : 'text-muted';
  return (
    <Card>
      <CardContent className="p-[18px]">
        <div className="text-xs font-semibold text-muted">{label}</div>
        <div className="mt-1.5 text-[27px] font-extrabold leading-none tracking-[-0.03em]">{value}</div>
        {delta != null && <div className={`mt-1.5 text-xs font-semibold ${deltaColor}`}>{delta}</div>}
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
      delta={pct == null ? `${data.kpi.todayCount} ventas` : `${pct >= 0 ? '+' : ''}${pct}% vs ayer`}
    />
  );
}

export function MonthTotal({ data }: { data: DashboardData }) {
  const total = data.byLocation.reduce((a, l) => a + Number(l.total), 0);
  const count = data.byLocation.reduce((a, l) => a + l.count, 0);
  return <KpiCard label="Ventas del mes" value={money(total)} delta={`${count} venta${count === 1 ? '' : 's'}`} />;
}

export function AvgTicket({ data }: { data: DashboardData }) {
  return <KpiCard label="Ticket promedio (mes)" value={money(data.kpi.avgTicket)} delta={`${data.kpi.todayCount} ventas hoy`} />;
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

export function Trend30({ data }: { data: DashboardData }) {
  const chart = data.trend.map((t) => ({ ...t, label: t.date.slice(5) }));
  return (
    <WidgetCard title="Tendencia 30 días">
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={chart} margin={{ left: -20, right: 8, top: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={5} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip formatter={(v: number) => money(v)} />
          <Line type="monotone" dataKey="total" stroke="var(--color-primary)" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
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
          <Bar dataKey="total" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
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
