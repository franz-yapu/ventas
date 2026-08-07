import { useQuery } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EmptyState, Page, PageHeader } from '@/components/ui/page';
import { api } from '@/lib/api';
import { money, etiquetaDePago } from '@/lib/format';
import { downloadCsv } from '@/lib/print';
import type { CashZ } from '@/lib/types';

export function CashZPage() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const { data } = useQuery({
    queryKey: ['cash-z', date],
    queryFn: () => api.get<CashZ>(`/reports/cash-z?date=${date}`),
  });

  function exportCsv() {
    if (!data) return;
    const rows: (string | number)[][] = [['Cierre de caja (lectura Z)', data.date]];
    rows.push([], ['Vendedor', 'Ubicación', 'Método de pago', 'Total', 'Ventas']);
    data.rows.forEach((r) =>
      rows.push([
        r.seller,
        r.location,
        etiquetaDePago(r.paymentMethod),
        r.total,
        r.count,
      ]),
    );
    rows.push([], ['TOTAL GENERAL', data.grandTotal]);
    downloadCsv(`cierre-caja-${data.date}.csv`, rows);
  }

  return (
    <Page>
      <PageHeader
        titulo="Cierre de caja (Z)"
        descripcion="Lo cobrado en el día, repartido por vendedor, sucursal y método de pago."
        acciones={
          <>
            <Input
              type="date"
              filter
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="max-w-[12rem]"
            />
            <Button variant="outline" onClick={exportCsv}>
              <Download size={16} /> Excel
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Totales por método de pago</h2>
            <span className="text-lg font-bold">{money(data?.grandTotal ?? '0')}</span>
          </div>
        </CardHeader>
        <CardContent className="hidden overflow-x-auto p-0 md:block">
          <table className="ds-table w-full">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                <th className="p-3">Vendedor</th>
                <th className="p-3">Ubicación</th>
                <th className="p-3">Método</th>
                <th className="p-3 text-right">Ventas</th>
                <th className="p-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((r, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="p-3">{r.seller}</td>
                  <td className="p-3">{r.location}</td>
                  <td className="p-3">{etiquetaDePago(r.paymentMethod)}</td>
                  <td className="p-3 text-right">{r.count}</td>
                  <td className="p-3 text-right font-medium">{money(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.rows.length === 0 && (
            <p className="py-8 text-center text-muted">Sin ventas en la fecha</p>
          )}
        </CardContent>

        {/* Móvil: tarjetas apiladas en vez de tabla. */}
        <div className="flex flex-col gap-2.5 p-3 md:hidden">
          {data?.rows.map((r, i) => (
            <div
              key={i}
              className="rounded-[14px] border border-border bg-surface p-[15px] shadow-card"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[14px] font-semibold">{r.seller}</span>
                <span className="shrink-0 text-[18px] font-extrabold tracking-[-0.02em]">
                  {money(r.total)}
                </span>
              </div>
              <div className="mt-1 text-[12px] leading-[1.5] text-muted">
                {r.location} · {etiquetaDePago(r.paymentMethod)} · {r.count}{' '}
                venta{r.count === 1 ? '' : 's'}
              </div>
            </div>
          ))}
          {data && data.rows.length === 0 && (
            <EmptyState
              icono={FileText}
              titulo="Sin ventas en esta fecha"
              descripcion="Elige otro día. Un día sin ventas también es un cierre válido: la lectura Z sale en cero."
            />
          )}
        </div>
      </Card>
    </Page>
  );
}
