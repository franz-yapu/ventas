import { DEFAULT_PLAN_CODE, TERMS_VERSION, TRIAL_DAYS } from '@ventafacil/shared';
import { eq } from 'drizzle-orm';
import { db } from './client.js';
import * as s from './schema.js';
import { withTenant } from './tenant.js';

export interface NuevoNegocio {
  name: string;
  slug: string;
  adminName: string;
  adminUsername: string;
  /** Ya hasheada. Aquí no se hashea nada: quien llama decide con qué. */
  adminPasswordHash: string;
  adminEmail?: string | null;
  /** Plan de arranque. Por defecto, el de prueba. */
  planCode?: string;
  /**
   * Si se aceptaron los términos en el alta. El CLI no los acepta por nadie: crear un
   * negocio desde consola es una operación interna, no una aceptación del cliente.
   */
  aceptaTerminos?: boolean;
}

export interface NegocioCreado {
  businessId: string;
  locationId: string;
  adminId: string;
}

/**
 * Da de alta un negocio completo: negocio, suscripción de prueba, contador de recibos,
 * sucursal central y usuario administrador.
 *
 * Es la MISMA función que usan el CLI (`pnpm new-tenant`) y el registro self-service
 * del API. Tener dos implementaciones de esto era pedir que una se quedara atrás y
 * creara negocios a medias — sin contador de recibos, por ejemplo, con lo que la
 * primera venta fallaría.
 *
 * El ORDEN importa con RLS activo, y lo estará en producción:
 *
 *   1. `business` y `subscription` van FUERA de RLS -> se insertan sin contexto.
 *   2. El resto está bajo RLS con FORCE -> hay que fijar el negocio en la transacción
 *      o Postgres rechaza el insert. El registro corre con el rol de la aplicación,
 *      que no es superusuario, así que aquí no hay red de seguridad.
 */
export async function crearNegocio(input: NuevoNegocio): Promise<NegocioCreado> {
  const planCode = input.planCode ?? DEFAULT_PLAN_CODE;

  // Sin catálogo de planes la clave foránea fallaría con un error de Postgres poco útil.
  const [plan] = await db
    .select({ code: s.plan.code })
    .from(s.plan)
    .where(eq(s.plan.code, planCode))
    .limit(1);
  if (!plan) {
    throw new Error(
      `No existe el plan "${planCode}". Corre: pnpm --filter @ventafacil/db seed-plans`,
    );
  }

  const [biz] = await db
    .insert(s.business)
    .values({
      name: input.name,
      slug: input.slug,
      termsAcceptedAt: input.aceptaTerminos ? new Date() : null,
      termsVersion: input.aceptaTerminos ? TERMS_VERSION : null,
    })
    .returning();
  const businessId = biz!.id;

  await db.insert(s.subscription).values({
    businessId,
    planCode,
    status: 'trial',
    trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
  });

  return withTenant(businessId, async (tx) => {
    await tx.insert(s.businessCounter).values({ businessId, lastReceiptNumber: 0 });
    // Sucursal central por defecto: sin ella el negocio no puede vender.
    const [loc] = await tx
      .insert(s.location)
      .values({ businessId, name: 'Principal', isCentral: true })
      .returning();
    const [admin] = await tx
      .insert(s.appUser)
      .values({
        businessId,
        locationId: loc!.id,
        name: input.adminName,
        username: input.adminUsername,
        email: input.adminEmail ?? null,
        passwordHash: input.adminPasswordHash,
        role: 'admin',
      })
      .returning();
    return { businessId, locationId: loc!.id, adminId: admin!.id };
  });
}

/** ¿Está libre ese subdominio? Sólo mira la base; el formato se valida aparte. */
export async function slugDisponible(slug: string): Promise<boolean> {
  const [existe] = await db
    .select({ id: s.business.id })
    .from(s.business)
    .where(eq(s.business.slug, slug))
    .limit(1);
  return !existe;
}
