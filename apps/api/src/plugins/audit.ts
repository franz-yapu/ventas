import { schema, withTenant } from '@ventafacil/db';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

export interface AuditEntry {
  action: string;
  entity: string;
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
