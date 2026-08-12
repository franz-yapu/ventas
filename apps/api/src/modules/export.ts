import { db, schema, withTenant } from '@ventafacil/db';
import { and, asc, desc, eq, gte, ilike, lte, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ENTITY_LABELS,
  PAYMENT_LABELS,
  SALE_STATUS_LABELS,
} from '@ventafacil/shared';
import { z } from 'zod';
import { env } from '../env.js';
import { filtroDeUbicacion } from '../lib/scope.js';
import { desfaseDe, TZ } from '../lib/zona.js';

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

  /**
   * GET /export/:seccion — los datos de UNA pantalla, con sus mismos filtros.
   *
   * La exportación completa de arriba sirve para migrar o para guardar; esto es lo otro,
   * lo que se pide todos los días: "el listado de ventas de marzo, en Excel".
   *
   * ## Por qué devuelve JSON y el Excel se arma en el navegador
   *
   * Podría generar el .xlsx aquí. No lo hace por dos razones, y la primera pesa más:
   *
   * 1. **El VPS tiene 1 vCPU para todo el stack.** Construir una hoja de cálculo de
   *    20.000 filas es trabajo real de CPU, y mientras dura, la caja de una tienda espera
   *    para cobrar. El navegador de quien pidió el informe está ocioso y ya tiene la
   *    librería cargada — que trabaje él.
   * 2. **Una dependencia menos en el servidor.** El código que corre en producción es el
   *    que hay que mantener y auditar; el que corre en un navegador, no tanto.
   *
   * ## Una sola ruta para todas las secciones
   *
   * Cada pantalla ya sabe filtrar y ya tiene su alcance resuelto. Escribir un exportador
   * por pantalla sería copiar seis veces la misma decisión sobre quién puede ver qué — y
   * es exactamente por ahí por donde se escapan los costos: basta con que uno de los seis
   * se escriba con prisa. Aquí el filtro y `sinCostos` se aplican en un sitio.
   */
  app.get(
    '/export/:seccion',
    { preHandler: [app.requireAuth, app.requireCentralAdmin, limite] },
    async (req, reply) => {
      const { seccion } = req.params as { seccion: string };
      const q = z
        .object({
          /*
            Se acepta `2026-08-09` además del ISO completo.

            Un `<input type="date">` devuelve la fecha pelada, así que exigir ISO obligaba
            a que cada pantalla se acordara de convertirla — y la que no se acordara se
            llevaría un 400 sin más pista que "parámetros inválidos". Es exactamente lo
            que pasó al conectar el primer botón.
          */
          from: z.string().min(8).optional(),
          to: z.string().min(8).optional(),
          locationId: z.string().uuid().optional(),

          /*
            Los filtros que NO son de fecha, y por qué están aquí.

            Esta ruta aceptaba `from`, `to` y `locationId` y nada más, mientras las
            pantallas filtraban por bastante más. Un admin ponía Ventas en «Anuladas», veía
            12 filas, pulsaba PDF y se llevaba un papel titulado «Ventas · del 1 al 31 de
            agosto» con TODAS las completadas dentro. En el Excel ya era un incordio; en el
            PDF es peor, porque la línea de filtros afirma por escrito lo que contiene, y
            ese papel se firma y se archiva.

            Se validan con el mismo criterio que las fechas: lo que no se entiende se
            rechaza. Aceptar un `status=loquesea` e ignorarlo devuelve el listado COMPLETO
            con un 200 — el informe llega, sólo que con todo dentro, que es la peor forma
            de fallar porque nadie lo revisa.
          */
          status: z.enum(['completed', 'cancelled']).optional(),
          // Lo que se teclea en el buscador de Productos. El tope es para que un `%…%` de
          // un kilobyte no se convierta en un recorrido de tabla por capricho.
          search: z.string().trim().min(1).max(100).optional(),
          // Contra las MISMAS listas que llenan los desplegables de la pantalla y que
          // traducen la columna más abajo: si no está ahí, no hay filtro que la pantalla
          // haya podido pedir ni rótulo con el que escribirlo en el papel.
          action: z
            .string()
            .refine((v) => v in AUDIT_ACTION_LABELS)
            .optional(),
          entity: z
            .string()
            .refine((v) => v in AUDIT_ENTITY_LABELS)
            .optional(),
          userId: z.string().uuid().optional(),
        })
        .safeParse(req.query);
      if (!q.success) return reply.code(400).send({ data: null, error: 'Parámetros inválidos' });

      const user = req.authUser!;
      const businessId = user.businessId;

      /**
       * `hasta` con fecha pelada llega al FINAL de ese día.
       *
       * "Del 1 al 9" quiere decir incluyendo el 9. Tomando las 00:00 del 9 se perdería
       * un día entero de ventas sin que nadie lo notara — el informe saldría, sólo que
       * mal, que es la peor forma de fallar.
       */
      /*
        Validar la fecha de verdad, porque `new Date` es demasiado amable.

        Dos trampas que dejaban pasar basura como si fuera una fecha:

        - `2026-02-30` **no falla**: JavaScript la RUEDA al 2 de marzo. Alguien pide hasta
          fin de febrero y recibe marzo, sin ningún aviso.
        - `01-08-2026` tampoco: lo interpreta como el 8 de ENERO. Quien escribe la fecha al
          modo de aquí (día-mes-año) recibe un informe de otro mes y no tiene forma de
          saberlo.

        Por eso se comprueba que los números vuelvan a salir iguales: si el mes o el día
        cambiaron al construir la fecha, es que no existía.
      */
      const soloFecha = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
      const existeDeVerdad = (v: string): boolean => {
        const [a, m, d] = v.split('-').map(Number) as [number, number, number];
        const prueba = new Date(Date.UTC(a, m - 1, d));
        return (
          prueba.getUTCFullYear() === a &&
          prueba.getUTCMonth() === m - 1 &&
          prueba.getUTCDate() === d
        );
      };
      const aFecha = (v: string | undefined, finDelDia: boolean): Date | null => {
        if (!v) return null;
        // O es una fecha pelada válida, o es un instante ISO completo. Nada más.
        if (soloFecha(v)) {
          if (!existeDeVerdad(v)) return null;
        } else if (!/^\d{4}-\d{2}-\d{2}T/.test(v)) {
          return null;
        }
        /*
          Una fecha pelada se interpreta en la zona del NEGOCIO, no en la del servidor.

          `new Date('2026-08-09T00:00:00')` usa la zona del proceso, y el contenedor corre
          en UTC mientras la tienda está en Bolivia (UTC−4). El informe salía corrido
          cuatro horas: se perdía la última tarde del último día y se colaban las últimas
          horas del anterior. El informe se genera igual, sólo que mal — que es la peor
          forma de fallar, porque nadie lo revisa.

          `TZ` es la misma constante que ya usa el arqueo para decidir a qué día pertenece
          una venta; si algún día hay negocios en varias zonas, se cambia en un sitio.
        */
        const d = soloFecha(v)
          ? new Date(`${v}T${finDelDia ? '23:59:59.999' : '00:00:00.000'}${desfaseDe(TZ, v)}`)
          : new Date(v);
        return Number.isNaN(d.getTime()) ? null : d;
      };
      const desde = aFecha(q.data.from, false);
      const hasta = aFecha(q.data.to, true);

      /*
        Una fecha que no se entiende se RECHAZA, no se ignora.

        `aFecha` devolvía `null` tanto para "no vino" como para "no se entiende", así que
        `?from=2026-02-30` o `?from=01-08-2026` daban 200 con el informe COMPLETO. Alguien
        pide las ventas de una semana, recibe las de dos años y no tiene forma de notarlo:
        el archivo llega, sólo que con todo dentro. Fallar en silencio con datos es peor
        que fallar ruidosamente.
      */
      if ((q.data.from && !desde) || (q.data.to && !hasta)) {
        return reply.code(400).send({
          data: null,
          error: 'Esa fecha no se entiende. Usa el formato 2026-08-09.',
        });
      }

      const filas = await withTenant(businessId, async (tx) => {
        switch (seccion) {
          case 'ventas': {
            const w = [eq(schema.sale.businessId, businessId)];
            const alcance = filtroDeUbicacion(user, schema.sale.locationId);
            if (alcance) w.push(alcance);
            if (q.data.locationId) w.push(eq(schema.sale.locationId, q.data.locationId));
            if (q.data.status) w.push(eq(schema.sale.status, q.data.status));
            if (desde) w.push(gte(schema.sale.clientCreatedAt, desde));
            if (hasta) w.push(lte(schema.sale.clientCreatedAt, hasta));
            return tx
              .select({
                Recibo: schema.sale.receiptNumber,
                Fecha: schema.sale.clientCreatedAt,
                Sucursal: schema.location.name,
                Vendedor: schema.appUser.name,
                Cliente: schema.customer.name,
                'Forma de pago': schema.sale.paymentMethod,
                Subtotal: schema.sale.subtotal,
                Descuento: schema.sale.discount,
                Total: schema.sale.total,
                Estado: schema.sale.status,
              })
              .from(schema.sale)
              .leftJoin(schema.location, eq(schema.location.id, schema.sale.locationId))
              .leftJoin(schema.appUser, eq(schema.appUser.id, schema.sale.userId))
              .leftJoin(schema.customer, eq(schema.customer.id, schema.sale.customerId))
              .where(and(...w))
              .orderBy(desc(schema.sale.clientCreatedAt));
          }

          case 'productos': {
            const w = [eq(schema.product.businessId, businessId)];
            /*
              Las tres columnas de `GET /products`, no sólo el nombre.

              Quien teclea un SKU en el buscador ve tres filas y espera bajarse esas tres.
              Buscando sólo por nombre bajaría cero, y un archivo vacío después de una
              búsqueda que sí daba resultados parece un fallo del sistema.

              `locationId` NO se aplica aquí a propósito: en esa pantalla decide de qué
              sucursal es el STOCK que se enseña, no qué productos salen —el catálogo es
              del negocio—, y esta exportación no lleva columna de stock. Aplicarlo
              recortaría un listado que en pantalla no estaba recortado.
            */
            if (q.data.search) {
              const like = `%${q.data.search}%`;
              w.push(
                or(
                  ilike(schema.product.name, like),
                  ilike(schema.product.sku, like),
                  ilike(schema.product.barcode, like),
                )!,
              );
            }
            return tx
              .select({
                Código: schema.product.sku,
                'Código de barras': schema.product.barcode,
                Producto: schema.product.name,
                Descripción: schema.product.description,
                Categoría: schema.category.name,
                Precio: schema.product.price,
                Costo: schema.product.cost,
                Activo: schema.product.isActive,
              })
              .from(schema.product)
              .leftJoin(schema.category, eq(schema.category.id, schema.product.categoryId))
              .where(and(...w))
              .orderBy(asc(schema.product.name));
          }

          case 'inventario':
            return tx
              .select({
                Código: schema.product.sku,
                Producto: schema.product.name,
                Sucursal: schema.location.name,
                Cantidad: schema.inventory.quantity,
                Mínimo: schema.inventory.minStock,
              })
              .from(schema.inventory)
              .innerJoin(schema.product, eq(schema.product.id, schema.inventory.productId))
              .innerJoin(schema.location, eq(schema.location.id, schema.inventory.locationId))
              .where(
                and(
                  eq(schema.inventory.businessId, businessId),
                  q.data.locationId
                    ? eq(schema.inventory.locationId, q.data.locationId)
                    : undefined,
                ),
              )
              .orderBy(asc(schema.product.name), asc(schema.location.name));

          case 'clientes':
            return tx
              .select({
                Cliente: schema.customer.name,
                Teléfono: schema.customer.phone,
                Notas: schema.customer.notes,
                Activo: schema.customer.isActive,
              })
              .from(schema.customer)
              .where(eq(schema.customer.businessId, businessId))
              .orderBy(asc(schema.customer.name));

          case 'caja': {
            const w = [eq(schema.cashRegister.businessId, businessId)];
            const alcance = filtroDeUbicacion(user, schema.cashRegister.locationId);
            if (alcance) w.push(alcance);
            if (desde) w.push(gte(schema.cashRegister.openedAt, desde));
            if (hasta) w.push(lte(schema.cashRegister.openedAt, hasta));
            return tx
              .select({
                Sucursal: schema.location.name,
                Abrió: schema.appUser.name,
                'Abierta el': schema.cashRegister.openedAt,
                'Cerrada el': schema.cashRegister.closedAt,
                'Monto inicial': schema.cashRegister.openingAmount,
                Esperado: schema.cashRegister.expectedAmount,
                Contado: schema.cashRegister.closingAmount,
                Notas: schema.cashRegister.notes,
              })
              .from(schema.cashRegister)
              .leftJoin(schema.location, eq(schema.location.id, schema.cashRegister.locationId))
              .leftJoin(schema.appUser, eq(schema.appUser.id, schema.cashRegister.userId))
              .where(and(...w))
              .orderBy(desc(schema.cashRegister.openedAt));
          }

          case 'actividad': {
            const w = [eq(schema.auditLog.businessId, businessId)];
            if (q.data.action) w.push(eq(schema.auditLog.action, q.data.action));
            if (q.data.entity) w.push(eq(schema.auditLog.entity, q.data.entity));
            if (q.data.userId) w.push(eq(schema.auditLog.userId, q.data.userId));
            if (desde) w.push(gte(schema.auditLog.createdAt, desde));
            if (hasta) w.push(lte(schema.auditLog.createdAt, hasta));
            return tx
              .select({
                Fecha: schema.auditLog.createdAt,
                Quién: schema.appUser.name,
                Acción: schema.auditLog.action,
                Sobre: schema.auditLog.entity,
              })
              .from(schema.auditLog)
              .leftJoin(schema.appUser, eq(schema.appUser.id, schema.auditLog.userId))
              .where(and(...w))
              .orderBy(desc(schema.auditLog.createdAt))
              .limit(20_000);
          }

          default:
            return null;
        }
      });

      if (filas === null) {
        return reply.code(404).send({ data: null, error: 'No se exporta esa sección' });
      }

      /*
        El COSTO se quita a mano, y no con `sinCostosLista`.

        Ese ayudante busca las claves `cost` y `costWholesale`; aquí las columnas se llaman
        `Costo` en español, porque van directas a la primera fila de un Excel. Llamarlo
        parecía una red y no lo era: no habría quitado nada, y el comentario prometía una
        protección inexistente — que es peor que no tener ninguna, porque el siguiente que
        pase lo lee y se queda tranquilo.

        Hoy sólo llega aquí quien puede ver costos (`requireCentralAdmin`). Esto es para el
        día que se abra a un encargado de sucursal, que es una petición razonable.
      */
      const puedeVerCostos = user.role === 'admin';
      const limpias = (filas as Array<Record<string, unknown>>).map((f) => {
        if (puedeVerCostos) return f;
        const { Costo: _c, ...resto } = f;
        return resto;
      });

      /*
        Los códigos se traducen aquí, no en la pantalla.

        Una columna que dice "cash" y otra que dice "completed" en un Excel que se le manda
        al contador no es un detalle: es un archivo que hay que explicar por teléfono. Los
        rótulos salen de `@ventafacil/shared`, los mismos que usa la aplicación, para que no
        haya dos listas que se separen.
      */
      const traducidas = limpias.map((f) => {
        const r: Record<string, unknown> = { ...f };
        const pago = r['Forma de pago'];
        if (typeof pago === 'string' && pago in PAYMENT_LABELS) {
          r['Forma de pago'] = PAYMENT_LABELS[pago as keyof typeof PAYMENT_LABELS];
        }
        const estado = r['Estado'];
        if (typeof estado === 'string' && estado in SALE_STATUS_LABELS) {
          r['Estado'] = SALE_STATUS_LABELS[estado as keyof typeof SALE_STATUS_LABELS];
        }
        const accion = r['Acción'];
        if (typeof accion === 'string' && accion in AUDIT_ACTION_LABELS) {
          r['Acción'] = AUDIT_ACTION_LABELS[accion as keyof typeof AUDIT_ACTION_LABELS];
        }
        const sobre = r['Sobre'];
        if (typeof sobre === 'string' && sobre in AUDIT_ENTITY_LABELS) {
          r['Sobre'] = AUDIT_ENTITY_LABELS[sobre as keyof typeof AUDIT_ENTITY_LABELS];
        }
        // `true`/`false` en una hoja de cálculo se lee peor que Sí/No.
        for (const k of ['Activo']) if (typeof r[k] === 'boolean') r[k] = r[k] ? 'Sí' : 'No';
        return r;
      });

      await app.audit(req, {
        action: 'export',
        entity: 'business',
        after: { seccion, filas: traducidas.length },
      });
      return reply.send({ data: { seccion, filas: traducidas }, error: null });
    },
  );
}
