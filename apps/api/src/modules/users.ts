import { schema, withTenant } from '@ventafacil/db';
import { createUserSchema } from '@ventafacil/shared';
import argon2 from 'argon2';
import { and, asc, count, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { colgandoDeUsuario, mensajeDesactivado } from '../lib/borrado.js';
import { violaUnica } from '../lib/pg-errores.js';
import { esUbicacionDelNegocio, NINGUNA_UBICACION } from '../lib/scope.js';
import { revocarTodo } from '../lib/sessions.js';
import { permiteCrear } from '../lib/subscription.js';

/**
 * ¿Puede este admin administrar a un usuario de esta ubicación?
 *
 * La central administra a cualquiera. El encargado de una sucursal, sólo a la gente de
 * SU sucursal — ni a los de otra, ni a los de la central. Sin esto, el encargado de una
 * sucursal podía crear un usuario en la central (y de paso darle visión de todo el
 * negocio) o cambiarle la contraseña al dueño.
 */
function puedeAdministrarA(
  admin: { isCentral: boolean; locationId: string | null },
  locationId: string | null | undefined,
): boolean {
  if (admin.isCentral) return true;
  return !!locationId && locationId === admin.locationId;
}

/**
 * ¿Es el último administrador ACTIVO de la central que le queda al negocio?
 *
 * Sólo cuentan los de la central: un encargado de sucursal no puede administrar el
 * negocio (ver `requireCentralAdmin`), así que dejar sólo encargados es dejarlo sin nadie.
 */
async function esElUltimoAdminCentral(businessId: string, excepto: string): Promise<boolean> {
  const [row] = await withTenant(businessId, (tx) =>
    tx
      .select({ n: count() })
      .from(schema.appUser)
      .innerJoin(schema.location, eq(schema.location.id, schema.appUser.locationId))
      .where(
        and(
          eq(schema.appUser.businessId, businessId),
          eq(schema.appUser.role, 'admin'),
          eq(schema.appUser.isActive, true),
          eq(schema.location.isCentral, true),
          ne(schema.appUser.id, excepto),
        ),
      ),
  );
  return (row?.n ?? 0) === 0;
}

export async function userRoutes(app: FastifyInstance) {
  // Lista usuarios (sin exponer el hash de contraseña). La sucursal ve sólo los suyos.
  app.get('/users', { preHandler: [app.requireAuth, app.requireAdmin] }, async (req, reply) => {
    const user = req.authUser!;
    const filtros = [eq(schema.appUser.businessId, user.businessId)];
    // Mismo criterio que en el resto de la app: la central ve todo, la sucursal lo suyo.
    if (!user.isCentral) {
      filtros.push(eq(schema.appUser.locationId, user.locationId ?? NINGUNA_UBICACION));
    }
    const rows = await withTenant(user.businessId, (tx) =>
      tx
        .select({
          id: schema.appUser.id,
          name: schema.appUser.name,
          username: schema.appUser.username,
          role: schema.appUser.role,
          locationId: schema.appUser.locationId,
          isActive: schema.appUser.isActive,
        })
        .from(schema.appUser)
        .where(and(...filtros))
        .orderBy(asc(schema.appUser.name)),
    );
    return reply.send({ data: rows, error: null });
  });

  app.post('/users', { preHandler: [app.requireAuth, app.requireAdmin] }, async (req, reply) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ data: null, error: parsed.error.issues[0]?.message });
    }
    // Un vendedor sin ubicación no puede vender NI ver nada: su alcance queda vacío.
    // El formulario la marca "(opcional)" y arranca en "Sin asignar", así que sin esta
    // comprobación el camino por defecto crea empleados con la app muerta.
    if (parsed.data.role === 'seller' && !parsed.data.locationId) {
      return reply.code(400).send({
        data: null,
        error: 'Un vendedor necesita una ubicación: sin ella no podría vender ni ver nada.',
      });
    }

    // El encargado de una sucursal da de alta gente para SU sucursal. Poder elegir otra
    // —la central incluida— sería darse a sí mismo el alcance que no tiene, en dos pasos:
    // creo un usuario en la central, entro con él, veo todo el negocio.
    if (!puedeAdministrarA(req.authUser!, parsed.data.locationId)) {
      return reply.code(403).send({
        data: null,
        error: 'Sólo puedes dar de alta usuarios en tu propia sucursal',
      });
    }

    const businessId = req.authUser!.businessId;
    if (
      parsed.data.locationId &&
      !(await esUbicacionDelNegocio(businessId, parsed.data.locationId))
    ) {
      return reply.code(400).send({ data: null, error: 'Esa ubicación no es de este negocio' });
    }
    if (!(await permiteCrear(businessId, 'users', reply))) return reply;
    const passwordHash = await argon2.hash(parsed.data.password);
    try {
      const [row] = await withTenant(businessId, (tx) =>
        tx
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
          }),
      );
      await app.audit(req, { action: 'create', entity: 'app_user', entityId: row!.id, after: row });
      return reply.code(201).send({ data: row, error: null });
    } catch (e) {
      if (violaUnica(e, 'app_user_business_username_uq')) {
        return reply.code(409).send({ data: null, error: 'Ese usuario ya existe' });
      }
      throw e;
    }
  });

  app.patch(
    '/users/:id',
    { preHandler: [app.requireAuth, app.requireAdmin] },
    async (req, reply) => {
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

      // Se lee el usuario ANTES de tocar nada: hace falta saber de qué sucursal es para
      // decidir si este admin puede administrarlo, y cuál sería su rol final.
      const [actual] = await withTenant(req.authUser!.businessId, (tx) =>
        tx
          .select({ role: schema.appUser.role, locationId: schema.appUser.locationId })
          .from(schema.appUser)
          .where(
            and(eq(schema.appUser.id, id), eq(schema.appUser.businessId, req.authUser!.businessId)),
          )
          .limit(1),
      );
      if (!actual) return reply.code(404).send({ data: null, error: 'Usuario no encontrado' });

      // Sobre quién está actuando: tiene que ser de su sucursal.
      if (!puedeAdministrarA(req.authUser!, actual.locationId)) {
        return reply.code(403).send({
          data: null,
          error: 'Sólo puedes administrar usuarios de tu propia sucursal',
        });
      }
      // Y a dónde lo estaría mandando: mover a alguien a otra sucursal (o a la central)
      // es sacarlo de su alcance, así que también es cosa de la central.
      if (
        parsed.data.locationId !== undefined &&
        !puedeAdministrarA(req.authUser!, parsed.data.locationId)
      ) {
        return reply.code(403).send({
          data: null,
          error: 'No puedes mover un usuario a otra sucursal',
        });
      }

      // Y que exista dentro de este negocio (ver `esUbicacionDelNegocio`).
      if (
        parsed.data.locationId &&
        !(await esUbicacionDelNegocio(req.authUser!.businessId, parsed.data.locationId))
      ) {
        return reply.code(400).send({ data: null, error: 'Esa ubicación no es de este negocio' });
      }

      // Mismo motivo que al crear: dejar a un vendedor sin ubicación lo deja sin app.
      if (parsed.data.locationId === null) {
        const rolFinal = parsed.data.role ?? actual.role;
        if (rolFinal === 'seller') {
          return reply.code(400).send({
            data: null,
            error: 'Un vendedor necesita una ubicación: sin ella no podría vender ni ver nada.',
          });
        }
      }

      /*
        No dejar al negocio sin nadie que lo administre.

        Desactivar al último admin de la central, o degradarlo a vendedor, deja el negocio
        sin quien pueda crear usuarios, abrir sucursales o tocar la configuración — y sin
        nadie que pueda deshacerlo desde dentro. Se sale de ahí llamando a soporte para
        que use el rescate del panel, que es un rodeo caro para un descuido de un clic.

        `platform.ts` ya resolvió exactamente esto para los operadores principales
        (`principalesActivos`) y no se trasladó aquí. Es la misma pregunta.
      */
      const seQuedaSinAdmin =
        (parsed.data.isActive === false || parsed.data.role === 'seller') &&
        actual.role === 'admin';
      if (seQuedaSinAdmin && (await esElUltimoAdminCentral(req.authUser!.businessId, id))) {
        return reply.code(409).send({
          data: null,
          error:
            'Es el último administrador del negocio. Nombra a otro antes de quitarle el cargo, o nadie podrá administrarlo.',
          code: 'ultimo_admin',
        });
      }

      // Un cuerpo vacío no es un error del servidor: es una petición sin nada dentro.
      // Sin esto, `{}` reventaba con un 500 — y cada 500 manda un aviso por correo.
      if (Object.keys(parsed.data).length === 0) {
        return reply.code(400).send({ data: null, error: 'No hay nada que cambiar' });
      }

      const patch: Record<string, unknown> = { ...parsed.data };
      if (parsed.data.password) {
        patch.passwordHash = await argon2.hash(parsed.data.password);
        delete patch.password;
      }
      const [row] = await withTenant(req.authUser!.businessId, (tx) =>
        tx
          .update(schema.appUser)
          .set(patch)
          .where(
            and(eq(schema.appUser.id, id), eq(schema.appUser.businessId, req.authUser!.businessId)),
          )
          .returning({
            id: schema.appUser.id,
            name: schema.appUser.name,
            username: schema.appUser.username,
            role: schema.appUser.role,
            locationId: schema.appUser.locationId,
            isActive: schema.appUser.isActive,
          }),
      );
      if (!row) return reply.code(404).send({ data: null, error: 'Usuario no encontrado' });

      /**
       * Dar de baja a alguien, cambiarle la contraseña, BAJARLE EL RANGO o MOVERLO de
       * sucursal tiene que echarlo de donde esté.
       *
       * Las dos primeras ya lo hacían; las dos últimas no, y ahí estaba el agujero:
       * `/auth/refresh` copia el rol, la ubicación y `isCentral` del propio token de
       * refresco sin releer la base, y ese token vive 30 días. Así que bajar a un admin a
       * vendedor —o sacarlo de la central— no le quitaba nada: seguía renovando accesos de
       * administrador durante un mes. Es la misma escalada que se cerró por la puerta del
       * alcance, entrando por la puerta del tiempo.
       *
       * Se compara contra lo que era, no contra lo que se mandó: reenviar el mismo rol no
       * es un cambio y no tiene por qué cerrarle la sesión a nadie.
       */
      const bajaDeRango = parsed.data.role !== undefined && parsed.data.role !== actual.role;
      const cambioDeSucursal =
        parsed.data.locationId !== undefined && parsed.data.locationId !== actual.locationId;
      if (
        parsed.data.isActive === false ||
        parsed.data.password ||
        bajaDeRango ||
        cambioDeSucursal
      ) {
        await revocarTodo(req.authUser!.businessId, id);
      }

      await app.audit(req, { action: 'update', entity: 'app_user', entityId: id, after: row });
      return reply.send({ data: row, error: null });
    },
  );

  /**
   * DELETE /users/:id — borra si no ha hecho nada; si ha hecho algo, desactiva y lo dice.
   *
   * Ver `lib/borrado.ts`. Aquí lo que las claves foráneas NO defienden son los movimientos
   * de caja y la bitácora: los dos quedan en SET NULL, así que un borrado físico dejaría un
   * retiro sin saber quién lo hizo —indistinguible de un faltante— y una bitácora sin
   * autor, que es como no tener bitácora, porque su único trabajo es decir quién hizo qué.
   */
  app.delete(
    '/users/:id',
    { preHandler: [app.requireAuth, app.requireAdmin] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const businessId = req.authUser!.businessId;

      const [actual] = await withTenant(businessId, (tx) =>
        tx
          .select()
          .from(schema.appUser)
          .where(and(eq(schema.appUser.id, id), eq(schema.appUser.businessId, businessId)))
          .limit(1),
      );
      if (!actual) return reply.code(404).send({ data: null, error: 'Usuario no encontrado' });

      // Un encargado sólo administra a los suyos, igual que al editar.
      if (!puedeAdministrarA(req.authUser!, actual.locationId)) {
        return reply
          .code(403)
          .send({ data: null, error: 'Sólo puedes administrar usuarios de tu propia sucursal' });
      }

      // Nadie se borra a sí mismo: quedarse fuera de la propia cuenta por un clic es un
      // rodeo caro (hay que llamar a soporte) para algo que no aporta nada.
      if (id === req.authUser!.sub) {
        return reply.code(409).send({ data: null, error: 'No puedes eliminar tu propia cuenta.' });
      }

      if (actual.role === 'admin' && (await esElUltimoAdminCentral(businessId, id))) {
        return reply.code(409).send({
          data: null,
          error:
            'Es el último administrador del negocio. Nombra a otro antes de eliminarlo, o ' +
            'nadie podrá administrarlo.',
          code: 'ultimo_admin',
        });
      }

      const colgando = await colgandoDeUsuario(businessId, id);

      // En cualquiera de los dos caminos se le cierran las sesiones: si se borra, su token
      // apuntaría a un usuario que ya no está; si se desactiva, es lo que ya se hacía.
      await revocarTodo(businessId, id);

      if (colgando.total === 0) {
        await withTenant(businessId, (tx) =>
          tx.delete(schema.appUser).where(eq(schema.appUser.id, id)),
        );
        await app.audit(req, {
          action: 'delete',
          entity: 'app_user',
          entityId: id,
          before: { name: actual.name, username: actual.username, role: actual.role },
        });
        return reply.send({
          data: { eliminado: true, mensaje: `${actual.name} se eliminó.` },
          error: null,
        });
      }

      const [desactivado] = await withTenant(businessId, (tx) =>
        tx
          .update(schema.appUser)
          .set({ isActive: false })
          .where(eq(schema.appUser.id, id))
          .returning({
            id: schema.appUser.id,
            name: schema.appUser.name,
            isActive: schema.appUser.isActive,
          }),
      );
      await app.audit(req, {
        action: 'update',
        entity: 'app_user',
        entityId: id,
        after: { isActive: false, motivo: 'intento de borrado con historial' },
      });
      return reply.send({
        data: {
          eliminado: false,
          desactivado,
          mensaje: mensajeDesactivado(actual.name, colgando),
          colgando: colgando.detalle,
        },
        error: null,
      });
    },
  );
}
