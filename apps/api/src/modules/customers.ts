import { schema, withTenant } from '@ventafacil/db';
import { customerPaymentSchema, upsertCustomerSchema } from '@ventafacil/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

// Saldo de fiado = ventas a crédito completadas - abonos.
const balanceExpr = sql<string>`
  COALESCE((
    SELECT SUM(s.total) FROM sale s
    WHERE s.customer_id = customer.id AND s.payment_method = 'credit' AND s.status = 'completed'
  ), 0) - COALESCE((
    SELECT SUM(cp.amount) FROM customer_payment cp WHERE cp.customer_id = customer.id
  ), 0)
`;

export async function customerRoutes(app: FastifyInstance) {
  // GET /customers — lista con saldo (deudores primero).
  app.get('/customers', { preHandler: app.requireAuth }, async (req, reply) => {
    const businessId = req.authUser!.businessId;
    const rows = await withTenant(businessId, (tx) =>
      tx
        .select({
          id: schema.customer.id,
          name: schema.customer.name,
          phone: schema.customer.phone,
          notes: schema.customer.notes,
          balance: balanceExpr,
        })
        .from(schema.customer)
        .where(and(eq(schema.customer.businessId, businessId), eq(schema.customer.isActive, true)))
        .orderBy(desc(balanceExpr), schema.customer.name),
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

  // GET /customers/:id — detalle: datos + saldo + ventas a crédito + abonos.
  app.get('/customers/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const businessId = req.authUser!.businessId;

    // Las tres consultas van en la MISMA transacción: una sola ida y vuelta de
    // BEGIN/COMMIT y una foto coherente del cliente, sus ventas y sus abonos.
    const detalle = await withTenant(businessId, async (tx) => {
      const [cust] = await tx
        .select({
          id: schema.customer.id,
          name: schema.customer.name,
          phone: schema.customer.phone,
          notes: schema.customer.notes,
          balance: balanceExpr,
        })
        .from(schema.customer)
        .where(and(eq(schema.customer.id, id), eq(schema.customer.businessId, businessId)))
        .limit(1);
      if (!cust) return null;

      const creditSales = await tx
        .select({
          id: schema.sale.id,
          receiptNumber: schema.sale.receiptNumber,
          total: schema.sale.total,
          status: schema.sale.status,
          clientCreatedAt: schema.sale.clientCreatedAt,
        })
        .from(schema.sale)
        .where(
          and(
            eq(schema.sale.customerId, id),
            eq(schema.sale.businessId, businessId),
            eq(schema.sale.paymentMethod, 'credit'),
          ),
        )
        .orderBy(desc(schema.sale.clientCreatedAt))
        .limit(50);

      const payments = await tx
        .select()
        .from(schema.customerPayment)
        .where(eq(schema.customerPayment.customerId, id))
        .orderBy(desc(schema.customerPayment.createdAt))
        .limit(50);

      return { ...cust, creditSales, payments };
    });

    if (!detalle) return reply.code(404).send({ data: null, error: 'Cliente no encontrado' });
    return reply.send({ data: detalle, error: null });
  });

  // POST /customers/:id/payments — registrar abono.
  app.post('/customers/:id/payments', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = customerPaymentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ data: null, error: 'Datos inválidos' });
    const { businessId, sub: userId } = req.authUser!;

    // Comprobar el cliente y registrar el abono en la misma transacción, para que no
    // pueda colarse un abono si el cliente desaparece entre una consulta y la otra.
    const row = await withTenant(businessId, async (tx) => {
      const [cust] = await tx
        .select({ id: schema.customer.id })
        .from(schema.customer)
        .where(and(eq(schema.customer.id, id), eq(schema.customer.businessId, businessId)))
        .limit(1);
      if (!cust) return null;

      const [created] = await tx
        .insert(schema.customerPayment)
        .values({
          businessId,
          customerId: id,
          userId,
          amount: parsed.data.amount,
          method: parsed.data.method,
          note: parsed.data.note ?? null,
        })
        .returning();
      return created;
    });

    if (!row) return reply.code(404).send({ data: null, error: 'Cliente no encontrado' });
    await app.audit(req, {
      action: 'payment',
      entity: 'customer',
      entityId: id,
      after: { amount: parsed.data.amount },
    });
    return reply.code(201).send({ data: row, error: null });
  });
}
