import { db, schema, slugDisponible, withTenant } from '@ventafacil/db';
import {
  effectiveStatus,
  isBlocked,
  MENSAJE_SLUG,
  SUBSCRIPTION_STATUS,
  validarSlug,
  type EffectiveStatus,
} from '@ventafacil/shared';
import argon2 from 'argon2';
import { and, asc, count, desc, eq, ilike, ne, or } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { env } from '../env.js';
import { enviarCorreo, urlDelNegocio } from '../lib/mailer.js';
import { violaUnica } from '../lib/pg-errores.js';
import { revocarTodo } from '../lib/sessions.js';
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

/** Renombrar un negocio o mudarlo de subdominio. */
const updateTenantBody = z.object({
  name: z.string().min(2).max(80).optional(),
  slug: z.string().min(3).max(30).optional(),
});

/**
 * Contraseña de operador: 12 caracteres mínimo, igual que exige el CLI.
 *
 * El listón es más alto que el de los usuarios de un negocio (8) porque no protege una
 * caja: protege la cartera entera de clientes.
 */
const passwordOperador = z
  .string()
  .min(12, 'La contraseña del operador debe tener al menos 12 caracteres');

const perfilBody = z.object({
  name: z.string().min(2).max(80).optional(),
  email: z.string().email().max(200).optional(),
});

const cambioPasswordBody = z.object({
  actual: z.string().min(1, 'Escribe tu contraseña actual'),
  nueva: passwordOperador,
});

const nuevoOperadorBody = z.object({
  email: z.string().email().max(200),
  name: z.string().min(2).max(80),
  password: passwordOperador,
  isOwner: z.boolean().optional(),
});

const editarOperadorBody = z.object({
  name: z.string().min(2).max(80).optional(),
  isActive: z.boolean().optional(),
  isOwner: z.boolean().optional(),
  password: passwordOperador.optional(),
});

/**
 * Días que faltan para el próximo corte, y de qué corte se trata.
 *
 * Se calcula en el servidor y no en el navegador para que el panel cuente igual que
 * cuenta el API cuando decide bloquear: dos relojes distintos darían dos verdades, y
 * la que importa es la del servidor. Negativo = ya venció.
 */
function vencimiento(
  sub: { status: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null } | null,
) {
  if (!sub) return null;
  const enPrueba = sub.status === 'trial';
  const fecha = enPrueba ? sub.trialEndsAt : sub.currentPeriodEnd;
  if (!fecha) return null;
  // Se redondea hacia arriba: mientras quede una hora, queda "1 día". Truncar diría
  // "0 días" a alguien que todavía puede vender toda la tarde.
  const dias = Math.ceil((fecha.getTime() - Date.now()) / 86_400_000);
  return { concepto: enPrueba ? ('prueba' as const) : ('periodo' as const), fecha, dias };
}

/**
 * Contraseña temporal legible por teléfono: tres grupos de cuatro separados por guión.
 *
 * El alfabeto excluye lo que se confunde al dictarla (O/0, I/l/1, S/5). Quien la recibe
 * la va a copiar de un WhatsApp o la va a oír, y una contraseña que se transcribe mal
 * es una llamada más de soporte.
 */
const ALFABETO = 'ABCDEFGHJKLMNPQRTUVWXYZabcdefghjkmnpqrtuvwxyz2346789';
function contrasenaTemporal(): string {
  const grupo = () =>
    Array.from({ length: 4 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');
  return `${grupo()}-${grupo()}-${grupo()}`;
}

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
    rateLimit: { max: app.loginRateLimitMax, timeWindow: env.loginRateLimitWindow },
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
      data: {
        accessToken,
        admin: {
          sub: admin.id,
          email: admin.email,
          name: admin.name,
          isOwner: admin.isOwner,
        },
      },
      error: null,
    });
  });

  /**
   * Quién soy. Se relee de la base y no se devuelve el token tal cual: `isOwner` y la
   * baja de la cuenta tienen que poder cambiar sin esperar a que caduque la sesión de
   * 8 horas. Si el operador fue desactivado mientras tenía el panel abierto, aquí se
   * entera — y `soloPrincipal` le cierra la puerta en el mismo momento.
   */
  app.get('/platform/me', { preHandler: app.requirePlatform }, async (req, reply) => {
    const [yo] = await db
      .select({
        id: schema.platformAdmin.id,
        email: schema.platformAdmin.email,
        name: schema.platformAdmin.name,
        isOwner: schema.platformAdmin.isOwner,
        isActive: schema.platformAdmin.isActive,
      })
      .from(schema.platformAdmin)
      .where(eq(schema.platformAdmin.id, req.platformUser!.sub))
      .limit(1);

    if (!yo || !yo.isActive) {
      return reply.code(401).send({ data: null, error: 'No autorizado' });
    }
    return reply.send({
      data: { sub: yo.id, email: yo.email, name: yo.name, isOwner: yo.isOwner },
      error: null,
    });
  });

  // ── Mi cuenta ────────────────────────────────────────────────

  /** Cambiar mi nombre o mi correo (el correo ES el usuario con el que entro). */
  app.patch('/platform/me', { preHandler: app.requirePlatform }, async (req, reply) => {
    const parsed = perfilBody.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ data: null, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
    }
    const patch: Record<string, unknown> = {};
    if (parsed.data.name) patch.name = parsed.data.name.trim();
    if (parsed.data.email) {
      const email = parsed.data.email.toLowerCase().trim();
      const [ocupado] = await db
        .select({ id: schema.platformAdmin.id })
        .from(schema.platformAdmin)
        .where(
          and(
            eq(schema.platformAdmin.email, email),
            ne(schema.platformAdmin.id, req.platformUser!.sub),
          ),
        )
        .limit(1);
      if (ocupado) {
        return reply.code(409).send({ data: null, error: 'Ese correo ya es de otro operador' });
      }
      patch.email = email;
    }
    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({ data: null, error: 'No hay nada que cambiar' });
    }

    const [after] = await db
      .update(schema.platformAdmin)
      .set(patch)
      .where(eq(schema.platformAdmin.id, req.platformUser!.sub))
      .returning({
        id: schema.platformAdmin.id,
        email: schema.platformAdmin.email,
        name: schema.platformAdmin.name,
        isOwner: schema.platformAdmin.isOwner,
      });

    await registrar(req, { action: 'platform_profile_update', after });
    // El correo va dentro del token: si cambió, el que tiene en la mano quedó viejo.
    return reply.send({
      data: { ...after, sub: after!.id, reloguear: patch.email !== undefined },
      error: null,
    });
  });

  /**
   * Cambiar mi propia contraseña. Exige la actual: sin ese paso, un panel olvidado
   * abierto en un portátil ajeno se convierte en un cambio de dueño de la cuenta.
   */
  app.patch('/platform/me/password', { preHandler: app.requirePlatform }, async (req, reply) => {
    const parsed = cambioPasswordBody.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ data: null, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
    }

    const [yo] = await db
      .select()
      .from(schema.platformAdmin)
      .where(eq(schema.platformAdmin.id, req.platformUser!.sub))
      .limit(1);
    if (!yo || !(await argon2.verify(yo.passwordHash, parsed.data.actual))) {
      return reply.code(400).send({ data: null, error: 'La contraseña actual no es correcta' });
    }

    await db
      .update(schema.platformAdmin)
      .set({ passwordHash: await argon2.hash(parsed.data.nueva) })
      .where(eq(schema.platformAdmin.id, yo.id));

    await registrar(req, { action: 'platform_password_change' });
    return reply.send({ data: { ok: true }, error: null });
  });

  // ── Operadores de la plataforma ──────────────────────────────

  /**
   * Sólo el operador PRINCIPAL administra operadores.
   *
   * Se comprueba contra la base y no contra el token a propósito: el token dura 8 horas
   * y el rango puede cambiar antes. Quien fue degradado o dado de baja pierde el acceso
   * en la siguiente petición, no cuando le caduque la sesión.
   */
  const soloPrincipal = async (req: FastifyRequest, reply: FastifyReply) => {
    const [yo] = await db
      .select({ isOwner: schema.platformAdmin.isOwner, isActive: schema.platformAdmin.isActive })
      .from(schema.platformAdmin)
      .where(eq(schema.platformAdmin.id, req.platformUser!.sub))
      .limit(1);
    if (!yo || !yo.isActive) {
      return reply.code(401).send({ data: null, error: 'No autorizado' });
    }
    if (!yo.isOwner) {
      return reply
        .code(403)
        .send({ data: null, error: 'Sólo un operador principal puede administrar operadores' });
    }
  };

  /** Cuántos principales quedarían activos si a `excepto` le pasara lo que va a pasarle. */
  async function principalesActivos(excepto?: string): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(schema.platformAdmin)
      .where(
        and(
          eq(schema.platformAdmin.isOwner, true),
          eq(schema.platformAdmin.isActive, true),
          excepto ? ne(schema.platformAdmin.id, excepto) : undefined,
        ),
      );
    return row?.n ?? 0;
  }

  app.get(
    '/platform/admins',
    { preHandler: [app.requirePlatform, soloPrincipal] },
    async (_req, reply) => {
      const rows = await db
        .select({
          id: schema.platformAdmin.id,
          email: schema.platformAdmin.email,
          name: schema.platformAdmin.name,
          isOwner: schema.platformAdmin.isOwner,
          isActive: schema.platformAdmin.isActive,
          lastLoginAt: schema.platformAdmin.lastLoginAt,
          createdAt: schema.platformAdmin.createdAt,
        })
        .from(schema.platformAdmin)
        .orderBy(asc(schema.platformAdmin.name));
      return reply.send({ data: rows, error: null });
    },
  );

  app.post(
    '/platform/admins',
    { preHandler: [app.requirePlatform, soloPrincipal] },
    async (req, reply) => {
      const parsed = nuevoOperadorBody.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ data: null, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      }
      const email = parsed.data.email.toLowerCase().trim();

      const [existe] = await db
        .select({ id: schema.platformAdmin.id })
        .from(schema.platformAdmin)
        .where(eq(schema.platformAdmin.email, email))
        .limit(1);
      if (existe) {
        return reply.code(409).send({ data: null, error: 'Ya hay un operador con ese correo' });
      }

      const [creado] = await db
        .insert(schema.platformAdmin)
        .values({
          email,
          name: parsed.data.name.trim(),
          passwordHash: await argon2.hash(parsed.data.password),
          isOwner: parsed.data.isOwner ?? false,
        })
        .returning({
          id: schema.platformAdmin.id,
          email: schema.platformAdmin.email,
          name: schema.platformAdmin.name,
          isOwner: schema.platformAdmin.isOwner,
          isActive: schema.platformAdmin.isActive,
        });

      // La contraseña NO va a la bitácora: queda constancia del alta, no de la clave.
      await registrar(req, { action: 'platform_admin_create', after: creado });
      return reply.code(201).send({ data: creado, error: null });
    },
  );

  /**
   * Editar un operador: nombre, rango, alta/baja y contraseña.
   *
   * No hay borrado. Desactivar corta el acceso igual y conserva la bitácora: quién
   * suspendió a qué cliente tiene que seguir leyéndose años después, y un `admin_id`
   * huérfano contaría la mitad de la historia.
   */
  app.patch(
    '/platform/admins/:id',
    { preHandler: [app.requirePlatform, soloPrincipal] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = editarOperadorBody.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ data: null, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      }
      const d = parsed.data;
      const yoMismo = id === req.platformUser!.sub;

      const [before] = await db
        .select({
          id: schema.platformAdmin.id,
          email: schema.platformAdmin.email,
          name: schema.platformAdmin.name,
          isOwner: schema.platformAdmin.isOwner,
          isActive: schema.platformAdmin.isActive,
        })
        .from(schema.platformAdmin)
        .where(eq(schema.platformAdmin.id, id))
        .limit(1);
      if (!before) return reply.code(404).send({ data: null, error: 'Operador no encontrado' });

      // Desactivarse a sí mismo deja al operador fuera en la siguiente petición, con el
      // panel abierto y sin forma de deshacerlo. Es un accidente, no una intención.
      if (yoMismo && d.isActive === false) {
        return reply.code(400).send({ data: null, error: 'No puedes desactivar tu propia cuenta' });
      }
      // La contraseña propia se cambia en "Mi cuenta", que exige la actual. Si se
      // pudiera cambiar por aquí, esa comprobación no protegería de nada.
      if (yoMismo && d.password) {
        return reply
          .code(400)
          .send({ data: null, error: 'Cambia tu propia contraseña desde Mi cuenta' });
      }

      // Quedarse sin ningún principal activo deja la administración de operadores
      // cerrada para todos, y sólo se reabre entrando al servidor.
      const pierdeElRango = before.isOwner && (d.isOwner === false || d.isActive === false);
      if (pierdeElRango && (await principalesActivos(id)) === 0) {
        return reply.code(400).send({
          data: null,
          error: 'Es el único operador principal activo. Nombra otro principal antes.',
        });
      }

      const patch: Record<string, unknown> = {};
      if (d.name !== undefined) patch.name = d.name.trim();
      if (d.isActive !== undefined) patch.isActive = d.isActive;
      if (d.isOwner !== undefined) patch.isOwner = d.isOwner;
      if (d.password) patch.passwordHash = await argon2.hash(d.password);
      if (Object.keys(patch).length === 0) {
        return reply.code(400).send({ data: null, error: 'No hay nada que cambiar' });
      }

      const [after] = await db
        .update(schema.platformAdmin)
        .set(patch)
        .where(eq(schema.platformAdmin.id, id))
        .returning({
          id: schema.platformAdmin.id,
          email: schema.platformAdmin.email,
          name: schema.platformAdmin.name,
          isOwner: schema.platformAdmin.isOwner,
          isActive: schema.platformAdmin.isActive,
        });

      await registrar(req, {
        action: d.password ? 'platform_admin_password_reset' : 'platform_admin_update',
        before,
        after,
      });
      return reply.send({ data: after, error: null });
    },
  );

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
          ? or(
              ilike(schema.business.name, `%${filtro}%`),
              ilike(schema.business.slug, `%${filtro}%`),
            )
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
      return {
        ...r,
        status,
        blocked: status ? isBlocked(status) : false,
        // Cuánto le queda antes del próximo corte, ya calculado: es el dato por el que
        // se abre este panel un lunes por la mañana.
        vence: r.status
          ? vencimiento({
              status: r.status,
              trialEndsAt: r.trialEndsAt,
              currentPeriodEnd: r.currentPeriodEnd,
            })
          : null,
      };
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

    const status = sub
      ? effectiveStatus({ status: sub.status, trialEndsAt: sub.trialEndsAt })
      : null;

    return reply.send({
      data: {
        business: { id: biz.id, name: biz.name, slug: biz.slug, createdAt: biz.createdAt },
        subscription: sub ? { ...sub, status } : null,
        blocked: status ? isBlocked(status) : false,
        vence: vencimiento(sub ?? null),
        usage: uso,
      },
      error: null,
    });
  });

  /**
   * Renombrar un negocio o mudarlo de subdominio.
   *
   * El slug se cambia con el mismo cuidado que en el alta (formato y disponibilidad),
   * pero tiene una consecuencia que el alta no tiene: la dirección por la que el cliente
   * entra deja de existir en el acto. Por eso la respuesta devuelve la nueva URL, para
   * que el operador la pase, y el cambio queda en la bitácora con la anterior.
   */
  app.patch('/platform/tenants/:id', { preHandler: app.requirePlatform }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateTenantBody.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ data: null, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
    }

    const [before] = await db
      .select({ id: schema.business.id, name: schema.business.name, slug: schema.business.slug })
      .from(schema.business)
      .where(eq(schema.business.id, id))
      .limit(1);
    if (!before) return reply.code(404).send({ data: null, error: 'Negocio no encontrado' });

    const patch: Record<string, unknown> = {};
    if (parsed.data.name) patch.name = parsed.data.name.trim();
    if (parsed.data.slug && parsed.data.slug !== before.slug) {
      const slug = parsed.data.slug.toLowerCase().trim();
      const problema = validarSlug(slug);
      if (problema) return reply.code(400).send({ data: null, error: MENSAJE_SLUG[problema] });
      if (!(await slugDisponible(slug))) {
        return reply.code(409).send({ data: null, error: 'Esa dirección ya está ocupada' });
      }
      patch.slug = slug;
    }
    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({ data: null, error: 'No hay nada que cambiar' });
    }

    /**
     * El `slugDisponible()` de arriba y este UPDATE no son un solo acto.
     *
     * Entre la comprobación y la escritura cabe otro operador guardando el mismo slug, y
     * entonces esto reventaba con la violación de unicidad: un 500 en vez del 409 que ya
     * está previsto tres líneas más arriba. La comprobación previa se queda porque da el
     * mensaje bueno en el caso normal; esto es la red por debajo, que es la que de verdad
     * garantiza que no haya dos direcciones iguales.
     */
    let after;
    try {
      [after] = await db
        .update(schema.business)
        .set(patch)
        .where(eq(schema.business.id, id))
        .returning({
          id: schema.business.id,
          name: schema.business.name,
          slug: schema.business.slug,
        });
    } catch (e) {
      if (violaUnica(e, 'business_slug')) {
        return reply.code(409).send({ data: null, error: 'Esa dirección ya está ocupada' });
      }
      throw e;
    }

    await registrar(req, {
      action: 'tenant_update',
      businessId: id,
      businessName: after!.name,
      before,
      after,
    });
    return reply.send({
      data: { ...after, url: after!.slug ? urlDelNegocio(after!.slug) : null },
      error: null,
    });
  });

  // ── Soporte: usuarios de un negocio ──────────────────────────

  /**
   * Los usuarios de un negocio, para poder decirle a quien llama cuál era su usuario.
   *
   * Devuelve identidad y estado, nunca contraseñas ni datos de venta. Es lo mínimo para
   * dar soporte por teléfono: "tu usuario es julio, y sí, sigue activo".
   */
  app.get(
    '/platform/tenants/:id/users',
    { preHandler: app.requirePlatform },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [biz] = await db
        .select({ id: schema.business.id })
        .from(schema.business)
        .where(eq(schema.business.id, id))
        .limit(1);
      if (!biz) return reply.code(404).send({ data: null, error: 'Negocio no encontrado' });

      const rows = await withTenant(id, (tx) =>
        tx
          .select({
            id: schema.appUser.id,
            username: schema.appUser.username,
            name: schema.appUser.name,
            email: schema.appUser.email,
            role: schema.appUser.role,
            isActive: schema.appUser.isActive,
            emailVerifiedAt: schema.appUser.emailVerifiedAt,
            locationName: schema.location.name,
          })
          .from(schema.appUser)
          .leftJoin(schema.location, eq(schema.location.id, schema.appUser.locationId))
          .where(eq(schema.appUser.businessId, id))
          .orderBy(asc(schema.appUser.username)),
      );
      return reply.send({ data: rows, error: null });
    },
  );

  /**
   * Rescate: contraseña temporal para un usuario que perdió el acceso.
   *
   * La clave se devuelve UNA vez, en texto, para que el operador se la dicte por
   * teléfono a quien está llamando — que es exactamente el caso en el que hace falta:
   * alguien que ya no puede recibir el correo de "olvidé mi contraseña", o que nunca
   * verificó el suyo. Si tiene correo, además se le manda.
   *
   * Tres cosas que van juntas y no se pueden separar:
   *   · Se cierran TODAS sus sesiones. Si perdió el acceso porque alguien más entró,
   *     dejarle la sesión viva al otro convertiría el rescate en un regalo.
   *   · Queda en la bitácora de plataforma, con quién lo hizo y sobre quién.
   *   · La contraseña NO se guarda en la bitácora. Consta el hecho, no la clave.
   */
  app.post(
    '/platform/tenants/:id/users/:userId/password',
    { preHandler: app.requirePlatform },
    async (req, reply) => {
      const { id, userId } = req.params as { id: string; userId: string };

      const [biz] = await db
        .select({ id: schema.business.id, name: schema.business.name, slug: schema.business.slug })
        .from(schema.business)
        .where(eq(schema.business.id, id))
        .limit(1);
      if (!biz) return reply.code(404).send({ data: null, error: 'Negocio no encontrado' });

      const [usuario] = await withTenant(id, (tx) =>
        tx
          .select({
            id: schema.appUser.id,
            username: schema.appUser.username,
            name: schema.appUser.name,
            email: schema.appUser.email,
            role: schema.appUser.role,
            isActive: schema.appUser.isActive,
          })
          .from(schema.appUser)
          .where(and(eq(schema.appUser.id, userId), eq(schema.appUser.businessId, id)))
          .limit(1),
      );
      if (!usuario) return reply.code(404).send({ data: null, error: 'Usuario no encontrado' });

      const temporal = contrasenaTemporal();
      const passwordHash = await argon2.hash(temporal);
      await withTenant(id, (tx) =>
        tx.update(schema.appUser).set({ passwordHash }).where(eq(schema.appUser.id, usuario.id)),
      );
      await revocarTodo(id, usuario.id);

      let correoEnviado = false;
      if (usuario.email) {
        const url = biz.slug ? urlDelNegocio(biz.slug) : '';
        const envio = await enviarCorreo(
          {
            to: usuario.email,
            subject: `Nueva contraseña de acceso a ${biz.name}`,
            text:
              `Hola ${usuario.name}:\n\n` +
              `Te generamos una contraseña nueva para entrar a ${biz.name}.\n\n` +
              (url ? `Entra aquí: ${url}\n` : '') +
              `Usuario: ${usuario.username}\n` +
              `Contraseña temporal: ${temporal}\n\n` +
              `Cámbiala en cuanto entres, desde tu perfil.\n` +
              `Se cerraron todas tus sesiones abiertas.`,
          },
          req.log,
        );
        correoEnviado = envio.enviado;
      }

      await registrar(req, {
        action: 'tenant_user_password_reset',
        businessId: biz.id,
        businessName: biz.name,
        // Sin contraseña, ni antes ni después: la bitácora prueba el hecho, no la clave.
        after: {
          userId: usuario.id,
          username: usuario.username,
          role: usuario.role,
          correoEnviado,
        },
      });

      return reply.send({
        data: {
          username: usuario.username,
          tempPassword: temporal,
          correoEnviado,
          email: usuario.email,
          url: biz.slug ? urlDelNegocio(biz.slug) : null,
        },
        error: null,
      });
    },
  );

  /**
   * Cambiar plan o estado de un negocio: suspender, reactivar, subir de plan.
   *
   * Al terminar se invalida la caché de suscripción, así que el corte (o la
   * reactivación) es inmediato en vez de tardar hasta un minuto. Importa: cuando
   * reactivas a alguien que acaba de pagar, está mirando la pantalla.
   */
  /**
   * Y es del operador PRINCIPAL, no de cualquiera.
   *
   * Aquí se separan dos trabajos que compartían puerta. Dar soporte es ayudar a un cliente
   * a entrar, y para eso está el rescate de contraseña —que sigue abierto a cualquier
   * operador, porque atender el teléfono lo exige—. Suspender a un negocio o cambiarle el
   * plan no es ayudarle: es cortarle la venta o tocarle lo que paga. Eso es una decisión
   * comercial, y quien responde por ella es el principal.
   */
  app.patch(
    '/platform/tenants/:id/subscription',
    { preHandler: [app.requirePlatform, soloPrincipal] },
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
