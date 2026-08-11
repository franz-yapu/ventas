import { schema, withTenant } from '@ventafacil/db';
import { upsertCustomerSchema } from '@ventafacil/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

/**
 * Compradores: a quién se le vendió.
 *
 * Este módulo era el del fiado —saldo, ventas a crédito, abonos, y una excepción de
 * alcance escrita a propósito para que la deuda se viera entre sucursales—. El fiado se
 * quitó del producto el 11 de agosto de 2026 y con él se fue todo eso: sin ventas a
 * crédito no hay saldo que calcular, y sin saldo no hay abono contra el que aplicarlo.
 *
 * Lo que queda es lo que la pantalla de cobro usa de verdad: una lista para elegir
 * comprador y un alta rápida desde el propio POS. El nombre viaja al recibo y sale en la
 * columna «Cliente» de la exportación de ventas.
 *
 * Ya no hace falta la excepción de alcance: lo único que se lee aquí es el nombre y el
 * teléfono de quien compra, que no es el trabajo de nadie ni una deuda de nadie.
 */
export async function customerRoutes(app: FastifyInstance) {
  // GET /customers — lista alfabética, para el selector del POS.
  app.get('/customers', { preHandler: app.requireAuth }, async (req, reply) => {
    const businessId = req.authUser!.businessId;
    const rows = await withTenant(businessId, (tx) =>
      tx
        .select({
          id: schema.customer.id,
          name: schema.customer.name,
          phone: schema.customer.phone,
          notes: schema.customer.notes,
        })
        .from(schema.customer)
        .where(and(eq(schema.customer.businessId, businessId), eq(schema.customer.isActive, true)))
        .orderBy(schema.customer.name),
    );
    return reply.send({ data: rows, error: null });
  });

  // POST /customers
  app.post('/customers', { preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = upsertCustomerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ data: null, error: 'Datos inválidos' });
    const [row] = await withTenant(req.authUser!.businessId, (tx) =>
      tx
        .insert(schema.customer)
        .values({ businessId: req.authUser!.businessId, ...parsed.data })
        .returning(),
    );
    await app.audit(req, { action: 'create', entity: 'customer', entityId: row!.id, after: row });
    return reply.code(201).send({ data: row, error: null });
  });
}
