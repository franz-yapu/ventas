import { db, schema, withTenant } from '@ventafacil/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';

/**
 * Exportación de los datos de un negocio.
 *
 * Los datos son del cliente, no de la plataforma. Si un día se va, tiene derecho a
 * llevárselos enteros — sus ventas, sus productos, sus clientes — sin depender de que
 * alguien se los pase a mano. Eso es lo que hace que la exportación sea un requisito
 * legal y no una cortesía.
 *
 * Se devuelve JSON y no CSV a propósito: el CSV para leer en Excel ya existe en los
 * reportes; esto es la copia COMPLETA, con las relaciones intactas, que sirve para
 * migrar a otro sistema o para guardar.
 */
export async function exportRoutes(app: FastifyInstance) {
  /**
   * El tope, montado como preHandler y no en `config`.
   *
   * `config.rateLimit` lo cuenta Fastify en un hook `onRequest`, ANTES de los guardias,
   * así que los rechazos gastaban cupo: a un encargado de sucursal —que no puede
   * exportar— le bastaban cinco intentos fallidos para dejar sin exportaciones durante
   * una hora a TODA la tienda, porque el contador es por IP y todas las cajas salen por
   * la misma. Un tope pensado contra el abuso terminaba castigando al que no hizo nada.
   *
   * Como preHandler va detrás de `requireAuth` y `requireCentralAdmin`, así que sólo
   * cuenta las peticiones que ya demostraron tener derecho a estar ahí — que son las
   * únicas que pueden costar algo, porque son las únicas que llegan a leer la base.
   */
  const limite = app.rateLimit({
    max: app.exportRateLimitMax,
    timeWindow: env.exportRateLimitWindow,
  });

  /**
   * La exportación es un derecho del NEGOCIO, y quien responde por el negocio es la
   * central — el mismo argumento que dejó `PATCH /business` en manos del dueño.
   *
   * Con `requireAdmin` a secas, un encargado de sucursal se descargaba en un solo JSON
   * las ventas de los otros locales, los usuarios de la central con su correo y rol, y
   * los productos con su costo: esta ruta anulaba de un golpe `viewScope()`, el filtro
   * de `users.ts`, `soloLosMios` de la caja y `sinCostos()`. Ocho puertas cerradas y una
   * abierta dan el mismo resultado que ninguna cerrada.
   */
  app.get(
    '/business/export',
    { preHandler: [app.requireAuth, app.requireCentralAdmin, limite] },
    async (req, reply) => {
      const businessId = req.authUser!.businessId;

      // `business`, `subscription` y `plan` viven fuera de RLS (son de plataforma).
      const [biz] = await db
        .select()
        .from(schema.business)
        .where(eq(schema.business.id, businessId))
        .limit(1);
      if (!biz) return reply.code(404).send({ data: null, error: 'Negocio no encontrado' });

      const [sub] = await db
        .select()
        .from(schema.subscription)
        .where(eq(schema.subscription.businessId, businessId))
        .limit(1);

      // Todo lo demás en UNA transacción, para que la copia sea coherente: sin esto,
      // una venta registrada a mitad de la exportación podría salir sin sus líneas.
      const datos = await withTenant(businessId, async (tx) => {
        const usuarios = await tx
          .select({
            id: schema.appUser.id,
            name: schema.appUser.name,
            username: schema.appUser.username,
            email: schema.appUser.email,
            role: schema.appUser.role,
            locationId: schema.appUser.locationId,
            isActive: schema.appUser.isActive,
            createdAt: schema.appUser.createdAt,
          })
          // Nunca se exporta `password_hash`. No le sirve a nadie y su sitio es la base.
          .from(schema.appUser)
          .where(eq(schema.appUser.businessId, businessId));

        const [
          ubicaciones,
          categorias,
          productos,
          inventario,
          clientes,
          abonos,
          ventas,
          lineas,
          cajas,
          movimientos,
          auditoria,
        ] = await Promise.all([
          tx.select().from(schema.location).where(eq(schema.location.businessId, businessId)),
          tx.select().from(schema.category).where(eq(schema.category.businessId, businessId)),
          tx.select().from(schema.product).where(eq(schema.product.businessId, businessId)),
          tx.select().from(schema.inventory).where(eq(schema.inventory.businessId, businessId)),
          tx.select().from(schema.customer).where(eq(schema.customer.businessId, businessId)),
          tx
            .select()
            .from(schema.customerPayment)
            .where(eq(schema.customerPayment.businessId, businessId)),
          tx.select().from(schema.sale).where(eq(schema.sale.businessId, businessId)),
          // `sale_item` no tiene business_id: hereda el tenant de su venta, así que se
          // trae por join en lugar de por filtro directo.
          tx
            .select({
              id: schema.saleItem.id,
              saleId: schema.saleItem.saleId,
              productId: schema.saleItem.productId,
              productNameSnapshot: schema.saleItem.productNameSnapshot,
              unitPriceSnapshot: schema.saleItem.unitPriceSnapshot,
              unitCostSnapshot: schema.saleItem.unitCostSnapshot,
              quantity: schema.saleItem.quantity,
              lineTotal: schema.saleItem.lineTotal,
            })
            .from(schema.saleItem)
            .innerJoin(schema.sale, eq(schema.sale.id, schema.saleItem.saleId))
            .where(eq(schema.sale.businessId, businessId)),
          tx
            .select()
            .from(schema.cashRegister)
            .where(eq(schema.cashRegister.businessId, businessId)),
          tx
            .select()
            .from(schema.cashMovement)
            .where(eq(schema.cashMovement.businessId, businessId)),
          tx.select().from(schema.auditLog).where(eq(schema.auditLog.businessId, businessId)),
        ]);

        // Las líneas se cuelgan de su venta: así el archivo se entiende leyéndolo, sin
        // tener que cruzar dos listas a mano.
        const porVenta = new Map<string, typeof lineas>();
        for (const l of lineas) {
          const arr = porVenta.get(l.saleId) ?? [];
          arr.push(l);
          porVenta.set(l.saleId, arr);
        }

        return {
          usuarios,
          ubicaciones,
          categorias,
          productos,
          inventario,
          clientes,
          abonos,
          ventas: ventas.map((v) => ({ ...v, items: porVenta.get(v.id) ?? [] })),
          cajas,
          movimientosDeCaja: movimientos,
          auditoria,
        };
      });

      await app.audit(req, {
        action: 'export',
        entity: 'business',
        entityId: businessId,
        after: { ventas: datos.ventas.length, productos: datos.productos.length },
      });

      const nombre = `${biz.slug ?? 'negocio'}-${new Date().toISOString().slice(0, 10)}.json`;
      return (
        reply
          .header('Content-Disposition', `attachment; filename="${nombre}"`)
          .header('Content-Type', 'application/json; charset=utf-8')
          // Se responde el objeto DIRECTO, sin el envoltorio { data, error }: esto es un
          // archivo que la persona se descarga, no una respuesta que consuma la app.
          .send({
            exportadoEl: new Date().toISOString(),
            generadoPor: `${env.nodeEnv === 'production' ? '' : '[no producción] '}VentaFácil`,
            negocio: {
              id: biz.id,
              nombre: biz.name,
              subdominio: biz.slug,
              moneda: biz.currency,
              tasaImpuesto: biz.taxRate,
              creadoEl: biz.createdAt,
              terminosAceptadosEl: biz.termsAcceptedAt,
              versionTerminos: biz.termsVersion,
            },
            suscripcion: sub ?? null,
            ...datos,
          })
      );
    },
  );
}
