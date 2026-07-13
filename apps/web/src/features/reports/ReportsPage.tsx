import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  AvgTicket,
  KpiToday,
  MonthTotal,
  Projection,
  SalesByLocation,
  SalesBySeller,
  TopProducts,
  Trend30,
} from '@/features/dashboard/widgets';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import type { DashboardData, ReportSummary } from '@/lib/types';

export function ReportsPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const showRange = !!(from && to);

  const params = new URLSearchParams();
  if (showRange) {
    params.set('from', new Date(`${from}T00:00:00`).toISOString());
    params.set('to', new Date(`${to}T23:59:59.999`).toISOString());
  }

  // Datos visuales (tendencia, por sucursal, top productos…) — mismo endpoint que el Panel.
  const { data: dash } = useQuery({
    queryKey: ['report-dashboard'],
    queryFn: () => api.get<DashboardData>('/reports/dashboard'),
  });
  // Comparativo por ubicación + rango personalizado.
  const { data } = useQuery({
    queryKey: ['report-summary', from, to],
    queryFn: () => api.get<ReportSummary>(`/reports/summary?${params.toString()}`),
  });

  const totalTodayCount = data?.byLocation.reduce((a, l) => a + l.todayCount, 0) ?? 0;

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">Reportes</h1>

      {/* Filtro de rango de fechas */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-muted">Desde</label>
        <Input type="date" className="max-w-[10rem]" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        <label className="text-sm text-muted">Hasta</label>
        <Input type="date" className="max-w-[10rem]" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        {(from || to) && (
          <Button variant="ghost" className="h-9 px-2 text-sm" onClick={() => { setFrom(''); setTo(''); }}>
            Limpiar
          </Button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {dash && <KpiToday data={dash} />}
        {dash && <MonthTotal data={dash} />}
        {dash && <AvgTicket data={dash} />}
        {dash && <Projection data={dash} />}
      </div>

      {/* Tarjeta destacada del rango elegido */}
      {showRange && (
        <Card className="border-primary">
          <CardHeader>
            <span className="text-sm text-muted">En el rango seleccionado ({data?.rangeCount ?? 0} ventas)</span>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-x-8 gap-y-1">
            <div>
              <div className="text-sm text-muted">Vendido</div>
              <div className="text-3xl font-bold">{money(data?.totals.range ?? '0')}</div>
            </div>
            <div>
              <div className="text-sm text-muted">Ganancia</div>
              <div className="text-3xl font-bold text-green-600">{money(data?.profit.range ?? '0')}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Gráficos */}
      <div className="grid gap-3 lg:grid-cols-2">
        {dash && <Trend30 data={dash} />}
        {dash && <SalesByLocation data={dash} />}
      </div>

      {/* Listas */}
      <div className="grid gap-3 lg:grid-cols-2">
        {dash && <TopProducts data={dash} />}
        {dash && <SalesBySeller data={dash} />}
      </div>

      {/* Comparativo detallado por ubicación (con ganancia y rango) */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-medium">Comparativo por ubicación</h2>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="ds-table w-full">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                <th className="p-3">Ubicación</th>
                <th className="p-3 text-right">Vendido hoy</th>
                <th className="p-3 text-right">Ganancia hoy</th>
                <th className="p-3 text-right"># Hoy</th>
                <th className="p-3 text-right">Vendido mes</th>
                <th className="p-3 text-right">Ganancia mes</th>
                {showRange && <th className="p-3 text-right">Vendido (rango)</th>}
                {showRange && <th className="p-3 text-right">Ganancia (rango)</th>}
                {showRange && <th className="p-3 text-right"># (rango)</th>}
              </tr>
            </thead>
            <tbody>
              {data?.byLocation.map((l) => (
                <tr key={l.locationId} className="border-b border-border last:border-0">
                  <td className="p-3">{l.locationName}</td>
                  <td className="p-3 text-right">{money(l.today)}</td>
                  <td className="p-3 text-right text-green-600">{money(l.profitToday)}</td>
                  <td className="p-3 text-right">{l.todayCount}</td>
                  <td className="p-3 text-right">{money(l.month)}</td>
                  <td className="p-3 text-right text-green-600">{money(l.profitMonth)}</td>
                  {showRange && <td className="p-3 text-right">{money(l.rangeTotal)}</td>}
                  {showRange && <td className="p-3 text-right text-green-600">{money(l.rangeProfit)}</td>}
                  {showRange && <td className="p-3 text-right">{l.rangeCount}</td>}
                </tr>
              ))}
            </tbody>
            {data && data.byLocation.length > 0 && (
              <tfoot className="border-t-2 border-border font-semibold">
                <tr>
                  <td className="p-3">Suma</td>
                  <td className="p-3 text-right">{money(data.totals.today)}</td>
                  <td className="p-3 text-right text-green-600">{money(data.profit.today)}</td>
                  <td className="p-3 text-right">{totalTodayCount}</td>
                  <td className="p-3 text-right">{money(data.totals.month)}</td>
                  <td className="p-3 text-right text-green-600">{money(data.profit.month)}</td>
                  {showRange && <td className="p-3 text-right">{money(data.totals.range)}</td>}
                  {showRange && <td className="p-3 text-right text-green-600">{money(data.profit.range)}</td>}
                  {showRange && <td className="p-3 text-right">{data.rangeCount}</td>}
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
