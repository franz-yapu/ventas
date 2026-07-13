import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { money, PAYMENT_LABELS } from '@/lib/format';
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
    data.rows.forEach((r) => rows.push([r.seller, r.location, PAYMENT_LABELS[r.paymentMethod] ?? r.paymentMethod, r.total, r.count]));
    rows.push([], ['TOTAL GENERAL', data.grandTotal]);
    downloadCsv(`cierre-caja-${data.date}.csv`, rows);
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Cierre de caja (Z)</h1>
        <div className="flex items-center gap-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="max-w-[12rem]" />
          <Button variant="outline" onClick={exportCsv}>
            <Download size={16} /> Excel
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Totales por método de pago</h2>
            <span className="text-lg font-bold">{money(data?.grandTotal ?? '0')}</span>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
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
                  <td className="p-3">{PAYMENT_LABELS[r.paymentMethod] ?? r.paymentMethod}</td>
                  <td className="p-3 text-right">{r.count}</td>
                  <td className="p-3 text-right font-medium">{money(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.rows.length === 0 && <p className="py-8 text-center text-muted">Sin ventas en la fecha</p>}
        </CardContent>
      </Card>
    </div>
  );
}
