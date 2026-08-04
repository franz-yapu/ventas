import { db, schema, withTenant } from '@ventafacil/db';
import {
  effectiveStatus,
  isBlocked,
  SUBSCRIPTION_STATUS,
  type EffectiveStatus,
} from '@ventafacil/shared';
import argon2 from 'argon2';
import { and, asc, count, desc, eq, ilike, or } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../env.js';
import { invalidateAccess } from '../lib/subscription.js';

/**
 * Panel de plataforma: el operador (tú) por encima de todos los negocios.
 *
 * Todo lo de aquí consulta `business`, `subscription` y `plan`, que están FUERA de RLS
 * justamente para esto. Las tablas del negocio (productos, ventas, usuarios) SÍ están
 * bajo RLS, así que para contar lo de un tenant hay que entrar con `withTenant` a su
 * contexto — no hay ni puede haber una consulta que las lea todas de golpe, y es
 * deliberado: ni siquiera el panel tiene una puerta trasera a los datos de los clientes.
 */

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const updateSubBody = z.object({
  planCode: z.string().min(1).optional(),
  status: z.enum(SUBSCRIPTION_STATUS).optional(),
  trialEndsAt: z.string().datetime().nullable().optional(),
  suspendedReason: z.string().max(500).nullable().optional(),
});

const listQuery = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/** Deja constancia de lo que la plataforma hace sobre un negocio. */
async function registrar(
  req: FastifyRequest,
  entry: {
    action: string;
    businessId?: string | null;
    businessName?: string | null;
    before?: unknown;
    after?: unknown;
  },
) {
  const admin = req.platformUser!;
  await db.insert(schema.platformAuditLog).values({
    adminId: admin.sub,
    adminEmail: admin.email,
    action: entry.action,
    businessId: entry.businessId ?? null,
    businessName: entry.businessName ?? null,
    beforeJson: (entry.before ?? null) as never,
    afterJson: (entry.after ?? null) as never,
  });
}

export async function platformRoutes(app: FastifyInstance) {
  // ── Sesión ───────────────────────────────────────────────────

  // Mismo límite estricto que el login de los negocios: es el endpoint con más que
  // perder de todo el sistema.
  const loginRateLimit = {
    rateLimit: { max: env.loginRateLimitMax, timeWindow: env.loginRateLimitWindow },
  };

  app.post('/platform/login', { config: loginRateLimit }, async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    // Un 400 detallado diría si el correo existe; se responde igual que a una
    // contraseña mala.
    if (!parsed.success) {
      return reply.code(401).send({ data: null, error: 'Credenciales incorrectas' });
    }
    const { email, password } = parsed.data;

    const [admin] = await db
      .select()
      .from(schema.platformAdmin)
      .where(
        and(
          eq(schema.platformAdmin.email, email.toLowerCase()),
          eq(schema.platformAdmin.isActive, true),
        ),
      )
      .limit(1);

    if (!admin || !(await argon2.verify(admin.passwordHash, password))) {
      return reply.code(401).send({ data: null, error: 'Credenciales incorrectas' });
    }

    await db
      .update(schema.platformAdmin)
      .set({ lastLoginAt: new Date() })
      .where(eq(schema.platformAdmin.id, admin.id));

    const claims = { sub: admin.id, email: admin.email, name: admin.name, typ: 'platform' };
    // Sin refresh token: la sesión del panel dura lo que dura y se vuelve a entrar.
    // Menos piezas que revocar el día que haga falta cortar un acceso.
    const accessToken = app.platformJwt.sign(claims);

    await db.insert(schema.platformAuditLog).values({
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'platform_login',
    });

    return reply.send({
      // Misma forma que devuelve GET /platform/me, para que el frontend guarde lo
      // mismo venga de donde venga.
      data: { accessToken, admin: { sub: admin.id, email: admin.email, name: admin.name } },
      error: null,
    });
  });

  app.get('/platform/me', { preHandler: app.requirePlatform }, async (req, reply) => {
    return reply.send({ data: req.platformUser, error: null });
  });

  // ── Negocios ─────────────────────────────────────────────────

  /**
   * Listado de tenants. Una sola consulta sobre tablas de plataforma: rápido aunque
   * haya cientos. El uso de cada negocio (productos, usuarios…) NO va aquí porque
   * obligaría a una transacción por tenant; se pide al abrir el detalle.
   */
  app.get('/platform/tenants', { preHandler: app.requirePlatform }, async (req, reply) => {
    const q = listQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ data: null, error: 'Parámetros inválidos' });

    const filtro = q.data.search?.trim();
    const rows = await db
      .select({
        id: schema.business.id,
        name: schema.business.name,
        slug: schema.business.slug,
        createdAt: schema.business.createdAt,
        planCode: schema.subscription.planCode,
        planName: schema.plan.name,
        priceMonthly: schema.plan.priceMonthly,
        currency: schema.plan.currency,
        status: schema.subscription.status,
        trialEndsAt: schema.subscription.trialEndsAt,
        currentPeriodEnd: schema.subscription.currentPeriodEnd,
        suspendedReason: schema.subscription.suspendedReason,
      })
      .from(schema.business)
      .leftJoin(schema.subscription, eq(schema.subscription.businessId, schema.business.id))
      .leftJoin(schema.plan, eq(schema.plan.code, schema.subscription.planCode))
      .where(
        filtro
          ? or(ilike(schema.business.name, `%${filtro}%`), ilike(schema.business.slug, `%${filtro}%`))
          : undefined,
      )
      .orderBy(asc(schema.business.name))
      .limit(q.data.limit);

    // El estado efectivo (prueba vencida) se calcula aquí, igual que en el API del
    // negocio, para que el panel muestre lo mismo que ve el cliente.
    const data = rows.map((r) => {
      const status: EffectiveStatus | null = r.status
        ? effectiveStatus({ status: r.status, trialEndsAt: r.trialEndsAt })
        : null;
      return { ...r, status, blocked: status ? isBlocked(status) : false };
    });

    return reply.send({ data, error: null });
  });

  /** Detalle de un negocio, con su uso real. Entra al contexto del tenant para contar. */
  app.get('/platform/tenants/:id', { preHandler: app.requirePlatform }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const [biz] = await db
      .select()
      .from(schema.business)
      .where(eq(schema.business.id, id))
      .limit(1);
    if (!biz) return reply.code(404).send({ data: null, error: 'Negocio no encontrado' });

    const [sub] = await db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.businessId, id))
      .limit(1);

    // El `where business_id` va explícito además del contexto de RLS. RLS es el
    // respaldo, no la única línea: mientras no esté activo en producción, sin el
    // filtro estas cuentas sumarían las de TODOS los negocios y el panel mentiría.
    const uso = await withTenant(id, async (tx) => {
      const [u] = await tx
        .select({ n: count() })
        .from(schema.appUser)
        .where(and(eq(schema.appUser.businessId, id), eq(schema.appUser.isActive, true)));
      const [l] = await tx
        .select({ n: count() })
        .from(schema.location)
        .where(and(eq(schema.location.businessId, id), eq(schema.location.isActive, true)));
      const [p] = await tx
        .select({ n: count() })
        .from(schema.product)
        .where(and(eq(schema.product.businessId, id), eq(schema.product.isActive, true)));
      const [v] = await tx
        .select({ n: count() })
        .from(schema.sale)
        .where(eq(schema.sale.businessId, id));
      const [ultima] = await tx
        .select({ at: schema.sale.clientCreatedAt })
        .from(schema.sale)
        .where(eq(schema.sale.businessId, id))
        .orderBy(desc(schema.sale.clientCreatedAt))
        .limit(1);
      return {
        users: u?.n ?? 0,
        locations: l?.n ?? 0,
        products: p?.n ?? 0,
        sales: v?.n ?? 0,
        lastSaleAt: ultima?.at ?? null,
      };
    });

    const status = sub ? effectiveStatus({ status: sub.status, trialEndsAt: sub.trialEndsAt }) : null;

    return reply.send({
      data: {
        business: { id: biz.id, name: biz.name, slug: biz.slug, createdAt: biz.createdAt },
        subscription: sub ? { ...sub, status } : null,
        blocked: status ? isBlocked(status) : false,
        usage: uso,
      },
      error: null,
    });
  });

  /**
   * Cambiar plan o estado de un negocio: suspender, reactivar, subir de plan.
   *
   * Al terminar se invalida la caché de suscripción, así que el corte (o la
   * reactivación) es inmediato en vez de tardar hasta un minuto. Importa: cuando
   * reactivas a alguien que acaba de pagar, está mirando la pantalla.
   */
  app.patch(
    '/platform/tenants/:id/subscription',
    { preHandler: app.requirePlatform },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = updateSubBody.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ data: null, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      }

      const [biz] = await db
        .select({ id: schema.business.id, name: schema.business.name })
        .from(schema.business)
        .where(eq(schema.business.id, id))
        .limit(1);
      if (!biz) return reply.code(404).send({ data: null, error: 'Negocio no encontrado' });

      if (parsed.data.planCode) {
        const [p] = await db
          .select({ code: schema.plan.code })
          .from(schema.plan)
          .where(eq(schema.plan.code, parsed.data.planCode))
          .limit(1);
        if (!p) return reply.code(400).send({ data: null, error: 'Ese plan no existe' });
      }

      const [before] = await db
        .select()
        .from(schema.subscription)
        .where(eq(schema.subscription.businessId, id))
        .limit(1);

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      const d = parsed.data;
      if (d.planCode !== undefined) patch.planCode = d.planCode;
      if (d.status !== undefined) {
        patch.status = d.status;
        // La fecha de baja la pone el servidor: es lo que después cuenta como churn.
        patch.cancelledAt = d.status === 'cancelled' ? new Date() : null;
        // Reactivar limpia el motivo de suspensión; dejarlo colgado confunde.
        if (d.status !== 'suspended') patch.suspendedReason = null;
      }
      if (d.trialEndsAt !== undefined) {
        patch.trialEndsAt = d.trialEndsAt ? new Date(d.trialEndsAt) : null;
      }
      if (d.suspendedReason !== undefined) patch.suspendedReason = d.suspendedReason;

      let after;
      if (before) {
        [after] = await db
          .update(schema.subscription)
          .set(patch)
          .where(eq(schema.subscription.businessId, id))
          .returning();
      } else {
        // Negocio anterior al SaaS al que se le asigna plan por primera vez.
        if (!d.planCode) {
          return reply
            .code(400)
            .send({ data: null, error: 'Este negocio no tiene suscripción: indica un plan' });
        }
        [after] = await db
          .insert(schema.subscription)
          .values({
            businessId: id,
            planCode: d.planCode,
            status: d.status ?? 'active',
            trialEndsAt: d.trialEndsAt ? new Date(d.trialEndsAt) : null,
            suspendedReason: d.suspendedReason ?? null,
          })
          .returning();
      }

      invalidateAccess(id);
      await registrar(req, {
        action: 'subscription_update',
        businessId: biz.id,
        businessName: biz.name,
        before: before ?? null,
        after,
      });

      return reply.send({ data: after, error: null });
    },
  );

  // ── Métricas ─────────────────────────────────────────────────

  /**
   * MRR y estado de la cartera. Una sola consulta sobre `subscription` + `plan`.
   *
   * El MRR se parte en dos a propósito: lo que está al día y lo que está cobrado a
   * medias. Sumarlo todo en un número daría un MRR más bonito y menos cierto.
   */
  app.get('/platform/metrics', { preHandler: app.requirePlatform }, async (_req, reply) => {
    const rows = await db
      .select({
        status: schema.subscription.status,
        trialEndsAt: schema.subscription.trialEndsAt,
        cancelledAt: schema.subscription.cancelledAt,
        createdAt: schema.subscription.createdAt,
        priceMonthly: schema.plan.priceMonthly,
        planCode: schema.plan.code,
      })
      .from(schema.subscription)
      .innerJoin(schema.plan, eq(schema.plan.code, schema.subscription.planCode));

    const inicioDeMes = new Date();
    inicioDeMes.setDate(1);
    inicioDeMes.setHours(0, 0, 0, 0);

    const porEstado: Record<string, number> = {};
    let mrr = 0;
    let mrrEnRiesgo = 0;
    let altasDelMes = 0;
    let bajasDelMes = 0;

    for (const r of rows) {
      const status = effectiveStatus({ status: r.status, trialEndsAt: r.trialEndsAt });
      porEstado[status] = (porEstado[status] ?? 0) + 1;
      const precio = Number(r.priceMonthly);
      if (status === 'active') mrr += precio;
      if (status === 'past_due') mrrEnRiesgo += precio;
      if (r.createdAt >= inicioDeMes) altasDelMes++;
      if (r.cancelledAt && r.cancelledAt >= inicioDeMes) bajasDelMes++;
    }

    const [totalNegocios] = await db.select({ n: count() }).from(schema.business);

    return reply.send({
      data: {
        // Redondeado a 2 decimales: son sumas de numeric, no floats acumulados.
        mrr: mrr.toFixed(2),
        mrrEnRiesgo: mrrEnRiesgo.toFixed(2),
        porEstado,
        altasDelMes,
        bajasDelMes,
        totalNegocios: totalNegocios?.n ?? 0,
        conSuscripcion: rows.length,
      },
      error: null,
    });
  });

  /** Bitácora de la plataforma: quién suspendió a quién y cuándo. */
  app.get('/platform/audit', { preHandler: app.requirePlatform }, async (req, reply) => {
    const q = listQuery.safeParse(req.query);
    const limit = q.success ? q.data.limit : 100;
    const rows = await db
      .select()
      .from(schema.platformAuditLog)
      .orderBy(desc(schema.platformAuditLog.createdAt))
      .limit(limit);
    return reply.send({ data: rows, error: null });
  });
}
