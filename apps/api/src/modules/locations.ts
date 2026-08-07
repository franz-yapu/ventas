import { schema, withTenant } from '@ventafacil/db';
import { createLocationSchema } from '@ventafacil/shared';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { colgandoDeUbicacion, mensajeDesactivado } from '../lib/borrado.js';
import { revocarTodo } from '../lib/sessions.js';
import type { FastifyInstance } from 'fastify';
import { permiteCrear } from '../lib/subscription.js';

export async function locationRoutes(app: FastifyInstance) {
  app.get('/locations', { preHandler: app.requireAuth }, async (req, reply) => {
    const rows = await withTenant(req.authUser!.businessId, (tx) =>
      tx
        .select()
        .from(schema.location)
        .where(eq(schema.location.businessId, req.authUser!.businessId))
        .orderBy(asc(schema.location.name)),
    );
    return reply.send({ data: rows, error: null });
  });

  // Abrir una sucursal nueva es una decisión del negocio, no de otra sucursal.
  app.post(
    '/locations',
    { preHandler: [app.requireAuth, app.requireCentralAdmin] },
    async (req, reply) => {
      const parsed = createLocationSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ data: null, error: 'Datos invalidos' });
      if (!(await permiteCrear(req.authUser!.businessId, 'locations', reply))) return reply;
      const [row] = await withTenant(req.authUser!.businessId, (tx) =>
        tx
          .insert(schema.location)
          .values({ businessId: req.authUser!.businessId, ...parsed.data })
          .returning(),
      );
      await app.audit(req, { action: 'create', entity: 'location', entityId: row!.id, after: row });
      return reply.code(201).send({ data: row, error: null });
    },
  );

  // Renombrar o desactivar una sucursal, igual: si el encargado de una pudiera
  // desactivar otra, dejaría sin trabajar a un local entero que no es el suyo.
  app.patch(
    '/locations/:id',
    { preHandler: [app.requireAuth, app.requireCentralAdmin] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = createLocationSchema
        .extend({ isActive: z.boolean() })
        .partial()
        .safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ data: null, error: 'Datos invalidos' });
      const [row] = await withTenant(req.authUser!.businessId, (tx) =>
        tx
          .update(schema.location)
          .set(parsed.data)
          .where(
            and(
              eq(schema.location.id, id),
              eq(schema.location.businessId, req.authUser!.businessId),
            ),
          )
          .returning(),
      );
      if (!row) return reply.code(404).send({ data: null, error: 'Ubicacion no encontrada' });
      await app.audit(req, { action: 'update', entity: 'location', entityId: id, after: row });
      return reply.send({ data: row, error: null });
    },
  );

  /**
   * PATCH /locations/:id/principal — mover el cargo de sucursal central.
   *
   * `is_central` estaba en la base desde el principio y no se podía cambiar desde ninguna
   * pantalla, pese a que decide muchísimo: quién administra el negocio, quién ve todas las
   * sucursales, quién exporta. Un negocio que se muda de local no tenía forma de decirlo.
   *
   * Tres cosas hacen falta y ninguna es opcional:
   *
   * 1. **Siempre queda exactamente una.** Se marca la nueva y se desmarca la anterior en
   *    la MISMA transacción. Un negocio sin central es un negocio que nadie puede
   *    administrar; con dos, dos personas se pisan.
   * 2. **Se revocan las sesiones de los afectados.** `isCentral` viaja dentro del token,
   *    así que sin esto el admin de la vieja central seguiría viendo el negocio entero
   *    hasta que le caducara la sesión — 15 minutos de alcance que ya no le corresponde.
   *    Es el mismo razonamiento por el que degradar a un usuario ya revoca.
   * 3. **Lo hace un admin de la central**, que es quien responde por el negocio.
   */
  app.patch(
    '/locations/:id/principal',
    { preHandler: [app.requireAuth, app.requireCentralAdmin] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const businessId = req.authUser!.businessId;

      const resultado = await withTenant(businessId, async (tx) => {
        const [nueva] = await tx
          .select()
          .from(schema.location)
          .where(and(eq(schema.location.id, id), eq(schema.location.businessId, businessId)))
          .limit(1);
        if (!nueva) return null;
        if (!nueva.isActive) return 'inactiva' as const;
        if (nueva.isCentral) return 'ya' as const;

        const anteriores = await tx
          .select({ id: schema.location.id })
          .from(schema.location)
          .where(
            and(eq(schema.location.businessId, businessId), eq(schema.location.isCentral, true)),
          );

        await tx
          .update(schema.location)
          .set({ isCentral: false })
          .where(
            and(eq(schema.location.businessId, businessId), eq(schema.location.isCentral, true)),
          );
        await tx.update(schema.location).set({ isCentral: true }).where(eq(schema.location.id, id));

        // A quién le cambia el alcance: los de la vieja central y los de la nueva.
        const ids = [...anteriores.map((a) => a.id), id];
        const afectados = await tx
          .select({ id: schema.appUser.id })
          .from(schema.appUser)
          .where(
            and(eq(schema.appUser.businessId, businessId), inArray(schema.appUser.locationId, ids)),
          );
        return { nombre: nueva.name, afectados: afectados.map((u) => u.id) };
      });

      if (resultado === null) {
        return reply.code(404).send({ data: null, error: 'Ubicación no encontrada' });
      }
      if (resultado === 'inactiva') {
        return reply
          .code(400)
          .send({ data: null, error: 'No puedes hacer principal a una sucursal desactivada' });
      }
      if (resultado === 'ya') {
        return reply.send({ data: { ok: true, sinCambios: true }, error: null });
      }

      // Fuera del `withTenant` porque `revocarTodo` abre el suyo.
      for (const userId of resultado.afectados) await revocarTodo(businessId, userId);

      await app.audit(req, {
        action: 'update',
        entity: 'location',
        entityId: id,
        after: { esPrincipal: true, sesionesRevocadas: resultado.afectados.length },
      });

      return reply.send({
        data: {
          ok: true,
          mensaje:
            `«${resultado.nombre}» es ahora la sucursal principal. ` +
            'Quien estuviera dentro en la anterior o en la nueva tiene que volver a entrar: ' +
            'su alcance cambió.',
          sesionesRevocadas: resultado.afectados.length,
        },
        error: null,
      });
    },
  );

  /**
   * DELETE /locations/:id — borra si está limpia; si no, desactiva y lo explica.
   *
   * Ver `lib/borrado.ts` para el porqué de contar tantas cosas: las claves foráneas no
   * protegen todo, y `cash_register` cuelga en CASCADE — sin este recuento, borrar una
   * sucursal "vacía" se llevaría por delante su historial de arqueos.
   */
  app.delete(
    '/locations/:id',
    { preHandler: [app.requireAuth, app.requireCentralAdmin] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const businessId = req.authUser!.businessId;

      const [loc] = await withTenant(businessId, (tx) =>
        tx
          .select()
          .from(schema.location)
          .where(and(eq(schema.location.id, id), eq(schema.location.businessId, businessId)))
          .limit(1),
      );
      if (!loc) return reply.code(404).send({ data: null, error: 'Ubicación no encontrada' });

      // La central no se toca: primero hay que mover el cargo (ver arriba). Si no, el
      // negocio se queda sin nadie que pueda administrarlo.
      if (loc.isCentral) {
        return reply.code(409).send({
          data: null,
          error:
            'Es la sucursal principal. Nombra principal a otra antes de eliminarla, o el ' +
            'negocio se queda sin quien lo administre.',
          code: 'es_principal',
        });
      }

      const [cuantas] = await withTenant(businessId, (tx) =>
        tx
          .select({ n: count() })
          .from(schema.location)
          .where(
            and(eq(schema.location.businessId, businessId), eq(schema.location.isActive, true)),
          ),
      );
      if ((cuantas?.n ?? 0) <= 1) {
        return reply
          .code(409)
          .send({ data: null, error: 'Es la única sucursal activa: sin ella no se puede vender.' });
      }

      const colgando = await colgandoDeUbicacion(businessId, id);

      if (colgando.total === 0) {
        await withTenant(businessId, (tx) =>
          tx.delete(schema.location).where(eq(schema.location.id, id)),
        );
        await app.audit(req, {
          action: 'delete',
          entity: 'location',
          entityId: id,
          before: loc,
        });
        return reply.send({
          data: { eliminada: true, mensaje: `«${loc.name}» se eliminó.` },
          error: null,
        });
      }

      const [desactivada] = await withTenant(businessId, (tx) =>
        tx
          .update(schema.location)
          .set({ isActive: false })
          .where(eq(schema.location.id, id))
          .returning(),
      );
      await app.audit(req, {
        action: 'update',
        entity: 'location',
        entityId: id,
        before: loc,
        after: { isActive: false, motivo: 'intento de borrado con historial' },
      });
      return reply.code(200).send({
        data: {
          eliminada: false,
          desactivada,
          mensaje: mensajeDesactivado('la sucursal', colgando),
          colgando: colgando.detalle,
        },
        error: null,
      });
    },
  );
}
