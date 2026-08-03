import { db, schema } from '@ventafacil/db';
import { productSchemaJson, themeSchema } from '@ventafacil/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';

const businessSelect = {
  id: schema.business.id,
  name: schema.business.name,
  logoUrl: schema.business.logoUrl,
  theme: schema.business.themeJson,
  texts: schema.business.textsJson,
  productSchema: schema.business.productSchemaJson,
  currency: schema.business.currency,
  taxRate: schema.business.taxRate,
};

// El logo se guarda como data URI (base64). Límite razonable para no inflar la BD/respuestas.
const updateBusinessSchema = z.object({
  name: z.string().min(1).optional(),
  logoUrl: z.string().max(400_000).nullable().optional(),
  theme: themeSchema.optional(),
  texts: z.record(z.string()).optional(),
  productSchema: productSchemaJson.optional(),
  currency: z.string().min(2).max(8).optional(),
  // Tasa de impuesto: numeric(6,4) en BD -> admite hasta 4 decimales.
  taxRate: z
    .string()
    .regex(/^-?\d+(\.\d{1,4})?$/, 'Tasa inválida')
    .optional(),
});

export async function businessRoutes(app: FastifyInstance) {
  // GET /business/me -> config white-label del negocio del token (tema, textos, rubro).
  app.get('/business/me', { preHandler: app.requireAuth }, async (req, reply) => {
    const [biz] = await db
      .select(businessSelect)
      .from(schema.business)
      .where(eq(schema.business.id, req.authUser!.businessId))
      .limit(1);

    if (!biz) return reply.code(404).send({ data: null, error: 'Negocio no encontrado' });
    return reply.send({ data: biz, error: null });
  });

  // PATCH /business (admin) -> configuración white-label. Auditado (incluye cambio de tema).
  app.patch(
    '/business',
    { preHandler: [app.requireAuth, app.requireAdmin] },
    async (req, reply) => {
      const parsed = updateBusinessSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ data: null, error: parsed.error.issues[0]?.message });
      }
      const businessId = req.authUser!.businessId;

      const [before] = await db
        .select(businessSelect)
        .from(schema.business)
        .where(eq(schema.business.id, businessId))
        .limit(1);

      const patch: Record<string, unknown> = {};
      const d = parsed.data;
      if (d.name !== undefined) patch.name = d.name;
      if (d.logoUrl !== undefined) patch.logoUrl = d.logoUrl;
      if (d.theme !== undefined) patch.themeJson = d.theme;
      if (d.texts !== undefined) patch.textsJson = d.texts;
      if (d.productSchema !== undefined) patch.productSchemaJson = d.productSchema;
      if (d.currency !== undefined) patch.currency = d.currency;
      if (d.taxRate !== undefined) patch.taxRate = d.taxRate;

      const [after] = await db
        .update(schema.business)
        .set(patch)
        .where(eq(schema.business.id, businessId))
        .returning(businessSelect);

      // No metemos el logo (base64 enorme) en el diff de auditoría.
      const auditBefore = { ...before, logoUrl: before?.logoUrl ? '[logo]' : null };
      const auditAfter = { ...after, logoUrl: after?.logoUrl ? '[logo]' : null };
      await app.audit(req, {
        action: 'update',
        entity: 'business',
        entityId: businessId,
        before: auditBefore,
        after: auditAfter,
      });

      return reply.send({ data: after, error: null });
    },
  );
}
