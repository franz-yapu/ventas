/**
 * Planes y suscripciones — la capa de negocio del SaaS.
 *
 * Se cobra POR NEGOCIO con límites incluidos (no por sucursal ni por usuario): un
 * precio fijo al mes y un cupo de sucursales, usuarios y productos. Es lo más simple
 * de explicar al cliente y lo más simple de cobrar.
 *
 * Este archivo es la ÚNICA fuente de verdad del catálogo. La tabla `plan` de la base
 * se siembra desde aquí (`pnpm --filter @ventafacil/db seed-plans`), así que cambiar
 * un precio o un límite es cambiar este archivo y volver a sembrar.
 */

export const PLAN_CODES = ['basico', 'pro', 'ilimitado', 'propietario'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

/**
 * Estados de la suscripción.
 *
 *   trial      — periodo de prueba, opera con normalidad.
 *   active     — al día.
 *   past_due   — morosa: SIGUE OPERANDO. Un POS que deja de vender por un pago
 *                atrasado le cuesta al cliente su día de caja y a ti el cliente.
 *                Se avisa con un banner y se persigue el cobro (dunning, #11).
 *   suspended  — cortada por falta de pago o por decisión de la plataforma.
 *   cancelled  — el cliente se fue.
 */
export const SUBSCRIPTION_STATUS = [
  'trial',
  'active',
  'past_due',
  'suspended',
  'cancelled',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[number];

/**
 * Funciones que se activan por plan. Sólo se listan las que corresponden a una
 * pantalla real; inventar llaves para funciones que no existen sólo genera gating
 * decorativo.
 */
export const PLAN_FEATURES = ['reportes_avanzados', 'auditoria'] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

/** Recursos con cupo por plan. `null` en el plan = sin límite. */
export const LIMIT_KEYS = ['locations', 'users', 'products'] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

/** Nombre en plural de cada cupo, para títulos y listas. */
export const LIMIT_LABELS: Record<LimitKey, string> = {
  locations: 'sucursales',
  users: 'usuarios',
  products: 'productos',
};

const LIMIT_LABELS_SINGULAR: Record<LimitKey, string> = {
  locations: 'sucursal',
  users: 'usuario',
  products: 'producto',
};

/** "1 sucursal" / "3 sucursales". El plan Básico permite justo 1, así que se nota. */
export function limitLabel(key: LimitKey, n: number): string {
  return n === 1 ? LIMIT_LABELS_SINGULAR[key] : LIMIT_LABELS[key];
}

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  /** Precio mensual como string decimal (nunca float). */
  priceMonthly: string;
  currency: string;
  description: string;
  maxLocations: number | null;
  maxUsers: number | null;
  maxProducts: number | null;
  features: PlanFeature[];
  /** Los planes no públicos no se muestran en la página de precios ni en el alta. */
  isPublic: boolean;
  sortOrder: number;
}

/** Días de prueba gratis al registrarse. */
export const TRIAL_DAYS = 14;

/** Plan con el que arranca un negocio que se registra solo. */
export const DEFAULT_PLAN_CODE: PlanCode = 'basico';

/**
 * Catálogo. Los PRECIOS son una decisión de negocio y se ajustan aquí; el resto del
 * código no tiene ni un número escrito a mano.
 */
export const PLAN_CATALOG: PlanDefinition[] = [
  {
    code: 'basico',
    name: 'Básico',
    priceMonthly: '149.00',
    currency: 'BOB',
    description: 'Para un negocio con una sola tienda.',
    maxLocations: 1,
    maxUsers: 3,
    maxProducts: 500,
    // La bitácora entra en TODOS los planes. Es el único control que tiene un dueño
    // para detectar un descuento raro de un empleado, y el plan Básico es justo el del
    // negocio con empleados. Cobrar por eso sería vender la cerradura aparte de la
    // puerta. Pro se diferencia por el panel de análisis, que sí es un extra.
    features: ['auditoria'],
    isPublic: true,
    sortOrder: 1,
  },
  {
    code: 'pro',
    name: 'Pro',
    priceMonthly: '299.00',
    currency: 'BOB',
    description: 'Varias sucursales, con panel de análisis y bitácora de actividad.',
    maxLocations: 3,
    maxUsers: 10,
    maxProducts: 5000,
    features: ['reportes_avanzados', 'auditoria'],
    isPublic: true,
    sortOrder: 2,
  },
  {
    code: 'ilimitado',
    name: 'Ilimitado',
    priceMonthly: '599.00',
    currency: 'BOB',
    description: 'Sin límites de sucursales, usuarios ni productos.',
    maxLocations: null,
    maxUsers: null,
    maxProducts: null,
    features: ['reportes_avanzados', 'auditoria'],
    isPublic: true,
    sortOrder: 3,
  },
  {
    /**
     * Plan interno para los negocios que ya usaban VentaFácil antes del SaaS. No se
     * vende, no se muestra y no caduca: el paso a SaaS tiene que ser invisible para
     * quien ya estaba pagando por otra vía.
     */
    code: 'propietario',
    name: 'Propietario',
    priceMonthly: '0.00',
    currency: 'BOB',
    description: 'Plan interno, sin límites. No se vende.',
    maxLocations: null,
    maxUsers: null,
    maxProducts: null,
    features: ['reportes_avanzados', 'auditoria'],
    isPublic: false,
    sortOrder: 99,
  },
];

export function planByCode(code: string): PlanDefinition | undefined {
  return PLAN_CATALOG.find((p) => p.code === code);
}

// ── Estado efectivo ────────────────────────────────────────────

/**
 * `trial_expired` no se guarda en la base: se deduce comparando `trialEndsAt` con la
 * fecha actual. Guardarlo obligaría a un cron que marque las pruebas vencidas, y un
 * cron que no corre un día deja entrar gratis a todo el mundo.
 */
export type EffectiveStatus = SubscriptionStatus | 'trial_expired';

export interface SubscriptionLike {
  status: SubscriptionStatus;
  trialEndsAt: string | Date | null;
}

export function effectiveStatus(sub: SubscriptionLike, now: Date = new Date()): EffectiveStatus {
  if (sub.status !== 'trial') return sub.status;
  if (!sub.trialEndsAt) return 'trial';
  const ends = sub.trialEndsAt instanceof Date ? sub.trialEndsAt : new Date(sub.trialEndsAt);
  return ends.getTime() < now.getTime() ? 'trial_expired' : 'trial';
}

/** Estados que NO dejan operar. Todo lo demás vende con normalidad. */
const BLOQUEADOS: EffectiveStatus[] = ['trial_expired', 'suspended', 'cancelled'];

export function isBlocked(status: EffectiveStatus): boolean {
  return BLOQUEADOS.includes(status);
}

/** Mensaje para la persona que está frente a la caja, no para el programador. */
export function blockedMessage(status: EffectiveStatus): string {
  switch (status) {
    case 'trial_expired':
      return 'Tu periodo de prueba terminó. Elige un plan para seguir vendiendo.';
    case 'suspended':
      return 'Tu cuenta está suspendida por falta de pago. Regulariza el pago para reactivarla.';
    case 'cancelled':
      return 'Tu suscripción fue cancelada. Contáctanos si quieres volver.';
    default:
      return 'Tu suscripción no está activa.';
  }
}

/**
 * Días que faltan para que termine la prueba; negativo si ya terminó, `null` si el
 * negocio no está en prueba. Recibe la fecha suelta a propósito: se usa tanto donde
 * hay una suscripción completa como donde sólo llegó la fecha por la API.
 */
export function trialDaysLeft(
  trialEndsAt: string | Date | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!trialEndsAt) return null;
  const ends = trialEndsAt instanceof Date ? trialEndsAt : new Date(trialEndsAt);
  return Math.ceil((ends.getTime() - now.getTime()) / 86_400_000);
}
