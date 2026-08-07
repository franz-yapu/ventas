import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Page, PageHeader, SkeletonTiles } from '@/components/ui/page';
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
import { currentWeek, money } from '@/lib/format';
import type { DashboardData, ReportSummary } from '@/lib/types';

export function ReportsPage() {
  // Por defecto, la semana actual (lunes a domingo).
  const [from, setFrom] = useState(() => currentWeek().from);
  const [to, setTo] = useState(() => currentWeek().to);
  const showRange = !!(from && to);

  const params = new URLSearchParams();
  if (showRange) {
    params.set('from', new Date(`${from}T00:00:00`).toISOString());
    params.set('to', new Date(`${to}T23:59:59.999`).toISOString());
  }

  // Datos visuales (tendencia, por sucursal, top productos…) — mismo endpoint que el Panel.
  const { data: dash, isLoading: cargandoDash } = useQuery({
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
    <Page>
      <PageHeader
        titulo="Reportes"
        descripcion="Ventas y ganancia por sucursal. La ganancia usa el costo que tenía el producto el día de la venta."
      />

      {/*
        Filtro de rango de fechas. Cada etiqueta va PEGADA a su campo, en su propio grupo.

        El contenedor tiene `flex-wrap` para que los filtros bajen de línea en un teléfono,
        y sin agrupar cada pareja el salto caía donde tocara: "Hasta" quedaba solo al final
        de una línea y su campo empezaba la siguiente. Una etiqueta huérfana no etiqueta
        nada — quien mira tiene que adivinar cuál de los dos calendarios es.

        El `<label>` envuelve al campo, así que además quedan asociados de verdad: tocar la
        palabra enfoca el campo, que en un móvil es una diana mucho más grande.
      */}
      <div className="flex flex-wrap items-center gap-2">
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

      {/* KPIs. Mientras cargan, esqueletos del mismo alto: así la página no da el
          salto que hace pulsar el botón equivocado. */}
      {cargandoDash ? (
        <SkeletonTiles n={4} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {dash && <KpiToday data={dash} />}
          {dash && <MonthTotal data={dash} />}
          {dash && <AvgTicket data={dash} />}
          {dash && <Projection data={dash} />}
        </div>
      )}

      {/* Tarjeta destacada del rango elegido */}
      {showRange && (
        <Card className="border-primary">
          <CardHeader>
            <span className="text-sm text-muted">
              En el rango seleccionado ({data?.rangeCount ?? 0} ventas)
            </span>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-x-8 gap-y-1">
            <div>
              <div className="text-sm text-muted">Vendido</div>
              <div className="text-3xl font-bold">{money(data?.totals.range ?? '0')}</div>
            </div>
            <div>
              <div className="text-sm text-muted">Ganancia</div>
              <div className="text-3xl font-bold text-success">
                {money(data?.profit.range ?? '0')}
              </div>
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
        <CardContent className="hidden overflow-x-auto p-0 md:block">
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
                  <td className="p-3 text-right text-success">{money(l.profitToday)}</td>
                  <td className="p-3 text-right">{l.todayCount}</td>
                  <td className="p-3 text-right">{money(l.month)}</td>
                  <td className="p-3 text-right text-success">{money(l.profitMonth)}</td>
                  {showRange && <td className="p-3 text-right">{money(l.rangeTotal)}</td>}
                  {showRange && (
                    <td className="p-3 text-right text-success">{money(l.rangeProfit)}</td>
                  )}
                  {showRange && <td className="p-3 text-right">{l.rangeCount}</td>}
                </tr>
              ))}
            </tbody>
            {data && data.byLocation.length > 0 && (
              <tfoot className="border-t-2 border-border font-semibold">
                <tr>
                  <td className="p-3">Suma</td>
                  <td className="p-3 text-right">{money(data.totals.today)}</td>
                  <td className="p-3 text-right text-success">{money(data.profit.today)}</td>
                  <td className="p-3 text-right">{totalTodayCount}</td>
                  <td className="p-3 text-right">{money(data.totals.month)}</td>
                  <td className="p-3 text-right text-success">{money(data.profit.month)}</td>
                  {showRange && <td className="p-3 text-right">{money(data.totals.range)}</td>}
                  {showRange && (
                    <td className="p-3 text-right text-success">{money(data.profit.range)}</td>
                  )}
                  {showRange && <td className="p-3 text-right">{data.rangeCount}</td>}
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>

        {/* Móvil: tarjetas apiladas con rejilla de cifras en vez de tabla ancha. */}
        <div className="flex flex-col gap-2.5 p-3 md:hidden">
          {data?.byLocation.map((l) => (
            <div
              key={l.locationId}
              className="rounded-[14px] border border-border bg-surface p-[15px] shadow-card"
            >
              <div className="mb-2 text-[14px] font-semibold">{l.locationName}</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <Stat label="Vendido hoy" value={money(l.today)} />
                <Stat label="Ganancia hoy" value={money(l.profitToday)} green />
                <Stat label="# Hoy" value={String(l.todayCount)} />
                <Stat label="Vendido mes" value={money(l.month)} />
                <Stat label="Ganancia mes" value={money(l.profitMonth)} green />
                {showRange && <Stat label="Vendido (rango)" value={money(l.rangeTotal)} />}
                {showRange && <Stat label="Ganancia (rango)" value={money(l.rangeProfit)} green />}
                {showRange && <Stat label="# (rango)" value={String(l.rangeCount)} />}
              </div>
            </div>
          ))}
          {data && data.byLocation.length > 0 && (
            <div className="rounded-[14px] border-2 border-border bg-surface p-[15px] shadow-card">
              <div className="mb-2 text-[14px] font-semibold">Suma</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <Stat label="Vendido hoy" value={money(data.totals.today)} />
                <Stat label="Ganancia hoy" value={money(data.profit.today)} green />
                <Stat label="# Hoy" value={String(totalTodayCount)} />
                <Stat label="Vendido mes" value={money(data.totals.month)} />
                <Stat label="Ganancia mes" value={money(data.profit.month)} green />
                {showRange && <Stat label="Vendido (rango)" value={money(data.totals.range)} />}
                {showRange && (
                  <Stat label="Ganancia (rango)" value={money(data.profit.range)} green />
                )}
                {showRange && <Stat label="# (rango)" value={String(data.rangeCount)} />}
              </div>
            </div>
          )}
        </div>
      </Card>
    </Page>
  );
}

// Cifra etiquetada para las tarjetas de reporte en móvil.
function Stat({ label, value, green }: { label: string; value: string; green?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`text-[15px] font-semibold ${green ? 'text-success' : ''}`}>{value}</div>
    </div>
  );
}
