import { schema, withTenant } from '@ventafacil/db';
import { patchCustomerSchema, upsertCustomerSchema } from '@ventafacil/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { colgandoDeComprador, mensajeDesactivado } from '../lib/borrado.js';
import { filtroDeUbicacion } from '../lib/scope.js';

/**
 * Compradores: a quién se le vendió.
 *
 * Este módulo era el del fiado —saldo, ventas a crédito, abonos, y una excepción de
 * alcance escrita a propósito para que la deuda se viera entre sucursales—. El fiado se
 * quitó del producto el 11 de agosto de 2026 y con él se fue todo eso: sin ventas a
 * crédito no hay saldo que calcular.
 *
 * Lo que queda es un registro de compradores con su historial de compras. El nombre viaja
 * al recibo y sale en la columna «Cliente» de la exportación de ventas.
 *
 * ## Quién puede qué, y por qué no es lo mismo
 *
 * **Crear y ver: cualquiera con sesión.** El alta rápida vive en la pantalla de cobro, y
 * quien está atendiendo tiene que poder apuntar a quién le vende sin ir a buscar a un
 * administrador. Lo que se guarda aquí es un nombre y un teléfono, no el costo de nada.
 *
 * **Editar y eliminar: sólo administrador.** Son las dos que pueden hacer daño a un
 * registro que ya está enlazado desde ventas cerradas.
 *
 * **El COMPRADOR no tiene alcance por sucursal**, porque la tabla no tiene ubicación: un
 * comprador es del negocio. Quien compró en Norte puede volver por la Central, y obligarle
 * a estar dado de alta dos veces daría dos historiales de la misma persona.
 *
 * **Sus COMPRAS sí lo tienen.** Una venta ocurre en una sucursal, y ahí manda la misma
 * regla que en `GET /sales`: un vendedor vende donde está, no supervisa a nadie. Por eso
 * cada consulta que toca `sale` lleva `filtroDeUbicacion`.
 *
 * ⚠️ Esa separación se perdió al quitar el fiado, y conviene entender cómo para no
 * repetirlo. Aquí había una excepción al alcance escrita a propósito y justificada por
 * escrito —«lo que se fía se le fía AL NEGOCIO, no a una sucursal»—, pero quien la
 * sostenía de verdad era el `payment_method = 'credit'` de la consulta: sin él, la
 * excepción dejó de proteger nada y cualquier vendedor pudo leer el historial de ventas de
 * las demás sucursales. **Un comentario que justifica una excepción deja de justificarla
 * cuando cambia lo que hay debajo**, y el comentario no se entera.
 */

/**
 * Cuántas compras trae el detalle.
 *
 * El historial completo de un cliente de años son cientos de filas para un modal que se
 * abre de un vistazo. Lo que NO puede pasar es que el corte sea invisible: el detalle
 * devuelve también cuántas hay en total para que la pantalla pueda decir «las 50 más
 * recientes de 137» en vez de dejar creer que ésas son todas.
 */
const MAX_COMPRAS_DETALLE = 50;

export async function customerRoutes(app: FastifyInstance) {
  /**
   * GET /customers — la lista, con cuántas compras lleva cada uno y cuándo fue la última.
   *
   * Los dos números salen de la misma consulta con un `LEFT JOIN` agrupado, y no con una
   * consulta por fila: con doscientos compradores eso serían doscientas idas y vueltas
   * para pintar una tabla.
   *
   * Van los INACTIVOS también, marcados: un comprador desactivado sigue siendo el dueño de
   * su historial, y esconderlo aquí haría que sus compras parecieran de nadie. El POS sí
   * los filtra, porque ahí lo que se ofrece es a quién vender hoy.
   */
  app.get('/customers', { preHandler: app.requireAuth }, async (req, reply) => {
    const user = req.authUser!;
    const businessId = user.businessId;
    const rows = await withTenant(businessId, (tx) =>
      tx
        .select({
          id: schema.customer.id,
          name: schema.customer.name,
          phone: schema.customer.phone,
          notes: schema.customer.notes,
          isActive: schema.customer.isActive,
          /*
            Las dos cifras cuentan sólo las COMPLETADAS, y no es un detalle.

            El `count` no filtraba por estado mientras el `totalGastado` del detalle sí, así
            que un cliente cuyas dos únicas compras se anularon salía con «2 compras» y
            «Bs. 0.00» gastados — dos números de la misma pantalla respondiendo preguntas
            distintas sin avisar—, y `ultimaCompra` apuntaba a una venta que ya no contaba.

            La columna responde «cuánto me ha comprado», no «cuántas veces pasó por caja»:
            lo anulado no es una compra. El HISTORIAL del detalle sí las enseña, marcadas,
            porque ahí la pregunta es otra —qué pasó con este comprador— y esconderlas
            dejaría un hueco inexplicable.

            Va con `FILTER` y no en el WHERE ni en el ON: en el WHERE se llevaría por delante
            el LEFT JOIN (ver abajo), y en el ON desaparecerían del historial las anuladas
            que sí queremos poder contar aparte.
          */
          compras: sql<number>`COUNT(${schema.sale.id}) FILTER (WHERE ${schema.sale.status} = 'completed')::int`,
          ultimaCompra: sql<
            string | null
          >`MAX(${schema.sale.clientCreatedAt}) FILTER (WHERE ${schema.sale.status} = 'completed')`,
        })
        .from(schema.customer)
        /*
          El alcance va en el ON del JOIN, no en el WHERE.

          En el WHERE se llevaría por delante el LEFT: los compradores que no han comprado
          nunca en mi sucursal desaparecerían de la lista, y quien acaba de dar de alta a
          uno pensaría que no se guardó. En el ON, siguen saliendo — con la cuenta en cero,
          que es la verdad desde donde se mira.
        */
        .leftJoin(
          schema.sale,
          and(
            eq(schema.sale.customerId, schema.customer.id),
            filtroDeUbicacion(user, schema.sale.locationId),
          ),
        )
        .where(eq(schema.customer.businessId, businessId))
        .groupBy(schema.customer.id)
        .orderBy(schema.customer.name),
    );
    return reply.send({ data: rows, error: null });
  });

  // POST /customers — el alta rápida del POS.
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

  /**
   * GET /customers/:id — sus datos y sus compras.
   *
   * Es lo que hace que esta pantalla valga más que una agenda de teléfonos: `sale.customer_id`
   * se venía llenando desde el POS y **no había ninguna pantalla que lo leyera**. Sirve para
   * la pregunta que se hace de verdad en el mostrador —"¿qué le vendí a este señor y
   * cuándo?"— cuando alguien vuelve seis meses después con algo en la mano.
   *
   * Las anuladas entran, marcadas con su estado: que una venta se anulara es parte de lo
   * que pasó con ese comprador, y esconderla deja un hueco inexplicable en su historial.
   */
  app.get('/customers/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = req.authUser!;
    const businessId = user.businessId;
    // Una sola vez, para las dos consultas de ventas: si el historial se filtra y el total
    // no, la puerta queda cerrada y la ventana abierta — el total es un número, pero dice
    // cuánto factura la otra sucursal con ese cliente.
    const alcance = filtroDeUbicacion(user, schema.sale.locationId);

    // Las dos consultas en la MISMA transacción: una foto coherente del comprador y de
    // sus compras, y una sola ida y vuelta de BEGIN/COMMIT.
    const detalle = await withTenant(businessId, async (tx) => {
      const [cliente] = await tx
        .select()
        .from(schema.customer)
        .where(and(eq(schema.customer.id, id), eq(schema.customer.businessId, businessId)))
        .limit(1);
      if (!cliente) return null;

      const compras = await tx
        .select({
          id: schema.sale.id,
          receiptNumber: schema.sale.receiptNumber,
          total: schema.sale.total,
          status: schema.sale.status,
          paymentMethod: schema.sale.paymentMethod,
          locationName: schema.location.name,
          clientCreatedAt: schema.sale.clientCreatedAt,
        })
        .from(schema.sale)
        .leftJoin(schema.location, eq(schema.location.id, schema.sale.locationId))
        .where(and(eq(schema.sale.customerId, id), eq(schema.sale.businessId, businessId), alcance))
        .orderBy(desc(schema.sale.clientCreatedAt))
        .limit(MAX_COMPRAS_DETALLE);

      /*
        Las tres cifras del resumen, en UNA consulta y sobre TODAS sus compras.

        Ninguna se calcula sobre las 50 que se devuelven: sumar sólo la página daría un
        número más pequeño que el real justo para los compradores que más han comprado, que
        son los que se miran. Y contar `compras.length` en la pantalla —que es lo que hacía—
        dejaba a un cliente de 137 diciendo «50 compras» junto al gasto de las 137.

        Son dos cuentas y no una porque responden dos preguntas distintas, y las dos están
        en la pantalla:

        - `comprasCompletadas` va al lado del gasto, así que tiene que contar lo mismo que
          el gasto. Si no, dos anuladas dan «2 compras · Bs. 0.00».
        - `comprasRegistradas` es el largo del historial de abajo, donde las anuladas SÍ
          salen —son parte de lo que pasó con ese comprador—, y es contra lo que se compara
          para saber si la lista se quedó corta.

        En la misma consulta con `FILTER` en vez de en dos: así no puede pasar que el gasto
        y su cuenta se calculen sobre conjuntos distintos.
      */
      const [resumen] = await tx
        .select({
          registradas: sql<number>`COUNT(*)::int`,
          completadas: sql<number>`COUNT(*) FILTER (WHERE ${schema.sale.status} = 'completed')::int`,
          gastado: sql<string>`COALESCE(SUM(${schema.sale.total}) FILTER (WHERE ${schema.sale.status} = 'completed'), 0)`,
        })
        .from(schema.sale)
        .where(
          and(eq(schema.sale.customerId, id), eq(schema.sale.businessId, businessId), alcance),
        );

      return {
        ...cliente,
        compras,
        totalGastado: resumen?.gastado ?? '0',
        comprasCompletadas: resumen?.completadas ?? 0,
        comprasRegistradas: resumen?.registradas ?? 0,
      };
    });

    if (!detalle) return reply.code(404).send({ data: null, error: 'Comprador no encontrado' });
    return reply.send({ data: detalle, error: null });
  });

  // PATCH /customers/:id — corregir el nombre, el teléfono o la nota. Sólo administrador.
  app.patch(
    '/customers/:id',
    { preHandler: [app.requireAuth, app.requireAdmin] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const businessId = req.authUser!.businessId;

      const parsed = patchCustomerSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ data: null, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      }

      const [antes] = await withTenant(businessId, (tx) =>
        tx
          .select()
          .from(schema.customer)
          .where(and(eq(schema.customer.id, id), eq(schema.customer.businessId, businessId)))
          .limit(1),
      );
      if (!antes) return reply.code(404).send({ data: null, error: 'Comprador no encontrado' });

      /*
        Sólo lo que vino. Volcar el objeto entero escribiría `null` en el teléfono de quien
        edita únicamente el nombre — la diferencia entre "no lo toco" y "bórralo" es que
        la clave esté o no en el cuerpo, y eso `undefined` no lo distingue solo.
      */
      const d = parsed.data;
      const cambios: Record<string, unknown> = {};
      // Sin `.trim()` aquí: lo recorta el esquema, ANTES de validar. Hacerlo después era el
      // fallo — `{ name: "   " }` pasaba el `.min(1)` y se guardaba vacío.
      if (d.name !== undefined) cambios.name = d.name;
      if (d.phone !== undefined) cambios.phone = d.phone || null;
      if (d.notes !== undefined) cambios.notes = d.notes || null;
      if (d.isActive !== undefined) cambios.isActive = d.isActive;

      const [row] = await withTenant(businessId, (tx) =>
        tx.update(schema.customer).set(cambios).where(eq(schema.customer.id, id)).returning(),
      );
      await app.audit(req, {
        action: 'update',
        entity: 'customer',
        entityId: id,
        before: antes,
        after: row,
      });
      return reply.send({ data: row, error: null });
    },
  );

  /**
   * DELETE /customers/:id — borra si nunca compró; si compró, desactiva y lo explica.
   *
   * La misma política que sucursales y usuarios, y por el mismo motivo: `sale.customer_id`
   * cuelga en SET NULL, así que un borrado a secas no falla — deja ventas cerradas sin
   * saber a quién se le hicieron. Un error de tecleo al dar de alta sí se puede borrar del
   * todo, que es lo que la política protege por el otro lado.
   */
  app.delete(
    '/customers/:id',
    { preHandler: [app.requireAuth, app.requireAdmin] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const businessId = req.authUser!.businessId;

      const [cliente] = await withTenant(businessId, (tx) =>
        tx
          .select()
          .from(schema.customer)
          .where(and(eq(schema.customer.id, id), eq(schema.customer.businessId, businessId)))
          .limit(1),
      );
      if (!cliente) return reply.code(404).send({ data: null, error: 'Comprador no encontrado' });

      const colgando = await colgandoDeComprador(businessId, id);

      if (colgando.total === 0) {
        await withTenant(businessId, (tx) =>
          tx.delete(schema.customer).where(eq(schema.customer.id, id)),
        );
        await app.audit(req, {
          action: 'delete',
          entity: 'customer',
          entityId: id,
          before: cliente,
        });
        return reply.send({
          data: { eliminado: true, mensaje: `${cliente.name} se eliminó.` },
          error: null,
        });
      }

      const [desactivado] = await withTenant(businessId, (tx) =>
        tx
          .update(schema.customer)
          .set({ isActive: false })
          .where(eq(schema.customer.id, id))
          .returning(),
      );
      await app.audit(req, {
        action: 'update',
        entity: 'customer',
        entityId: id,
        before: cliente,
        after: { isActive: false, motivo: 'intento de borrado con historial' },
      });
      return reply.send({
        data: {
          eliminado: false,
          desactivado,
          mensaje: mensajeDesactivado(cliente.name, colgando),
          colgando: colgando.detalle,
        },
        error: null,
      });
    },
  );
}
