import type { ComponentType } from 'react';
import type { DashboardData } from '@/lib/types';
import {
  AvgTicket,
  KpiToday,
  LowStock,
  MonthTotal,
  Projection,
  SalesByLocation,
  SalesBySeller,
  TopProducts,
  Trend30,
} from './widgets';

export interface WidgetDef {
  id: string;
  title: string;
  size: 'sm' | 'md' | 'lg'; // sm=1 col, md=1 col alto, lg=2 col
  component: ComponentType<{ data: DashboardData }>;
}

/**
 * Registro de widgets. Para AGREGAR un widget nuevo: crear el componente en widgets.tsx
 * y añadir una entrada aquí. El Dashboard no se toca (crecer "a la derecha").
 */
export const WIDGET_REGISTRY: WidgetDef[] = [
  { id: 'kpi-today', title: 'Ventas de hoy', size: 'sm', component: KpiToday },
  { id: 'month-total', title: 'Ventas del mes', size: 'sm', component: MonthTotal },
  { id: 'avg-ticket', title: 'Ticket promedio', size: 'sm', component: AvgTicket },
  { id: 'projection', title: 'Proyección próximo mes', size: 'sm', component: Projection },
  { id: 'trend-30', title: 'Tendencia 30 días', size: 'lg', component: Trend30 },
  { id: 'by-location', title: 'Ventas por ubicación', size: 'md', component: SalesByLocation },
  { id: 'by-seller', title: 'Ventas por vendedor', size: 'md', component: SalesBySeller },
  { id: 'top-products', title: 'Top 10 productos', size: 'md', component: TopProducts },
  { id: 'low-stock', title: 'Stock bajo', size: 'md', component: LowStock },
];

export const DEFAULT_WIDGET_IDS = WIDGET_REGISTRY.map((w) => w.id);

export function getWidget(id: string): WidgetDef | undefined {
  return WIDGET_REGISTRY.find((w) => w.id === id);
}
