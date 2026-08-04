import { db, schema, withTenant } from '@ventafacil/db';
import {
  API_PREFIX,
  blockedMessage,
  effectiveStatus,
  isBlocked,
  limitLabel,
  type EffectiveStatus,
  type LimitKey,
  type PlanFeature,
} from '@ventafacil/shared';
import { and, count, eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Suscripción del negocio: qué plan tiene, si puede operar y qué cupos le quedan.
 *
 * `plan` y `subscription` están FUERA de RLS (son datos de plataforma), así que se
 * consultan con el `db` global filtrando por el negocio del token — el mismo patrón
 * que `business.ts`.
 */

export interface TenantAccess {
  businessId: string;
  /** null = el negocio no tiene suscripción. Ver `cargarAcceso`. */
  plan: {
    code: string;
    name: string;
    description: string;
    priceMonthly: string;
    currency: string;
    maxLocations: number | null;
    maxUsers: number | null;
    maxProducts: number | null;
    features: PlanFeature[];
  } | null;
  subscription: {
    status: EffectiveStatus;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
    suspendedReason: string | null;
  } | null;
  blocked: boolean;
}

// ── Caché en proceso ───────────────────────────────────────────
//
// El estado de la suscripción se consulta en CADA petición autenticada. Sin caché,
// eso es una consulta extra por venta, por listado y por búsqueda de producto, sobre
// un VPS de 1 vCPU. Con 60 s de vida, suspender a un tenant tarda como mucho un
// minuto en surtir efecto, y las escrituras invalidan la entrada al instante.
const TTL_MS = 60_000;
const cache = new Map<string, { value: TenantAccess; expiresAt: number }>();

export function invalidateAccess(businessId: string) {
  cache.delete(businessId);
}

/** Sólo para los tests: deja la caché en blanco entre casos. */
export function clearAccessCache() {
  cache.clear();
}

async function leerAcceso(businessId: string): Promise<TenantAccess> {
  const [row] = await db
    .select({
      status: schema.subscription.status,
      trialEndsAt: schema.subscription.trialEndsAt,
      currentPeriodEnd: schema.subscription.currentPeriodEnd,
      suspendedReason: schema.subscription.suspendedReason,
      code: schema.plan.code,
      name: schema.plan.name,
      description: schema.plan.description,
      priceMonthly: schema.plan.priceMonthly,
      currency: schema.plan.currency,
      maxLocations: schema.plan.maxLocations,
      maxUsers: schema.plan.maxUsers,
      maxProducts: schema.plan.maxProducts,
      features: schema.plan.features,
    })
    .from(schema.subscription)
    .innerJoin(schema.plan, eq(schema.plan.code, schema.subscription.planCode))
    .where(eq(schema.subscription.businessId, businessId))
    .limit(1);

  // Sin fila de suscripción el negocio opera SIN restricciones, a propósito.
  //
  // Es la decisión menos mala: un negocio anterior al SaaS, o un fallo al crear la
  // suscripción, dejarían la caja sin poder vender. En un POS eso es el día de
  // trabajo del cliente. `seed-plans` da de alta a todo negocio que no tenga
  // suscripción, así que en la práctica esto no debería ocurrir nunca.
  if (!row) {
    return { businessId, plan: null, subscription: null, blocked: false };
  }

  const status = effectiveStatus({ status: row.status, trialEndsAt: row.trialEndsAt });
  return {
    businessId,
    plan: {
      code: row.code,
      name: row.name,
      description: row.description,
      priceMonthly: row.priceMonthly,
      currency: row.currency,
      maxLocations: row.maxLocations,
      maxUsers: row.maxUsers,
      maxProducts: row.maxProducts,
      features: (row.features ?? []) as PlanFeature[],
    },
    subscription: {
      status,
      trialEndsAt: row.trialEndsAt,
      currentPeriodEnd: row.currentPeriodEnd,
      suspendedReason: row.suspendedReason,
    },
    blocked: isBlocked(status),
  };
}

export async function cargarAcceso(businessId: string): Promise<TenantAccess> {
  const hit = cache.get(businessId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await leerAcceso(businessId);
  cache.set(businessId, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

// ── Puerta de entrada ──────────────────────────────────────────

/**
 * Rutas que un negocio bloqueado SIGUE pudiendo usar: son justamente las que
 * necesita para enterarse de que está bloqueado y arreglarlo. Sin ellas la app
 * mostraría una pantalla en blanco en vez de "tu prueba terminó, elige un plan".
 */
const RUTAS_LIBRES = new Set(
  ['/auth/me', '/auth/login', '/auth/refresh', '/subscription/me', '/plans', '/business/me'].map(
    (r) => API_PREFIX + r,
  ),
);

export function hasFeature(access: TenantAccess, feature: PlanFeature): boolean {
  // Sin plan (negocio anterior al SaaS): todo habilitado.
  if (!access.plan) return true;
  return access.plan.features.includes(feature);
}

/**
 * Corta la petición si la suscripción no permite operar. Se llama desde `requireAuth`,
 * así que cubre toda ruta autenticada sin tener que acordarse de añadirla una por una.
 *
 * Devuelve 402 (Payment Required) y no 401/403 a propósito: el frontend refresca el
 * token ante un 401 y cierra sesión si falla. Un 402 no se confunde con eso, así que
 * la persona ve la pantalla de "renueva tu plan" en vez de que la echen al login.
 */
export async function gateSubscription(req: FastifyRequest, reply: FastifyReply) {
  const businessId = req.authUser?.businessId;
  if (!businessId) return;

  const url = req.routeOptions?.url;
  if (url && RUTAS_LIBRES.has(url)) return;

  const access = await cargarAcceso(businessId);
  if (!access.blocked) return;

  const status = access.subscription!.status;
  return reply.code(402).send({
    data: null,
    error: blockedMessage(status),
    code: 'subscription_blocked',
    status,
  });
}

// ── Límites del plan ───────────────────────────────────────────

/** Cuenta lo que hay HOY del recurso. Sólo cuenta lo activo: desactivar libera cupo. */
async function usoActual(businessId: string, key: LimitKey): Promise<number> {
  return withTenant(businessId, async (tx) => {
    if (key === 'locations') {
      const [r] = await tx
        .select({ n: count() })
        .from(schema.location)
        .where(
          and(eq(schema.location.businessId, businessId), eq(schema.location.isActive, true)),
        );
      return r?.n ?? 0;
    }
    if (key === 'users') {
      const [r] = await tx
        .select({ n: count() })
        .from(schema.appUser)
        .where(and(eq(schema.appUser.businessId, businessId), eq(schema.appUser.isActive, true)));
      return r?.n ?? 0;
    }
    const [r] = await tx
      .select({ n: count() })
      .from(schema.product)
      .where(and(eq(schema.product.businessId, businessId), eq(schema.product.isActive, true)));
    return r?.n ?? 0;
  });
}

export function limiteDe(access: TenantAccess, key: LimitKey): number | null {
  if (!access.plan) return null;
  if (key === 'locations') return access.plan.maxLocations;
  if (key === 'users') return access.plan.maxUsers;
  return access.plan.maxProducts;
}

/** Uso y cupo de los tres recursos, para pintarlos en la app. */
export async function usoDelPlan(access: TenantAccess) {
  const [locations, users, products] = await Promise.all([
    usoActual(access.businessId, 'locations'),
    usoActual(access.businessId, 'users'),
    usoActual(access.businessId, 'products'),
  ]);
  return {
    locations: { used: locations, limit: limiteDe(access, 'locations') },
    users: { used: users, limit: limiteDe(access, 'users') },
    products: { used: products, limit: limiteDe(access, 'products') },
  };
}

/**
 * Comprueba que quepa uno más antes de crearlo. Si no cabe, contesta 402 con el
 * cupo concreto y devuelve `false` para que el handler corte.
 *
 * Se llama ANTES de insertar, no dentro de la transacción: dos altas simultáneas al
 * borde del cupo podrían colarse. Es aceptable — el peor caso es un usuario de más
 * en un plan, no una fuga de datos — y evita bloquear filas en el camino caliente.
 */
export async function permiteCrear(
  businessId: string,
  key: LimitKey,
  reply: FastifyReply,
): Promise<boolean> {
  const access = await cargarAcceso(businessId);
  const limite = limiteDe(access, key);
  if (limite === null) return true;

  const usado = await usoActual(businessId, key);
  if (usado < limite) return true;

  reply.code(402).send({
    data: null,
    error:
      `Tu plan ${access.plan!.name} permite hasta ${limite} ${limitLabel(key, limite)}. ` +
      `Cambia de plan para agregar más.`,
    code: 'plan_limit',
    limit: { key, used: usado, max: limite },
  });
  return false;
}
