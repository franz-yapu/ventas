import { db, schema } from '@ventafacil/db';
import { createLocationSchema } from '@ventafacil/shared';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';

export async function locationRoutes(app: FastifyInstance) {
  app.get('/locations', { preHandler: app.requireAuth }, async (req, reply) => {
    const rows = await db
      .select()
      .from(schema.location)
      .where(eq(schema.location.businessId, req.authUser!.businessId))
      .orderBy(asc(schema.location.name));
    return reply.send({ data: rows, error: null });
  });

  app.post('/locations', { preHandler: [app.requireAuth, app.requireAdmin] }, async (req, reply) => {
    const parsed = createLocationSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ data: null, error: 'Datos invalidos' });
    const [row] = await db
      .insert(schema.location)
      .values({ businessId: req.authUser!.businessId, ...parsed.data })
      .returning();
    await app.audit(req, { action: 'create', entity: 'location', entityId: row!.id, after: row });
    return reply.code(201).send({ data: row, error: null });
  });

  app.patch('/locations/:id', { preHandler: [app.requireAuth, app.requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = createLocationSchema
      .extend({ isActive: z.boolean() })
      .partial()
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ data: null, error: 'Datos invalidos' });
    const [row] = await db
      .update(schema.location)
      .set(parsed.data)
      .where(and(eq(schema.location.id, id), eq(schema.location.businessId, req.authUser!.businessId)))
      .returning();
    if (!row) return reply.code(404).send({ data: null, error: 'Ubicacion no encontrada' });
    await app.audit(req, { action: 'update', entity: 'location', entityId: id, after: row });
    return reply.send({ data: row, error: null });
  });
}
