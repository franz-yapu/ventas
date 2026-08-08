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
  maxSellerDiscountPct: schema.business.maxSellerDiscountPct,
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
  /** Tope de descuento del vendedor, en % del subtotal. El admin no tiene tope. */
  maxSellerDiscountPct: z.number().int().min(0).max(100).optional(),
});

export async function businessRoutes(app: FastifyInstance) {
  /**
   * GET /public/business/:slug — la MARCA de un negocio, sin sesión.
   *
   * Existe para las pantallas que se ven ANTES de entrar: login, recuperar contraseña,
   * verificar el correo. Sin esto, el cliente que abre `su-negocio.dominio.com` ve una
   * pantalla genérica con la marca del proveedor, y la promesa del white-label se rompe
   * justo en la primera pantalla que mira.
   *
   * Devuelve sólo lo que de todos modos va a ver al entrar: nombre, logo, colores y el
   * rótulo de la app. NADA de moneda, impuesto, esquema de productos ni tope de
   * descuento — eso es configuración interna del negocio y no pinta en un login.
   *
   * Que confirme si un subdominio existe no es una fuga: el propio DNS ya lo hace, y
   * `GET /register/slug` lo dice a propósito para el formulario de alta.
   */
  app.get('/public/business/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const [biz] = await db
      .select({
        name: schema.business.name,
        logoUrl: schema.business.logoUrl,
        theme: schema.business.themeJson,
        texts: schema.business.textsJson,
      })
      .from(schema.business)
      .where(eq(schema.business.slug, slug.toLowerCase().trim()))
      .limit(1);

    // 404 y no un error: para el frontend "este subdominio no es de nadie" es una
    // respuesta válida, y cae a la marca genérica sin romper la pantalla.
    if (!biz) return reply.code(404).send({ data: null, error: 'Negocio no encontrado' });

    const texts = (biz.texts ?? {}) as Record<string, string>;
    return reply.send({
      data: {
        name: biz.name,
        logoUrl: biz.logoUrl,
        theme: biz.theme,
        // Único texto que se expone: el rótulo de la app, que es parte de la marca.
        appName: texts.app_name ?? biz.name,
      },
      error: null,
    });
  });

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

  // PATCH /business -> configuración white-label. Auditado (incluye cambio de tema).
  // Sólo la central: el nombre, el logo, el impuesto y el tope de descuento son del
  // NEGOCIO, no de una sucursal, y los cambia quien responde por el negocio entero.
  app.patch(
    '/business',
    { preHandler: [app.requireAuth, app.requireCentralAdmin] },
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

      // Un cuerpo vacío no es un error del servidor: es una petición sin nada dentro. Sin
      // esto, `{}` producía un UPDATE sin columnas y reventaba con un 500 — que además
      // manda un aviso por correo a operación.
      if (Object.keys(parsed.data).length === 0) {
        return reply.code(400).send({ data: null, error: 'No hay nada que cambiar' });
      }

      const patch: Record<string, unknown> = {};
      const d = parsed.data;
      if (d.name !== undefined) patch.name = d.name;
      if (d.logoUrl !== undefined) patch.logoUrl = d.logoUrl;
      if (d.theme !== undefined) patch.themeJson = d.theme;
      if (d.texts !== undefined) patch.textsJson = d.texts;
      if (d.productSchema !== undefined) patch.productSchemaJson = d.productSchema;
      if (d.currency !== undefined) patch.currency = d.currency;
      if (d.taxRate !== undefined) patch.taxRate = d.taxRate;
      if (d.maxSellerDiscountPct !== undefined) {
        patch.maxSellerDiscountPct = d.maxSellerDiscountPct;
      }

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
