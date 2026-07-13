import { db } from '@ventafacil/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { computeProjection, type TrendPoint } from '../lib/projection.js';
import { viewScope } from '../lib/scope.js';

const TZ = 'America/La_Paz';

export async function analyticsRoutes(app: FastifyInstance) {
  // GET /reports/dashboard — datos de todos los widgets en una sola llamada (eficiente en KVM1).
  app.get('/reports/dashboard', { preHandler: app.requireAuth }, async (req, reply) => {
    const businessId = req.authUser!.businessId;
    // Alcance por ubicación: la sucursal ve sólo la suya; la central ve todas.
    // Fragmentos SQL según el alias que use cada consulta (vacío = sin restricción).
    const scope = viewScope(req.authUser!);
    const locSale = scope !== undefined ? sql`AND s.location_id = ${scope}` : sql``;
    const locBare = scope !== undefined ? sql`AND location_id = ${scope}` : sql``;
    const locL = scope !== undefined ? sql`AND l.id = ${scope}` : sql``;
    const locInv = scope !== undefined ? sql`AND i.location_id = ${scope}` : sql``;

    // 1) KPIs de hoy y ticket promedio del mes.
    const [kpi] = await db.execute<{ today_total: string; today_count: number; avg_ticket: string }>(sql`
      WITH b AS (SELECT date_trunc('day', timezone(${TZ}, now())) d0, date_trunc('month', timezone(${TZ}, now())) m0)
      SELECT
        COALESCE(SUM(total) FILTER (WHERE timezone(${TZ}, client_created_at) >= b.d0), 0) AS today_total,
        COUNT(*) FILTER (WHERE timezone(${TZ}, client_created_at) >= b.d0)::int AS today_count,
        COALESCE(AVG(total) FILTER (WHERE timezone(${TZ}, client_created_at) >= b.m0), 0) AS avg_ticket
      FROM sale CROSS JOIN b
      WHERE business_id = ${businessId} AND status = 'completed' ${locBare}
    `);

    // 2) Tendencia diaria de los últimos 30 días.
    const trendRows = await db.execute<{ date: string; total: string }>(sql`
      SELECT to_char(date_trunc('day', timezone(${TZ}, client_created_at)), 'YYYY-MM-DD') AS date,
             SUM(total) AS total
      FROM sale
      WHERE business_id = ${businessId} AND status = 'completed' ${locBare}
        AND timezone(${TZ}, client_created_at) >= date_trunc('day', timezone(${TZ}, now())) - interval '29 days'
      GROUP BY 1 ORDER BY 1
    `);
    const trend: TrendPoint[] = trendRows.map((r) => ({ date: r.date, total: Number(r.total) }));

    // 3) Ventas por ubicación (mes).
    const byLocation = await db.execute<{ name: string; total: string; count: number }>(sql`
      SELECT l.name, COALESCE(SUM(s.total), 0) AS total, COUNT(s.id)::int AS count
      FROM location l
      LEFT JOIN sale s ON s.location_id = l.id AND s.status = 'completed'
        AND timezone(${TZ}, s.client_created_at) >= date_trunc('month', timezone(${TZ}, now()))
      WHERE l.business_id = ${businessId} ${locL}
      GROUP BY l.id, l.name ORDER BY total DESC
    `);

    // 4) Ventas por vendedor (mes).
    const bySeller = await db.execute<{ name: string; total: string; count: number }>(sql`
      SELECT u.name, COALESCE(SUM(s.total), 0) AS total, COUNT(s.id)::int AS count
      FROM sale s JOIN app_user u ON u.id = s.user_id
      WHERE s.business_id = ${businessId} AND s.status = 'completed' ${locSale}
        AND timezone(${TZ}, s.client_created_at) >= date_trunc('month', timezone(${TZ}, now()))
      GROUP BY u.id, u.name ORDER BY total DESC
    `);

    // 5) Top 10 productos (mes) por cantidad.
    const topProducts = await db.execute<{ name: string; qty: number; revenue: string }>(sql`
      SELECT si.product_name_snapshot AS name, SUM(si.quantity)::int AS qty, SUM(si.line_total) AS revenue
      FROM sale_item si JOIN sale s ON s.id = si.sale_id
      WHERE s.business_id = ${businessId} AND s.status = 'completed' ${locSale}
        AND timezone(${TZ}, s.client_created_at) >= date_trunc('month', timezone(${TZ}, now()))
      GROUP BY si.product_name_snapshot ORDER BY qty DESC LIMIT 10
    `);

    // 6) Productos con stock bajo (cantidad <= mínimo).
    const lowStock = await db.execute<{ name: string; location: string; quantity: number; min_stock: number }>(sql`
      SELECT p.name, l.name AS location, i.quantity, i.min_stock
      FROM inventory i JOIN product p ON p.id = i.product_id JOIN location l ON l.id = i.location_id
      WHERE i.business_id = ${businessId} AND i.min_stock IS NOT NULL AND i.quantity <= i.min_stock ${locInv}
      ORDER BY i.quantity ASC LIMIT 20
    `);

    return reply.send({
      data: {
        kpi: {
          todayTotal: String(kpi?.today_total ?? '0'),
          todayCount: Number(kpi?.today_count ?? 0),
          avgTicket: Number(kpi?.avg_ticket ?? 0).toFixed(2),
        },
        trend,
        byLocation: byLocation.map((r) => ({ name: r.name, total: String(r.total), count: Number(r.count) })),
        bySeller: bySeller.map((r) => ({ name: r.name, total: String(r.total), count: Number(r.count) })),
        topProducts: topProducts.map((r) => ({ name: r.name, qty: Number(r.qty), revenue: String(r.revenue) })),
        lowStock: lowStock.map((r) => ({
          name: r.name,
          location: r.location,
          quantity: Number(r.quantity),
          minStock: Number(r.min_stock),
        })),
        projection: computeProjection(trend),
      },
      error: null,
    });
  });

  // GET /reports/cash-z — lectura Z: totales por método de pago por vendedor (día dado).
  app.get('/reports/cash-z', { preHandler: app.requireAuth }, async (req, reply) => {
    const q = z.object({ date: z.string().optional(), locationId: z.string().uuid().optional() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ data: null, error: 'Parámetros inválidos' });
    const businessId = req.authUser!.businessId;
    const date = q.data.date ?? new Date().toISOString().slice(0, 10);
    // La sucursal queda fijada a su ubicación; la central puede filtrar por una (o ver todas).
    const scope = viewScope(req.authUser!);
    const effLocation = scope !== undefined ? scope : q.data.locationId;

    const rows = await db.execute<{
      seller: string;
      location: string;
      payment_method: string;
      total: string;
      count: number;
    }>(sql`
      SELECT u.name AS seller, l.name AS location, s.payment_method, SUM(s.total) AS total, COUNT(*)::int AS count
      FROM sale s JOIN app_user u ON u.id = s.user_id JOIN location l ON l.id = s.location_id
      WHERE s.business_id = ${businessId} AND s.status = 'completed'
        AND date(timezone(${TZ}, s.client_created_at)) = ${date}
        ${effLocation ? sql`AND s.location_id = ${effLocation}` : sql``}
      GROUP BY u.name, l.name, s.payment_method
      ORDER BY u.name, l.name, s.payment_method
    `);

    const grand = rows.reduce((a, r) => a + Number(r.total), 0);
    return reply.send({
      data: {
        date,
        rows: rows.map((r) => ({
          seller: r.seller,
          location: r.location,
          paymentMethod: r.payment_method,
          total: String(r.total),
          count: Number(r.count),
        })),
        grandTotal: grand.toFixed(2),
      },
      error: null,
    });
  });
}
