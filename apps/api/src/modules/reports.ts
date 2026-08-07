import { withTenant } from '@ventafacil/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { viewScope } from '../lib/scope.js';

const TZ = 'America/La_Paz';

export async function reportRoutes(app: FastifyInstance) {
  // GET /reports/summary — comparativo por ubicacion: hoy / semana / mes (solo completadas).
  // Con ?from&to (ISO) añade una columna de rango personalizado.
  /**
   * Resumen de ventas y GANANCIA por ubicación. Sólo admin.
   *
   * Antes bastaba con estar autenticado, así que un vendedor podía pedirlo y leer la
   * ganancia del negocio — la misma información que se le oculta en Productos, servida
   * por otra puerta. Que no salga en su menú no cerraba nada: el menú es una cortesía,
   * la que cierra es esta línea.
   */
  app.get(
    '/reports/summary',
    { preHandler: [app.requireAuth, app.requireAdmin] },
    async (req, reply) => {
      const parsedQ = z
        .object({
          from: z.string().datetime({ offset: true }).optional(),
          to: z.string().datetime({ offset: true }).optional(),
        })
        .safeParse(req.query);
      if (!parsedQ.success)
        return reply.code(400).send({ data: null, error: 'Parámetros inválidos' });
      const { from, to } = parsedQ.data;
      const businessId = req.authUser!.businessId;
      // Alcance: la central ve todas las ubicaciones; la sucursal, sólo la suya.
      const scope = viewScope(req.authUser!);
      const locL = scope !== undefined ? sql`AND l.id = ${scope}` : sql``;
      const locSale = scope !== undefined ? sql`AND s.location_id = ${scope}` : sql``;
      // Filtro de rango (instante absoluto). Sin rango completo => FALSE (agregados en 0).
      const hasRange = !!(from && to);
      const rangeFilter = hasRange
        ? sql`s.client_created_at >= ${from}::timestamptz AND s.client_created_at <= ${to}::timestamptz`
        : sql`false`;

      // Fronteras de tiempo (hoy/semana/mes) calculadas en la zona horaria del negocio.
      const rows = await withTenant(businessId, (tx) =>
        tx.execute<{
          location_id: string;
          location_name: string;
          today: string;
          week: string;
          month: string;
          today_count: number;
          range_total: string;
          range_count: number;
        }>(sql`
      WITH bounds AS (
        SELECT
          date_trunc('day',   timezone(${TZ}, now())) AS d0,
          date_trunc('week',  timezone(${TZ}, now())) AS w0,
          date_trunc('month', timezone(${TZ}, now())) AS m0
      )
      SELECT
        l.id AS location_id,
        l.name AS location_name,
        COALESCE(SUM(s.total) FILTER (WHERE timezone(${TZ}, s.client_created_at) >= b.d0), 0) AS today,
        COALESCE(SUM(s.total) FILTER (WHERE timezone(${TZ}, s.client_created_at) >= b.w0), 0) AS week,
        COALESCE(SUM(s.total) FILTER (WHERE timezone(${TZ}, s.client_created_at) >= b.m0), 0) AS month,
        COUNT(s.id) FILTER (WHERE timezone(${TZ}, s.client_created_at) >= b.d0)::int AS today_count,
        COALESCE(SUM(s.total) FILTER (WHERE ${rangeFilter}), 0) AS range_total,
        COUNT(s.id) FILTER (WHERE ${rangeFilter})::int AS range_count
      FROM location l
      CROSS JOIN bounds b
      LEFT JOIN sale s
        ON s.location_id = l.id
       AND s.business_id = ${businessId}
       AND s.status = 'completed'
      WHERE l.business_id = ${businessId} ${locL}
      GROUP BY l.id, l.name, b.d0, b.w0, b.m0
      ORDER BY l.name
    `),
      );

      // Ganancia por ubicacion: (precio venta - costo unitario) del snapshot, ventas completadas.
      // Se calcula aparte porque une sale_item (varias filas por venta) y no debe inflar los totales.
      const profitRows = await withTenant(businessId, (tx) =>
        tx.execute<{
          location_id: string;
          today: string;
          week: string;
          month: string;
          range: string;
        }>(sql`
      WITH bounds AS (
        SELECT
          date_trunc('day',   timezone(${TZ}, now())) AS d0,
          date_trunc('week',  timezone(${TZ}, now())) AS w0,
          date_trunc('month', timezone(${TZ}, now())) AS m0
      )
      -- COGS (costo de lo vendido) por ubicación. Ganancia = ingreso NETO - COGS,
      -- así el descuento de la venta reduce la ganancia correctamente.
      SELECT
        s.location_id,
        COALESCE(SUM(COALESCE(si.unit_cost_snapshot, 0) * si.quantity)
          FILTER (WHERE timezone(${TZ}, s.client_created_at) >= b.d0), 0) AS today,
        COALESCE(SUM(COALESCE(si.unit_cost_snapshot, 0) * si.quantity)
          FILTER (WHERE timezone(${TZ}, s.client_created_at) >= b.w0), 0) AS week,
        COALESCE(SUM(COALESCE(si.unit_cost_snapshot, 0) * si.quantity)
          FILTER (WHERE timezone(${TZ}, s.client_created_at) >= b.m0), 0) AS month,
        COALESCE(SUM(COALESCE(si.unit_cost_snapshot, 0) * si.quantity)
          FILTER (WHERE ${rangeFilter}), 0) AS range
      FROM sale s
      CROSS JOIN bounds b
      JOIN sale_item si ON si.sale_id = s.id
      WHERE s.business_id = ${businessId} AND s.status = 'completed' ${locSale}
      GROUP BY s.location_id
    `),
      );
      const cogsBy = new Map(profitRows.map((p) => [p.location_id, p]));

      const items = rows.map((r) => {
        const c = cogsBy.get(r.location_id);
        return {
          locationId: r.location_id,
          locationName: r.location_name,
          today: String(r.today),
          week: String(r.week),
          month: String(r.month),
          todayCount: Number(r.today_count),
          // ingreso neto (r.*) - COGS (c.*)
          profitToday: (Number(r.today) - Number(c?.today ?? 0)).toFixed(2),
          profitWeek: (Number(r.week) - Number(c?.week ?? 0)).toFixed(2),
          profitMonth: (Number(r.month) - Number(c?.month ?? 0)).toFixed(2),
          // Rango personalizado (0 si no se envió ?from&to).
          rangeTotal: String(r.range_total),
          rangeCount: Number(r.range_count),
          rangeProfit: (Number(r.range_total) - Number(c?.range ?? 0)).toFixed(2),
        };
      });

      const sum = (key: keyof (typeof items)[number]) =>
        items.reduce((acc, it) => acc + Number(it[key]), 0).toFixed(2);
      const sumInt = (key: keyof (typeof items)[number]) =>
        items.reduce((acc, it) => acc + Number(it[key]), 0);

      return reply.send({
        data: {
          byLocation: items,
          hasRange,
          totals: {
            today: sum('today'),
            week: sum('week'),
            month: sum('month'),
            range: sum('rangeTotal'),
          },
          profit: {
            today: sum('profitToday'),
            week: sum('profitWeek'),
            month: sum('profitMonth'),
            range: sum('rangeProfit'),
          },
          rangeCount: sumInt('rangeCount'),
        },
        error: null,
      });
    },
  );
}
