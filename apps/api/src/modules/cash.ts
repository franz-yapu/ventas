import { schema, withTenant, type TenantTx } from '@ventafacil/db';
import { cashMovementSchema, closeCashSchema, openCashSchema } from '@ventafacil/shared';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { violaUnica } from '../lib/pg-errores.js';
import { filtroDeUbicacion, viewScope } from '../lib/scope.js';
import { TZ } from '../lib/zona.js';
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
  movementsIn: string;
  movementsOut: string;
  /**
   * Lo cobrado en efectivo que después se ANULÓ, dentro de este turno.
   *
   * Va aparte porque ya está sumado dentro de `cashSales` —el billete entró al cajón— y
   * la pantalla necesita poder decirlo. Sin este número, anular una venta no producía
   * ningún cambio visible en la caja: el esperado no se movía (que es lo correcto) pero
   * tampoco aparecía nada que explicara por qué, así que parecía que la anulación no se
   * había registrado. Con él, la caja puede recordar que hay un billete que sacar.
   */
  cancelledCash: string;
  expected: string;
  /** Ventas del turno por método de pago (la "lectura Z" del turno). */
  byPaymentMethod: Array<{ paymentMethod: string; total: string; count: number }>;
  salesCount: number;
}

const dec = (v: unknown) => Number(v ?? 0);

/**
 * Calcula el efectivo que DEBERÍA haber en el cajón:
 *
 *   apertura + ventas en efectivo + ingresos − retiros
 *
 * Las ventas se cuentan por `client_created_at` (cuándo ocurrió la venta), no por
 * `synced_at`: el billete entró al cajón cuando se vendió, aunque la venta llegue al
 * servidor tres horas después. Eso sí, una venta que sincronice DESPUÉS del cierre ya
 * no entra — por eso el esperado se congela al cerrar y no se recalcula.
 *
 * Las ANULADAS siguen contando, y esa es la parte que costó entender.
 *
 * Antes quedaban fuera (`status = 'completed'`), razonando que "el dinero se devolvió".
 * Pero el sistema no sabe si se devolvió: sólo sabe que alguien marcó la venta como
 * anulada. Y como el esperado retrocedía con ella, salía un agujero limpio: cobrar 280
 * en efectivo, anular, quedarse el billete, y cerrar la caja cuadrada. El único control
 * que tiene el dueño sobre el cajón borraba su propia prueba.
 *
 * Ahora el billete que entró se cuenta aunque la venta se anule después, y **devolver el
 * dinero es un retiro de caja**, como cualquier otra salida: queda registrado, con quién
 * y por qué. Si se devolvió, el turno cuadra igual; si no, aparece el faltante.
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
      -- 'cancelled' entra a propósito: ver la explicación de arriba. El dinero entró
      -- al cajón cuando se cobró; que la venta se anule después no lo saca de ahí.
      AND s.status IN ('completed', 'cancelled')
      AND s.client_created_at >= ${desde}::timestamptz
      AND s.client_created_at < ${finDelTurno}::timestamptz
    GROUP BY s.payment_method
  `);

  const anuladas = await tx.execute<{ total: string }>(sql`
    SELECT COALESCE(SUM(s.total), 0) AS total
    FROM sale s
    WHERE s.business_id = ${businessId}
      AND s.location_id = ${caja.locationId}
      AND s.status = 'cancelled'
      AND s.payment_method = 'cash'
      AND s.client_created_at >= ${desde}::timestamptz
      AND s.client_created_at < ${finDelTurno}::timestamptz
  `);

  const movs = await tx.execute<{ type: string; total: string }>(sql`
    SELECT type, COALESCE(SUM(amount), 0) AS total
    FROM cash_movement
    WHERE business_id = ${businessId} AND cash_register_id = ${caja.id}
    GROUP BY type
  `);

  const efectivo = ventas.find((r) => r.payment_method === 'cash');
  const cashSales = dec(efectivo?.total);
  const movementsIn = dec(movs.find((m) => m.type === 'in')?.total);
  const movementsOut = dec(movs.find((m) => m.type === 'out')?.total);
  const apertura = dec(caja.openingAmount);

  return {
    openingAmount: apertura.toFixed(2),
    cashSales: cashSales.toFixed(2),
    movementsIn: movementsIn.toFixed(2),
    movementsOut: movementsOut.toFixed(2),
    cancelledCash: dec(anuladas[0]?.total).toFixed(2),
    expected: (apertura + cashSales + movementsIn - movementsOut).toFixed(2),
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
      if (violaUnica(e, 'cash_register_una_abierta_uq')) {
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
      return reply.code(409).send({
        data: null,
        error: 'No hay una caja abierta. Ábrela antes de registrar movimientos.',
      });
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
    /**
     * Un VENDEDOR ve sus propios cierres, no los de sus compañeros.
     *
     * Este historial trae el descuadre de cada turno: cuánto se esperaba y cuánto se
     * contó. Saber que a la persona del otro turno le faltaron Bs. 80 el jueves es
     * supervisar, y supervisar es del administrador. Los suyos sí los ve: "¿cómo cerré
     * ayer?" es parte de su trabajo.
     */
    const soloLosMios =
      user.role !== 'admin'
        ? // Suyo es el turno que abrió O el que cerró. El cajón es de la ubicación, no de
          // una persona: si Ana abre y Beto releva, es Beto quien cuenta los billetes y
          // quien firma el descuadre. Filtrando sólo por quien abrió, ese turno no le
          // aparecía a Beto ni podía revisarlo — se le pedía responder por algo que no
          // podía ni mirar.
          or(eq(schema.cashRegister.userId, user.sub), eq(schema.cashRegister.closedBy, user.sub))
        : undefined;

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
            soloLosMios,
            effLocation ? eq(schema.cashRegister.locationId, effLocation) : undefined,
            // Las fechas se interpretan en la zona del NEGOCIO, no en UTC. Con `Z` fijo,
            // "hasta hoy" cortaba a las 19:59 locales y se comía los turnos de la noche.
            q.data.from
              ? sql`timezone(${TZ}, ${schema.cashRegister.openedAt}) >= ${q.data.from}::date`
              : undefined,
            // `to` es un día inclusive: se compara con el día siguiente a las 00:00.
            q.data.to
              ? sql`timezone(${TZ}, ${schema.cashRegister.openedAt}) < (${q.data.to}::date + interval '1 day')`
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

    const data = await withTenant(user.businessId, async (tx) => {
      const [caja] = await tx
        .select()
        .from(schema.cashRegister)
        .where(
          and(
            eq(schema.cashRegister.id, id),
            eq(schema.cashRegister.businessId, user.businessId),
            filtroDeUbicacion(user, schema.cashRegister.locationId),
            // Mismo criterio que el listado: el vendedor abre el detalle de los turnos que
            // abrió o cerró él. Sin esto, bastaba con tener el id de un turno ajeno para
            // leer su descuadre.
            user.role !== 'admin'
              ? or(
                  eq(schema.cashRegister.userId, user.sub),
                  eq(schema.cashRegister.closedBy, user.sub),
                )
              : undefined,
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
