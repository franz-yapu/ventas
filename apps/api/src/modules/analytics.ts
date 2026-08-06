import { withTenant } from '@ventafacil/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { computeProjection, type TrendPoint } from '../lib/projection.js';
import { viewScope } from '../lib/scope.js';

const TZ = 'America/La_Paz';

/** Resta días a una fecha 'YYYY-MM-DD' y devuelve otra igual. Sin husos de por medio. */
function restarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

export async function analyticsRoutes(app: FastifyInstance) {
  // GET /reports/dashboard — datos de todos los widgets en una sola llamada (eficiente en KVM1).
  // El panel de análisis es de plan Pro en adelante. La lectura Z de más abajo NO se
  // limita: es el cierre de caja, parte del POS, y ningún plan puede quedarse sin él.
  // Admin, además del plan: el panel trae cuánto vendió CADA vendedor y los ingresos
  // del negocio. Que no saliera en el menú de un vendedor no cerraba nada.
  const soloConAnalitica = [
    app.requireAuth,
    app.requireAdmin,
    app.requireFeature('reportes_avanzados'),
  ];

  app.get('/reports/dashboard', { preHandler: soloConAnalitica }, async (req, reply) => {
    const businessId = req.authUser!.businessId;
    // Alcance por ubicación: la sucursal ve sólo la suya; la central ve todas.
    // Fragmentos SQL según el alias que use cada consulta (vacío = sin restricción).
    const scope = viewScope(req.authUser!);
    const locSale = scope !== undefined ? sql`AND s.location_id = ${scope}` : sql``;
    const locBare = scope !== undefined ? sql`AND location_id = ${scope}` : sql``;
    const locL = scope !== undefined ? sql`AND l.id = ${scope}` : sql``;
    const locInv = scope !== undefined ? sql`AND i.location_id = ${scope}` : sql``;

    // Las 6 consultas comparten UNA transaccion: un solo BEGIN/COMMIT y el contexto
    // de tenant fijado una vez para todas.
    const { kpi, trend, trendPrev, byLocation, bySeller, topProducts, lowStock } = await withTenant(
      businessId,
      async (tx) => {
        // 1) KPIs de hoy y ticket promedio del mes.
        const [kpi] = await tx.execute<{
          today_total: string;
          today_count: number;
          yesterday_total: string;
          avg_ticket: string;
        }>(sql`
      WITH b AS (SELECT date_trunc('day', timezone(${TZ}, now())) d0, date_trunc('month', timezone(${TZ}, now())) m0)
      SELECT
        COALESCE(SUM(total) FILTER (WHERE timezone(${TZ}, client_created_at) >= b.d0), 0) AS today_total,
        COUNT(*) FILTER (WHERE timezone(${TZ}, client_created_at) >= b.d0)::int AS today_count,
        COALESCE(SUM(total) FILTER (WHERE timezone(${TZ}, client_created_at) >= b.d0 - interval '1 day'
          AND timezone(${TZ}, client_created_at) < b.d0), 0) AS yesterday_total,
        COALESCE(AVG(total) FILTER (WHERE timezone(${TZ}, client_created_at) >= b.m0), 0) AS avg_ticket
      FROM sale CROSS JOIN b
      WHERE business_id = ${businessId} AND status = 'completed' ${locBare}
    `);

        // 2) Tendencia diaria. Se piden 60 días en UNA consulta y se parten en dos
        // series de 30: la actual y la de los 30 días anteriores, para poder
        // compararlas en el mismo gráfico. Dos consultas costarían el doble de
        // barridos sobre `sale` por un dato que se mira de reojo.
        const trendRows = await tx.execute<{ date: string; total: string }>(sql`
      SELECT to_char(date_trunc('day', timezone(${TZ}, client_created_at)), 'YYYY-MM-DD') AS date,
             SUM(total) AS total
      FROM sale
      WHERE business_id = ${businessId} AND status = 'completed' ${locBare}
        AND timezone(${TZ}, client_created_at) >= date_trunc('day', timezone(${TZ}, now())) - interval '59 days'
      GROUP BY 1 ORDER BY 1
    `);
        // El corte se calcula con la fecha que devuelve Postgres ya en la zona del
        // negocio, no con `new Date()` del servidor: si el proceso corre en UTC, la
        // frontera del día se movería unas horas y el reparto entre las dos series
        // saldría mal justo en el borde.
        const [hoyRow] = await tx.execute<{ hoy: string }>(sql`
      SELECT to_char(date_trunc('day', timezone(${TZ}, now())), 'YYYY-MM-DD') AS hoy
    `);
        const corte = restarDias(hoyRow!.hoy, 29);

        const todos = trendRows.map((r) => ({ date: r.date, total: Number(r.total) }));
        // `trend` conserva EXACTAMENTE lo que era (últimos 30 días): de él sale también
        // la proyección de fin de mes, y ampliarlo cambiaría ese número.
        const trend: TrendPoint[] = todos.filter((t) => t.date >= corte);
        const trendPrev: TrendPoint[] = todos.filter((t) => t.date < corte);

        // 3) Ventas por ubicación (mes).
        const byLocation = await tx.execute<{ name: string; total: string; count: number }>(sql`
      SELECT l.name, COALESCE(SUM(s.total), 0) AS total, COUNT(s.id)::int AS count
      FROM location l
      LEFT JOIN sale s ON s.location_id = l.id AND s.status = 'completed'
        AND timezone(${TZ}, s.client_created_at) >= date_trunc('month', timezone(${TZ}, now()))
      WHERE l.business_id = ${businessId} ${locL}
      GROUP BY l.id, l.name ORDER BY total DESC
    `);

        // 4) Ventas por vendedor (mes).
        const bySeller = await tx.execute<{ name: string; total: string; count: number }>(sql`
      SELECT u.name, COALESCE(SUM(s.total), 0) AS total, COUNT(s.id)::int AS count
      FROM sale s JOIN app_user u ON u.id = s.user_id
      WHERE s.business_id = ${businessId} AND s.status = 'completed' ${locSale}
        AND timezone(${TZ}, s.client_created_at) >= date_trunc('month', timezone(${TZ}, now()))
      GROUP BY u.id, u.name ORDER BY total DESC
    `);

        // 5) Top 10 productos (mes) por cantidad.
        const topProducts = await tx.execute<{ name: string; qty: number; revenue: string }>(sql`
      SELECT si.product_name_snapshot AS name, SUM(si.quantity)::int AS qty, SUM(si.line_total) AS revenue
      FROM sale_item si JOIN sale s ON s.id = si.sale_id
      WHERE s.business_id = ${businessId} AND s.status = 'completed' ${locSale}
        AND timezone(${TZ}, s.client_created_at) >= date_trunc('month', timezone(${TZ}, now()))
      GROUP BY si.product_name_snapshot ORDER BY qty DESC LIMIT 10
    `);

        // 6) Productos con stock bajo (cantidad <= mínimo).
        const lowStock = await tx.execute<{
          name: string;
          location: string;
          quantity: number;
          min_stock: number;
        }>(sql`
      SELECT p.name, l.name AS location, i.quantity, i.min_stock
      FROM inventory i JOIN product p ON p.id = i.product_id JOIN location l ON l.id = i.location_id
      WHERE i.business_id = ${businessId} AND i.min_stock IS NOT NULL AND i.quantity <= i.min_stock ${locInv}
      ORDER BY i.quantity ASC LIMIT 20
    `);
        return { kpi, trend, trendPrev, byLocation, bySeller, topProducts, lowStock };
      },
    );

    return reply.send({
      data: {
        kpi: {
          todayTotal: String(kpi?.today_total ?? '0'),
          todayCount: Number(kpi?.today_count ?? 0),
          yesterdayTotal: String(kpi?.yesterday_total ?? '0'),
          avgTicket: Number(kpi?.avg_ticket ?? 0).toFixed(2),
        },
        trend,
        trendPrev,
        byLocation: byLocation.map((r) => ({
          name: r.name,
          total: String(r.total),
          count: Number(r.count),
        })),
        bySeller: bySeller.map((r) => ({
          name: r.name,
          total: String(r.total),
          count: Number(r.count),
        })),
        topProducts: topProducts.map((r) => ({
          name: r.name,
          qty: Number(r.qty),
          revenue: String(r.revenue),
        })),
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

  /**
   * GET /reports/cash-z — lectura Z: totales por método de pago y POR VENDEDOR.
   *
   * Sólo admin. Es el papel con el que el dueño repasa el día de cada cajero; que un
   * vendedor viera cuánto hizo el compañero del otro turno es supervisar, no vender. Su
   * propio turno lo sigue teniendo entero en Caja.
   *
   * NO depende del plan, a diferencia del panel: es el cierre de caja, parte del POS, y
   * ningún plan puede quedarse sin él.
   */
  app.get('/reports/cash-z', { preHandler: [app.requireAuth, app.requireAdmin] }, async (req, reply) => {
    const q = z
      .object({ date: z.string().optional(), locationId: z.string().uuid().optional() })
      .safeParse(req.query);
    if (!q.success) return reply.code(400).send({ data: null, error: 'Parámetros inválidos' });
    const businessId = req.authUser!.businessId;
    const date = q.data.date ?? new Date().toISOString().slice(0, 10);
    // La sucursal queda fijada a su ubicación; la central puede filtrar por una (o ver todas).
    const scope = viewScope(req.authUser!);
    const effLocation = scope !== undefined ? scope : q.data.locationId;

    const rows = await withTenant(businessId, (tx) =>
      tx.execute<{
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
    `),
    );

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
