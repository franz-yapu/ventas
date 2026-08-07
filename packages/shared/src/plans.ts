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

// ── Ciclos de contratación ─────────────────────────────────────

/**
 * Contratar por más tiempo sale más barato, como en el hosting.
 *
 * El descuento no es generosidad: es a cambio de que el cliente se comprometa y de
 * cobrar por adelantado. Por eso viene con una regla de devolución, y por eso esa regla
 * se enseña ANTES de firmar y no en un anexo.
 */
export interface CicloDefinition {
  /** Meses que se contratan de una vez. */
  meses: number;
  /** Cómo se llama en pantalla. */
  nombre: string;
  /** Descuento sobre el precio mensual, en porcentaje entero. */
  descuentoPct: number;
}

export const CICLOS: CicloDefinition[] = [
  { meses: 1, nombre: 'Mensual', descuentoPct: 0 },
  { meses: 12, nombre: '1 año', descuentoPct: 10 },
  { meses: 24, nombre: '2 años', descuentoPct: 15 },
  { meses: 36, nombre: '3 años', descuentoPct: 20 },
  { meses: 60, nombre: '5 años', descuentoPct: 30 },
];

export function cicloDeMeses(meses: number): CicloDefinition | undefined {
  return CICLOS.find((c) => c.meses === meses);
}

/**
 * Qué se paga por contratar `meses` de un plan, y cuánto se ahorra.
 *
 * Todo en céntimos internamente y devuelto como string decimal: nunca float. Un
 * redondeo de medio céntimo repetido sesenta veces es un descuadre que después nadie
 * sabe de dónde salió.
 */
export function cotizar(
  precioMensual: string,
  meses: number,
): { meses: number; descuentoPct: number; sinDescuento: string; total: string; ahorro: string } {
  const ciclo = cicloDeMeses(meses) ?? CICLOS[0]!;
  const centavosMes = Math.round(Number(precioMensual) * 100);
  const bruto = centavosMes * ciclo.meses;
  const total = Math.round((bruto * (100 - ciclo.descuentoPct)) / 100);
  return {
    meses: ciclo.meses,
    descuentoPct: ciclo.descuentoPct,
    sinDescuento: (bruto / 100).toFixed(2),
    total: (total / 100).toFixed(2),
    ahorro: ((bruto - total) / 100).toFixed(2),
  };
}

/**
 * Qué se devuelve si el cliente se va antes de terminar el ciclo.
 *
 * **Sobre el tiempo NO usado se devuelve la mitad.** Es la regla que fijó el negocio, y
 * la razón de que sea la mitad y no todo es que el descuento se dio por adelantado a
 * cambio de la permanencia: devolver el 100% convertiría el plan de 5 años en un plan
 * mensual con descuento, que es exactamente lo que no es.
 *
 * El ejemplo que hay que poder responder sin dudar: paga 5 años, se va a los 2. Quedan
 * 3 sin usar, y se le devuelve la mitad de esos 3.
 *
 * Se cuenta por MESES CUMPLIDOS y hacia abajo, no por días. Dos motivos:
 *
 * 1. Se puede decir en voz alta: "contrataste 60, usaste 24, quedan 36 sin usar y te
 *    devolvemos la mitad de esos 36". Con días de por medio hace falta una hoja de
 *    cálculo y la conversación se convierte en una discusión.
 * 2. Redondear hacia abajo le da el margen al CLIENTE. Quien lleva 24 meses y 20 días
 *    cuenta como 24, no como 25. Es una diferencia pequeña y siempre a favor de quien se
 *    está yendo, que es exactamente cuando no conviene discutir por céntimos — y evita el
 *    absurdo contrario: contratar y arrepentirse el mismo día costaría un mes entero.
 */
export const PORCENTAJE_DEVOLUCION = 50;

export function calcularDevolucion(
  totalPagado: string,
  mesesContratados: number,
  mesesUsados: number,
): { mesesSinUsar: number; proporcional: string; devolucion: string } {
  const usados = Math.min(Math.max(0, Math.floor(mesesUsados)), mesesContratados);
  const sinUsar = mesesContratados - usados;
  const centavos = Math.round(Number(totalPagado) * 100);
  const proporcional = Math.round((centavos * sinUsar) / mesesContratados);
  const devolucion = Math.round((proporcional * PORCENTAJE_DEVOLUCION) / 100);
  return {
    mesesSinUsar: sinUsar,
    proporcional: (proporcional / 100).toFixed(2),
    devolucion: (devolucion / 100).toFixed(2),
  };
}

/**
 * El texto que se enseña ANTES de contratar. No es letra pequeña: va en la pantalla.
 *
 * Un descuento por 5 años es dinero cobrado por adelantado con una obligación de 5 años
 * detrás. Quien firma tiene que saber qué pasa si cambia de idea, y tiene que saberlo
 * antes — no cuando llame para irse.
 */
export function avisoDePermanencia(meses: number): string | null {
  if (meses <= 1) return null;
  const años = meses / 12;
  const cuanto = años >= 1 ? `${años} ${años === 1 ? 'año' : 'años'}` : `${meses} meses`;
  return (
    `Estás contratando ${cuanto} por adelantado. Si decides irte antes de terminar, ` +
    `se te devuelve el ${PORCENTAJE_DEVOLUCION}% de lo que quede sin usar. ` +
    `Ejemplo: si contratas 5 años y te vas a los 2, quedan 3 sin usar y se te devuelve ` +
    `la mitad de esos 3.`
  );
}
