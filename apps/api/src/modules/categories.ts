import { db, schema } from '@ventafacil/db';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';

export async function categoryRoutes(app: FastifyInstance) {
  app.get('/categories', { preHandler: app.requireAuth }, async (req, reply) => {
    const rows = await db
      .select()
      .from(schema.category)
      .where(eq(schema.category.businessId, req.authUser!.businessId))
      .orderBy(asc(schema.category.name));
    return reply.send({ data: rows, error: null });
  });

  app.post('/categories', { preHandler: [app.requireAuth, app.requireAdmin] }, async (req, reply) => {
    const parsed = z.object({ name: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ data: null, error: 'Nombre requerido' });
    const [row] = await db
      .insert(schema.category)
      .values({ businessId: req.authUser!.businessId, name: parsed.data.name })
      .returning();
    await app.audit(req, { action: 'create', entity: 'category', entityId: row!.id, after: row });
    return reply.code(201).send({ data: row, error: null });
  });

  app.delete('/categories/:id', { preHandler: [app.requireAuth, app.requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    // El filtro por negocio ya impide borrar categorías ajenas, pero hay que MIRAR el
    // resultado: sin esto la respuesta era 200 {ok:true} aunque no se borrara nada, y
    // se auditaba un borrado que nunca ocurrió (con el id de otro negocio en el log).
    const deleted = await db
      .delete(schema.category)
      .where(and(eq(schema.category.id, id), eq(schema.category.businessId, req.authUser!.businessId)))
      .returning({ id: schema.category.id });

    if (deleted.length === 0) {
      return reply.code(404).send({ data: null, error: 'Categoría no encontrada' });
    }
    await app.audit(req, { action: 'delete', entity: 'category', entityId: id });
    return reply.send({ data: { ok: true }, error: null });
  });
}
