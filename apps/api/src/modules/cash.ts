import { schema, withTenant, type TenantTx } from '@ventafacil/db';
import { cashMovementSchema, closeCashSchema, openCashSchema } from '@ventafacil/shared';
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { viewScope } from '../lib/scope.js';
import type { AuthUser } from '../types.js';

/**
 * Caja / arqueo: abrir el turno con el efectivo inicial, registrar entradas y salidas
 * que no son ventas, y cerrar contando lo que hay en el cajón.
 *
 * Lo único que importa de verdad aquí es que el ESPERADO sea creíble. Si no lo es,
 * cada cierre descuadra, la gente aprende a ignorar el descuadre y el arqueo deja de
 * servir para lo que existe: notar que falta plata.
 */

interface Desglose {
  openingAmount: string;
  cashSales: string;
  cashPayments: string;
  movementsIn: string;
  movementsOut: string;
  expected: string;
  /** Ventas del turno por método de pago (la "lectura Z" del turno). */
  byPaymentMethod: Array<{ paymentMethod: string; total: string; count: number }>;
  salesCount: number;
}

const dec = (v: unknown) => Number(v ?? 0);

/**
 * Calcula el efectivo que DEBERÍA haber en el cajón:
 *
 *   apertura + ventas en efectivo + abonos en efectivo + ingresos − retiros
 *
 * Las ventas se cuentan por `client_created_at` (cuándo ocurrió la venta), no por
 * `synced_at`: el billete entró al cajón cuando se vendió, aunque la venta llegue al
 * servidor tres horas después. Eso sí, una venta que sincronice DESPUÉS del cierre ya
 * no entra — por eso el esperado se congela al cerrar y no se recalcula.
 *
 * Las anuladas quedan fuera (`status = 'completed'`): el dinero se devolvió.
 * El fiado tampoco suma: no entró efectivo.
 */
async function calcularDesglose(
  tx: TenantTx,
  businessId: string,
  caja: { id: string; locationId: string; openedAt: Date; openingAmount: string },
  hasta: Date,
): Promise<Desglose> {
  // Las fechas van como ISO con cast explícito: en SQL crudo el driver recibe los
  // parámetros sin tipo y no sabe serializar un objeto Date.
  const desde = caja.openedAt.toISOString();
  const finDelTurno = hasta.toISOString();

  const ventas = await tx.execute<{ payment_method: string; total: string; count: number }>(sql`
    SELECT s.payment_method, SUM(s.total) AS total, COUNT(*)::int AS count
    FROM sale s
    WHERE s.business_id = ${businessId}
      AND s.location_id = ${caja.locationId}
      AND s.status = 'completed'
      AND s.client_created_at >= ${desde}::timestamptz
      AND s.client_created_at < ${finDelTurno}::timestamptz
    GROUP BY s.payment_method
  `);

  /**
   * Abonos de fiado cobrados en efectivo. `customer_payment` no tiene ubicación, así
   * que se atribuye a la del usuario que lo recibió: quien cobró tenía el cajón
   * delante. Es la única atribución posible sin inventarse una columna.
   */
  const abonos = await tx.execute<{ total: string }>(sql`
    SELECT COALESCE(SUM(cp.amount), 0) AS total
    FROM customer_payment cp
    JOIN app_user u ON u.id = cp.user_id
    WHERE cp.business_id = ${businessId}
      AND u.location_id = ${caja.locationId}
      AND cp.method = 'cash'
      AND cp.created_at >= ${desde}::timestamptz
      AND cp.created_at < ${finDelTurno}::timestamptz
  `);

  const movs = await tx.execute<{ type: string; total: string }>(sql`
    SELECT type, COALESCE(SUM(amount), 0) AS total
    FROM cash_movement
    WHERE business_id = ${businessId} AND cash_register_id = ${caja.id}
    GROUP BY type
  `);

  const efectivo = ventas.find((r) => r.payment_method === 'cash');
  const cashSales = dec(efectivo?.total);
  const cashPayments = dec(abonos[0]?.total);
  const movementsIn = dec(movs.find((m) => m.type === 'in')?.total);
  const movementsOut = dec(movs.find((m) => m.type === 'out')?.total);
  const apertura = dec(caja.openingAmount);

  return {
    openingAmount: apertura.toFixed(2),
    cashSales: cashSales.toFixed(2),
    cashPayments: cashPayments.toFixed(2),
    movementsIn: movementsIn.toFixed(2),
    movementsOut: movementsOut.toFixed(2),
    expected: (apertura + cashSales + cashPayments + movementsIn - movementsOut).toFixed(2),
    byPaymentMethod: ventas.map((r) => ({
      paymentMethod: r.payment_method,
      total: Number(r.total).toFixed(2),
      count: Number(r.count),
    })),
    salesCount: ventas.reduce((a, r) => a + Number(r.count), 0),
  };
}

/**
 * Ubicación sobre la que opera este usuario.
 *
 * Mirar la caja de otra sucursal es supervisar, así que sólo un ADMIN de la central
 * puede pedir otra. Antes bastaba con `isCentral` sin mirar el rol, y un vendedor
 * asignado a la sucursal central podía operar sobre la caja de otro local.
 */
function ubicacionDeTrabajo(user: AuthUser, pedida?: string): string | null {
  if (pedida && user.isCentral && user.role === 'admin') return pedida;
  return user.locationId;
}

export async function cashRoutes(app: FastifyInstance) {
  /**
   * GET /cash/current — la caja abierta de mi ubicación, con el esperado EN VIVO.
   *
   * Devuelve `null` en vez de 404 cuando no hay ninguna abierta: "no hay caja abierta"
   * es un estado normal de la pantalla, no un error.
   */
  app.get('/cash/current', { preHandler: app.requireAuth }, async (req, reply) => {
    const q = z.object({ locationId: z.string().uuid().optional() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ data: null, error: 'Parámetros inválidos' });

    const user = req.authUser!;
    const locationId = ubicacionDeTrabajo(user, q.data.locationId);
    if (!locationId) {
      return reply.code(400).send({ data: null, error: 'Tu usuario no tiene ubicación asignada' });
    }

    const data = await withTenant(user.businessId, async (tx) => {
      const [caja] = await tx
        .select()
        .from(schema.cashRegister)
        .where(
          and(
            eq(schema.cashRegister.businessId, user.businessId),
            eq(schema.cashRegister.locationId, locationId),
            isNull(schema.cashRegister.closedAt),
          ),
        )
        .limit(1);
      if (!caja) return null;

      const desglose = await calcularDesglose(tx, user.businessId, caja, new Date());
      const movimientos = await tx
        .select()
        .from(schema.cashMovement)
        .where(eq(schema.cashMovement.cashRegisterId, caja.id))
        .orderBy(desc(schema.cashMovement.createdAt));

      return { register: caja, breakdown: desglose, movements: movimientos };
    });

    return reply.send({ data, error: null });
  });

  /** POST /cash/open — abre el turno. */
  app.post('/cash/open', { preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = openCashSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ data: null, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
    }
    const user = req.authUser!;
    // A propósito NO se acepta la ubicación del cuerpo: una caja se abre donde está la
    // persona que tiene el dinero delante, igual que una venta se registra donde ocurre.
    // Abrir la caja de otro local desde aquí deja un turno abierto que nadie cuadra.
    const locationId = ubicacionDeTrabajo(user, undefined);
    if (!locationId) {
      return reply.code(400).send({ data: null, error: 'Tu usuario no tiene ubicación asignada' });
    }

    try {
      const caja = await withTenant(user.businessId, async (tx) => {
        // La ubicación tiene que ser del negocio: sin esto, la central podría abrir
        // caja en una ubicación ajena pasando un uuid a mano.
        const [loc] = await tx
          .select({ id: schema.location.id })
          .from(schema.location)
          .where(
            and(
              eq(schema.location.id, locationId),
              eq(schema.location.businessId, user.businessId),
              eq(schema.location.isActive, true),
            ),
          )
          .limit(1);
        if (!loc) return null;

        const [row] = await tx
          .insert(schema.cashRegister)
          .values({
            businessId: user.businessId,
            locationId,
            userId: user.sub,
            openingAmount: parsed.data.openingAmount,
          })
          .returning();
        return row!;
      });

      if (!caja) return reply.code(400).send({ data: null, error: 'Ubicación no válida' });

      await app.audit(req, {
        action: 'open',
        entity: 'cash_register',
        entityId: caja.id,
        after: caja,
      });
      return reply.code(201).send({ data: caja, error: null });
    } catch (e) {
      // Lo atrapa el índice parcial único: ya hay un turno abierto en ese cajón.
      if (String(e).includes('cash_register_una_abierta_uq')) {
        return reply
          .code(409)
          .send({ data: null, error: 'Ya hay una caja abierta en esta ubicación.' });
      }
      throw e;
    }
  });

  /** POST /cash/movements — entrada o salida de efectivo que no es una venta. */
  app.post('/cash/movements', { preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = cashMovementSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ data: null, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
    }
    const user = req.authUser!;
    const locationId = ubicacionDeTrabajo(user, undefined);
    if (!locationId) {
      return reply.code(400).send({ data: null, error: 'Tu usuario no tiene ubicación asignada' });
    }

    const row = await withTenant(user.businessId, async (tx) => {
      const [caja] = await tx
        .select({ id: schema.cashRegister.id })
        .from(schema.cashRegister)
        .where(
          and(
            eq(schema.cashRegister.businessId, user.businessId),
            eq(schema.cashRegister.locationId, locationId),
            isNull(schema.cashRegister.closedAt),
          ),
        )
        .limit(1);
      if (!caja) return null;

      const [mov] = await tx
        .insert(schema.cashMovement)
        .values({
          businessId: user.businessId,
          cashRegisterId: caja.id,
          userId: user.sub,
          type: parsed.data.type,
          amount: parsed.data.amount,
          reason: parsed.data.reason,
        })
        .returning();
      return mov!;
    });

    if (!row) {
      return reply
        .code(409)
        .send({ data: null, error: 'No hay una caja abierta. Ábrela antes de registrar movimientos.' });
    }

    await app.audit(req, {
      action: 'create',
      entity: 'cash_movement',
      entityId: row.id,
      after: row,
    });
    return reply.code(201).send({ data: row, error: null });
  });

  /**
   * POST /cash/close — cierra el turno.
   *
   * El esperado se calcula y se GUARDA aquí. A partir de este momento el arqueo es una
   * foto: si mañana sincroniza una venta de hoy o se anula una de ayer, el cierre de
   * hoy sigue diciendo lo mismo que dijo cuando alguien contó los billetes.
   */
  app.post('/cash/close', { preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = closeCashSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ data: null, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
    }
    const user = req.authUser!;
    const locationId = ubicacionDeTrabajo(user, undefined);
    if (!locationId) {
      return reply.code(400).send({ data: null, error: 'Tu usuario no tiene ubicación asignada' });
    }

    const resultado = await withTenant(user.businessId, async (tx) => {
      const [caja] = await tx
        .select()
        .from(schema.cashRegister)
        .where(
          and(
            eq(schema.cashRegister.businessId, user.businessId),
            eq(schema.cashRegister.locationId, locationId),
            isNull(schema.cashRegister.closedAt),
          ),
        )
        .limit(1);
      if (!caja) return null;

      const cerradoEn = new Date();
      const desglose = await calcularDesglose(tx, user.businessId, caja, cerradoEn);

      // Si no cuadra, hay que decir por qué. Un descuadre sin explicación se convierte
      // en un número que nadie recuerda a la semana siguiente, y el arqueo existe
      // justamente para poder mirar atrás y entender qué pasó.
      const diferencia = Number(parsed.data.countedAmount) - Number(desglose.expected);
      if (Math.abs(diferencia) >= 0.005 && !parsed.data.notes?.trim()) {
        return 'FALTA_MOTIVO' as const;
      }

      const [row] = await tx
        .update(schema.cashRegister)
        .set({
          closedAt: cerradoEn,
          closedBy: user.sub,
          closingAmount: parsed.data.countedAmount,
          expectedAmount: desglose.expected,
          notes: parsed.data.notes ?? null,
        })
        .where(eq(schema.cashRegister.id, caja.id))
        .returning();

      return { register: row!, breakdown: desglose };
    });

    if (resultado === 'FALTA_MOTIVO') {
      return reply.code(400).send({
        data: null,
        error: 'La caja no cuadra: explica por qué antes de cerrarla.',
        code: 'falta_motivo',
      });
    }
    if (!resultado) {
      return reply.code(409).send({ data: null, error: 'No hay una caja abierta para cerrar.' });
    }

    const diferencia = (
      Number(resultado.register.closingAmount) - Number(resultado.register.expectedAmount)
    ).toFixed(2);

    await app.audit(req, {
      action: 'close',
      entity: 'cash_register',
      entityId: resultado.register.id,
      after: { ...resultado.register, difference: diferencia },
    });

    return reply.send({
      data: { ...resultado, difference: diferencia },
      error: null,
    });
  });

  /** GET /cash/registers — historial de cierres, con su diferencia. */
  app.get('/cash/registers', { preHandler: app.requireAuth }, async (req, reply) => {
    const q = z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
        locationId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .safeParse(req.query);
    if (!q.success) return reply.code(400).send({ data: null, error: 'Parámetros inválidos' });

    const user = req.authUser!;
    // La sucursal ve sólo la suya; la central puede filtrar por una o verlas todas.
    const scope = viewScope(user);
    const effLocation = scope !== undefined ? scope : q.data.locationId;

    const rows = await withTenant(user.businessId, (tx) => {
      const abridor = schema.appUser;
      return tx
        .select({
          id: schema.cashRegister.id,
          locationId: schema.cashRegister.locationId,
          locationName: schema.location.name,
          openedBy: abridor.name,
          openedAt: schema.cashRegister.openedAt,
          closedAt: schema.cashRegister.closedAt,
          openingAmount: schema.cashRegister.openingAmount,
          expectedAmount: schema.cashRegister.expectedAmount,
          closingAmount: schema.cashRegister.closingAmount,
          notes: schema.cashRegister.notes,
        })
        .from(schema.cashRegister)
        .innerJoin(schema.location, eq(schema.location.id, schema.cashRegister.locationId))
        .innerJoin(abridor, eq(abridor.id, schema.cashRegister.userId))
        .where(
          and(
            eq(schema.cashRegister.businessId, user.businessId),
            effLocation ? eq(schema.cashRegister.locationId, effLocation) : undefined,
            q.data.from ? gte(schema.cashRegister.openedAt, new Date(q.data.from)) : undefined,
            // `to` es un día inclusive: se compara con el día siguiente a las 00:00.
            q.data.to
              ? lt(schema.cashRegister.openedAt, new Date(`${q.data.to}T23:59:59.999Z`))
              : undefined,
          ),
        )
        .orderBy(desc(schema.cashRegister.openedAt))
        .limit(q.data.limit);
    });

    return reply.send({
      data: rows.map((r) => ({
        ...r,
        difference:
          r.closingAmount !== null && r.expectedAmount !== null
            ? (Number(r.closingAmount) - Number(r.expectedAmount)).toFixed(2)
            : null,
      })),
      error: null,
    });
  });

  /** GET /cash/registers/:id — detalle de un turno: desglose y movimientos. */
  app.get('/cash/registers/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = req.authUser!;
    const scope = viewScope(user);

    const data = await withTenant(user.businessId, async (tx) => {
      const [caja] = await tx
        .select()
        .from(schema.cashRegister)
        .where(
          and(
            eq(schema.cashRegister.id, id),
            eq(schema.cashRegister.businessId, user.businessId),
            scope !== undefined ? eq(schema.cashRegister.locationId, scope) : undefined,
          ),
        )
        .limit(1);
      if (!caja) return null;

      // En un turno cerrado el desglose se recalcula sólo para enseñar el detalle; el
      // esperado que MANDA es el guardado al cerrar, que es el que se contrastó.
      const hasta = caja.closedAt ?? new Date();
      const desglose = await calcularDesglose(tx, user.businessId, caja, hasta);
      const movimientos = await tx
        .select()
        .from(schema.cashMovement)
        .where(eq(schema.cashMovement.cashRegisterId, caja.id))
        .orderBy(desc(schema.cashMovement.createdAt));

      return {
        register: caja,
        breakdown: { ...desglose, expected: caja.expectedAmount ?? desglose.expected },
        movements: movimientos,
        difference:
          caja.closingAmount !== null && caja.expectedAmount !== null
            ? (Number(caja.closingAmount) - Number(caja.expectedAmount)).toFixed(2)
            : null,
      };
    });

    if (!data) return reply.code(404).send({ data: null, error: 'Caja no encontrada' });
    return reply.send({ data, error: null });
  });
}
