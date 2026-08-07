import { schema, withTenant } from '@ventafacil/db';
import type { AuditAction, AuditEntity } from '@ventafacil/shared';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

export interface AuditEntry {
  /**
   * Tipadas contra la lista de `@ventafacil/shared`, no `string`.
   *
   * Con `string` el API podía emitir una acción que la pantalla no sabía traducir, y eso
   * fue exactamente lo que pasó: trece de las veintiuna salían crudas en la bitácora, que
   * es la única herramienta que tiene un dueño para vigilar a su gente. Ahora añadir una
   * acción sin ponerle nombre en español no compila.
   */
  action: AuditAction;
  entity: AuditEntity;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Toda mutacion pasa por aqui. business_id/user salen del token. */
    audit: (req: FastifyRequest, entry: AuditEntry) => Promise<void>;
  }
}

export const auditPlugin = fp(async (app) => {
  app.decorate('audit', async (req: FastifyRequest, entry: AuditEntry) => {
    const u = req.authUser;
    if (!u) return; // sin usuario autenticado no hay a quien auditar
    // audit_log tambien esta bajo RLS: sin contexto de tenant el INSERT es rechazado.
    await withTenant(u.businessId, (tx) =>
      tx.insert(schema.auditLog).values({
        businessId: u.businessId,
        userId: u.sub,
        locationId: u.locationId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        beforeJson: entry.before ?? null,
        afterJson: entry.after ?? null,
      }),
    );
  });
});
