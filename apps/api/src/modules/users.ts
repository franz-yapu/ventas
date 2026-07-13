import { db, schema } from '@ventafacil/db';
import { createUserSchema } from '@ventafacil/shared';
import argon2 from 'argon2';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';

export async function userRoutes(app: FastifyInstance) {
  // Lista usuarios (sin exponer el hash de contraseña).
  app.get('/users', { preHandler: [app.requireAuth, app.requireAdmin] }, async (req, reply) => {
    const rows = await db
      .select({
        id: schema.appUser.id,
        name: schema.appUser.name,
        username: schema.appUser.username,
        role: schema.appUser.role,
        locationId: schema.appUser.locationId,
        isActive: schema.appUser.isActive,
      })
      .from(schema.appUser)
      .where(eq(schema.appUser.businessId, req.authUser!.businessId))
      .orderBy(asc(schema.appUser.name));
    return reply.send({ data: rows, error: null });
  });

  app.post('/users', { preHandler: [app.requireAuth, app.requireAdmin] }, async (req, reply) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ data: null, error: parsed.error.issues[0]?.message });
    }
    const businessId = req.authUser!.businessId;
    const passwordHash = await argon2.hash(parsed.data.password);
    try {
      const [row] = await db
        .insert(schema.appUser)
        .values({
          businessId,
          name: parsed.data.name,
          username: parsed.data.username,
          passwordHash,
          role: parsed.data.role,
          locationId: parsed.data.locationId ?? null,
        })
        .returning({
          id: schema.appUser.id,
          name: schema.appUser.name,
          username: schema.appUser.username,
          role: schema.appUser.role,
          locationId: schema.appUser.locationId,
          isActive: schema.appUser.isActive,
        });
      await app.audit(req, { action: 'create', entity: 'app_user', entityId: row!.id, after: row });
      return reply.code(201).send({ data: row, error: null });
    } catch (e) {
      if (String(e).includes('app_user_business_username_uq')) {
        return reply.code(409).send({ data: null, error: 'Ese usuario ya existe' });
      }
      throw e;
    }
  });

  app.patch('/users/:id', { preHandler: [app.requireAuth, app.requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z
      .object({
        name: z.string().min(1).optional(),
        password: z.string().min(6).optional(),
        role: z.enum(['admin', 'seller']).optional(),
        locationId: z.string().uuid().nullable().optional(),
        isActive: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ data: null, error: 'Datos invalidos' });

    const patch: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.password) {
      patch.passwordHash = await argon2.hash(parsed.data.password);
      delete patch.password;
    }
    const [row] = await db
      .update(schema.appUser)
      .set(patch)
      .where(and(eq(schema.appUser.id, id), eq(schema.appUser.businessId, req.authUser!.businessId)))
      .returning({
        id: schema.appUser.id,
        name: schema.appUser.name,
        username: schema.appUser.username,
        role: schema.appUser.role,
        locationId: schema.appUser.locationId,
        isActive: schema.appUser.isActive,
      });
    if (!row) return reply.code(404).send({ data: null, error: 'Usuario no encontrado' });
    await app.audit(req, { action: 'update', entity: 'app_user', entityId: id, after: row });
    return reply.send({ data: row, error: null });
  });
}
