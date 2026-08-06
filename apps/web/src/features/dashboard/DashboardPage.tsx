import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Download, FileText, Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Page, PageHeader } from '@/components/ui/page';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { downloadCsv, printPage } from '@/lib/print';
import type { DashboardData } from '@/lib/types';
import { DEFAULT_WIDGET_IDS, getWidget, WIDGET_REGISTRY } from './registry';

const SPAN: Record<string, string> = {
  sm: 'md:col-span-1',
  md: 'md:col-span-1',
  lg: 'md:col-span-2',
};

export function DashboardPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [layout, setLayout] = useState<string[]>(DEFAULT_WIDGET_IDS);

  const { data } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/reports/dashboard'),
  });
  const { data: config } = useQuery({
    queryKey: ['dashboard-config'],
    queryFn: () => api.get<string[] | null>('/dashboard-config'),
  });

  useEffect(() => {
    if (config) setLayout(config.filter((id) => getWidget(id)));
  }, [config]);

  const save = useMutation({
    mutationFn: (widgets: string[]) => api.put('/dashboard-config', { widgets }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard-config'] }),
  });

  function toggle(id: string) {
    setLayout((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  }
  function move(id: string, dir: -1 | 1) {
    setLayout((l) => {
      const i = l.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= l.length) return l;
      const copy = [...l];
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      return copy;
    });
  }

  function exportCsv() {
    if (!data) return;
    const rows: (string | number)[][] = [['Reporte', '', '']];
    rows.push([], ['Ventas por ubicación (mes)', 'Total', 'Ventas']);
    data.byLocation.forEach((l) => rows.push([l.name, l.total, l.count]));
    rows.push([], ['Ventas por vendedor (mes)', 'Total', 'Ventas']);
    data.bySeller.forEach((s) => rows.push([s.name, s.total, s.count]));
    rows.push([], ['Top productos', 'Cantidad', 'Ingresos']);
    data.topProducts.forEach((p) => rows.push([p.name, p.qty, p.revenue]));
    rows.push([], ['Proyección próximo mes', data.projection.nextMonth]);
    downloadCsv('reporte-ventas.csv', rows);
  }

  const activeWidgets = layout.map(getWidget).filter(Boolean);

  return (
    <Page>
      <div className="no-print flex flex-wrap items-start justify-between gap-3">
        <PageHeader titulo="Panel" descripcion="Cómo va el negocio hoy, con lo que elijas ver." />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportCsv}>
            <Download size={16} /> Excel
          </Button>
          <Button variant="outline" onClick={printPage}>
            <FileText size={16} /> PDF
          </Button>
          <Button variant={editing ? 'primary' : 'outline'} onClick={() => setEditing((e) => !e)}>
            <Settings2 size={16} /> Personalizar
          </Button>
        </div>
      </div>

      {/* Resumen impreso sólo en PDF (encabezado del reporte). */}
      <div className="hidden print:block">
        <h2 className="text-lg font-bold">Reporte de ventas</h2>
      </div>

      {editing && (
        <Card className="no-print">
          <CardHeader>
            <h2 className="text-lg font-medium">Widgets del panel</h2>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {WIDGET_REGISTRY.map((w) => {
              const active = layout.includes(w.id);
              const idx = layout.indexOf(w.id);
              return (
                <div
                  key={w.id}
                  className="flex items-center gap-2 rounded-theme border border-border p-2"
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggle(w.id)}
                    className="h-4 w-4"
                  />
                  <span className="flex-1 text-sm">{w.title}</span>
                  {active && (
                    <>
                      <button
                        onClick={() => move(w.id, -1)}
                        disabled={idx === 0}
                        className="p-1 text-muted disabled:opacity-30"
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        onClick={() => move(w.id, 1)}
                        disabled={idx === layout.length - 1}
                        className="p-1 text-muted disabled:opacity-30"
                      >
                        <ArrowDown size={16} />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
            <Button
              className="mt-2 self-start"
              disabled={save.isPending}
              onClick={() => save.mutate(layout)}
            >
              Guardar panel
            </Button>
          </CardContent>
        </Card>
      )}

      {!data ? (
        <p className="text-muted">Cargando…</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {activeWidgets.map((w) => {
            const W = w!.component;
            return (
              <div key={w!.id} className={SPAN[w!.size]}>
                <W data={data} />
              </div>
            );
          })}
          {activeWidgets.length === 0 && (
            <p className="text-muted">No hay widgets activos. Usa “Personalizar”.</p>
          )}
        </div>
      )}

      {/* Proyección resumida para el pie del PDF */}
      {data && (
        <div className="hidden text-sm print:block">
          Proyección próximo mes: {money(data.projection.nextMonth)} ({data.projection.method})
        </div>
      )}
    </Page>
  );
}
