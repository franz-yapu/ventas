import { db, schema, withTenant } from '@ventafacil/db';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTenant, makeApp, resetDb, type Tenant } from './helpers.js';

/**
 * Compradores: a quién se le vendió, y quién puede tocarlo.
 *
 * Este módulo era el del fiado. Al quitarse, se quedó en listar y crear, y con la pantalla
 * de Clientes le vuelven el detalle, la edición y el borrado — o sea, tres rutas nuevas que
 * tocan un registro enlazado desde ventas ya cerradas.
 *
 * Lo que se fija aquí:
 *
 * - **La aritmética del historial.** Cuántas compras lleva, cuándo fue la última y cuánto
 *   ha gastado. Es el único motivo por el que la pantalla existe; si el número miente, es
 *   peor que no tenerlo.
 * - **Que editar no borre lo que no se tocó.** Un PATCH con sólo el nombre no puede dejar
 *   el teléfono en NULL.
 * - **Borrar o desactivar**, igual que sucursales y usuarios: `sale.customer_id` cuelga en
 *   SET NULL, así que un borrado a secas no falla — deja ventas sin saber a quién se le
 *   hicieron.
 * - **Quién puede qué**: crear lo hace cualquiera (el alta rápida vive en la pantalla de
 *   cobro); editar y borrar, sólo administrador.
 */

let app: FastifyInstance;
let t: Tenant;
let otro: Tenant;
let vendedorToken = '';

/** Un comprador nuevo, sin historial. */
async function crearComprador(nombre: string, token = t.adminToken): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/customers',
    headers: auth(token),
    payload: { name: nombre, phone: '77712345' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().data.id;
}

/** Una venta suya, insertada directo: aquí se prueba el historial, no el flujo de venta. */
async function venderle(
  customerId: string,
  total: string,
  receipt: number,
  status: 'completed' | 'cancelled' = 'completed',
) {
  await db.insert(schema.sale).values({
    id: crypto.randomUUID(),
    businessId: t.businessId,
    locationId: t.locationId,
    userId: t.adminId,
    customerId,
    status,
    subtotal: total,
    total,
    paymentMethod: 'cash',
    receiptNumber: receipt,
    clientCreatedAt: new Date(),
  });
}

const lista = async (token = t.adminToken) =>
  (await app.inject({ method: 'GET', url: '/api/v1/customers', headers: auth(token) })).json().data;

const detalle = async (id: string, token = t.adminToken) =>
  app.inject({ method: 'GET', url: `/api/v1/customers/${id}`, headers: auth(token) });

beforeAll(async () => {
  app = await makeApp();
  await resetDb();
  t = await createTenant(app, 'compradores-a');
  otro = await createTenant(app, 'compradores-b');

  await db.insert(schema.appUser).values({
    businessId: t.businessId,
    locationId: t.locationId,
    name: 'Vendedora',
    username: 'vendedora',
    passwordHash: await argon2.hash('secreto123'),
    role: 'seller',
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'vendedora', password: 'secreto123', business: 'compradores-a' },
  });
  vendedorToken = login.json().data.accessToken;
});

afterAll(async () => {
  await app.close();
});

describe('la lista', () => {
  it('trae cuántas compras lleva cada uno', async () => {
    // El tenant nace con un comprador y una venta suya (ver `helpers.ts`).
    const fila = (await lista()).find((c: any) => c.id === t.customerId);
    expect(fila.compras).toBe(1);
    expect(fila.ultimaCompra).toBeTruthy();
  });

  it('uno que nunca compró sale en CERO, no ausente ni en null', async () => {
    // El `LEFT JOIN` es lo que lo garantiza; con un join normal desaparecería de la lista,
    // y quien acaba de darlo de alta pensaría que no se guardó.
    const id = await crearComprador('Recién llegado');
    const fila = (await lista()).find((c: any) => c.id === id);
    expect(fila).toBeTruthy();
    expect(fila.compras).toBe(0);
    expect(fila.ultimaCompra).toBeNull();
  });

  /**
   * La columna «compras» cuenta lo MISMO que el dinero: sólo las completadas.
   *
   * El `count` de la lista no filtraba por estado y el `totalGastado` del detalle sí, así
   * que un cliente cuyas dos únicas compras se anularon aparecía con «2 compras» y
   * «Bs. 0.00» gastados. Dos cifras de la misma pantalla respondiendo preguntas distintas
   * sin decirlo, y `ultimaCompra` apuntando a una venta que ya no cuenta.
   *
   * Decisión de producto (franz, 12 de agosto de 2026): la columna responde «cuánto me ha
   * comprado», no «cuántas veces pasó por caja». Lo anulado no es una compra.
   */
  it('las ANULADAS no cuentan como compras, igual que no cuentan como dinero', async () => {
    const id = await crearComprador('Todo devuelto');
    await venderle(id, '200.00', 930, 'cancelled');
    await venderle(id, '300.00', 931, 'cancelled');

    const fila = (await lista()).find((c: any) => c.id === id);
    expect(fila.compras, '«2 compras» junto a «Bs. 0.00» gastados').toBe(0);
    expect(fila.ultimaCompra, 'apunta a una venta que ya no cuenta').toBeNull();
  });

  it('y con una anulada de por medio, cuenta las buenas y la fecha es la de la buena', async () => {
    const id = await crearComprador('Compró y luego devolvió');
    await venderle(id, '100.00', 940);
    // La anulada es la MÁS RECIENTE: es la que se llevaba `ultimaCompra` por delante.
    await venderle(id, '500.00', 941, 'cancelled');

    const fila = (await lista()).find((c: any) => c.id === id);
    expect(fila.compras).toBe(1);
    expect(fila.ultimaCompra).toBeTruthy();

    // Y coincide con lo que dice el detalle, que es lo que se abre justo después.
    const d = (await detalle(id)).json().data;
    expect(d.comprasCompletadas).toBe(fila.compras);
    expect(Number(d.totalGastado)).toBe(100);
    // El historial sí las enseña las dos: es parte de lo que pasó con este comprador.
    expect(d.compras).toHaveLength(2);
    expect(d.comprasRegistradas).toBe(2);
  });

  it('los DESACTIVADOS siguen en la lista, marcados', async () => {
    /*
      A propósito: un comprador desactivado sigue siendo el dueño de su historial, y
      esconderlo aquí haría que sus compras parecieran de nadie. Quien lo filtra es el POS,
      porque ahí lo que se ofrece es a quién vender hoy.
    */
    const id = await crearComprador('Ya no viene');
    await db.update(schema.customer).set({ isActive: false }).where(eq(schema.customer.id, id));

    const fila = (await lista()).find((c: any) => c.id === id);
    expect(fila, 'el desactivado desapareció de la lista').toBeTruthy();
    expect(fila.isActive).toBe(false);
  });

  it('no se ven los compradores de otro negocio', async () => {
    const ids = (await lista()).map((c: any) => c.id);
    expect(ids).not.toContain(otro.customerId);
  });
});

describe('el detalle, que es para lo que existe la pantalla', () => {
  it('trae sus compras, con recibo, sucursal y fecha', async () => {
    const res = await detalle(t.customerId);
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.compras).toHaveLength(1);
    expect(d.compras[0].receiptNumber).toBe(1);
    expect(d.compras[0].locationName).toBeTruthy();
    expect(d.compras[0].total).toBe('100.00');
  });

  it('suma lo gastado, y las ANULADAS no cuentan', async () => {
    // Una venta anulada aparece en el historial —es parte de lo que pasó— pero no es
    // dinero que este comprador haya dejado en el negocio.
    const id = await crearComprador('Compra y devuelve');
    await venderle(id, '200.00', 900);
    await venderle(id, '500.00', 901, 'cancelled');

    const d = (await detalle(id)).json().data;
    expect(d.compras).toHaveLength(2);
    expect(Number(d.totalGastado)).toBe(200);
  });

  /**
   * El historial se corta en 50, y el número de arriba NO.
   *
   * El modal contaba `compras.length` —o sea, la página— y lo emparejaba con un
   * `totalGastado` calculado sobre TODAS. Un cliente de 52 compras salía como «50 compras»
   * con el gasto de 52: el ticket medio parecía otro, y el corte no se decía en ninguna
   * parte, así que un recibo más antiguo que el 50.º simplemente no aparecía — que es
   * justo la pregunta para la que se hizo la pantalla.
   */
  it('devuelve cuántas compras hay DE VERDAD, aunque la lista venga cortada', async () => {
    const id = await crearComprador('Cliente de toda la vida');
    // 52 completadas y 2 anuladas: pasa del corte de 50 y además distingue las dos cifras.
    for (let i = 0; i < 52; i++) await venderle(id, '10.00', 5000 + i);
    await venderle(id, '99.00', 5100, 'cancelled');
    await venderle(id, '99.00', 5101, 'cancelled');

    const d = (await detalle(id)).json().data;
    expect(d.compras, 'la lista sigue cortada, que es lo que la hace barata').toHaveLength(50);
    expect(d.comprasRegistradas, 'la cuenta se quedó en la página').toBe(54);
    // La cifra que se empareja con el gasto cuenta lo mismo que el gasto: sólo completadas.
    expect(d.comprasCompletadas).toBe(52);
    expect(Number(d.totalGastado)).toBe(520);
  });

  it('el de otro negocio responde 404, no sus datos', async () => {
    expect((await detalle(otro.customerId)).statusCode).toBe(404);
  });

  it('un identificador que no es uuid es 400, no 500', async () => {
    expect((await detalle('no-soy-un-uuid')).statusCode).toBe(400);
  });
});

describe('editar', () => {
  const editar = (id: string, body: unknown, token = t.adminToken) =>
    app.inject({
      method: 'PATCH',
      url: `/api/v1/customers/${id}`,
      headers: auth(token),
      payload: body,
    });

  it('cambia el nombre y NO borra lo que no vino', async () => {
    /*
      El fallo fácil de este endpoint: volcar el objeto entero y escribir `null` en el
      teléfono de quien sólo corrigió una letra del nombre. La diferencia entre "no lo
      toco" y "bórralo" es que la clave esté o no en el cuerpo.
    */
    const id = await crearComprador('Maria Quispe');
    const res = await editar(id, { name: 'María Quispe' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.name).toBe('María Quispe');
    expect(res.json().data.phone, 'se llevó por delante el teléfono').toBe('77712345');
  });

  it('un teléfono vacío SÍ lo borra: es lo que pidió quien lo vació', async () => {
    const id = await crearComprador('Sin telefono');
    const res = await editar(id, { phone: '' });
    expect(res.json().data.phone).toBeNull();
  });

  it('lo puede sacar de la lista de venta sin borrarlo', async () => {
    const id = await crearComprador('De baja');
    expect((await editar(id, { isActive: false })).json().data.isActive).toBe(false);
  });

  it('un cuerpo vacío es 400 y lo dice: no es una operación válida', async () => {
    const id = await crearComprador('Nada que cambiar');
    const res = await editar(id, {});
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('nada que cambiar');
  });

  it('un nombre en blanco no pasa', async () => {
    const id = await crearComprador('Con nombre');
    expect((await editar(id, { name: '' })).statusCode).toBe(400);
  });

  /**
   * Ni uno hecho sólo de espacios, que es el que se colaba.
   *
   * El recorte se hacía en la ruta —`cambios.name = d.name.trim()`— DESPUÉS de validar, así
   * que `{ name: "   " }` cumplía el `.min(1)` de zod y lo que se guardaba era `""`. A
   * partir de ahí el cliente salía con la celda Nombre en blanco en la tabla, la
   * confirmación de borrado decía «¿Eliminar a ?», y la columna «Cliente» del recibo y de
   * la exportación de ventas salían vacías en TODAS sus ventas — sin forma de saber desde
   * la lista de quién se trataba.
   */
  it('ni uno hecho sólo de espacios, que acababa guardándose vacío', async () => {
    const id = await crearComprador('Con nombre de verdad');
    expect((await editar(id, { name: '   ' })).statusCode).toBe(400);

    // Y el que había sigue intacto: un 400 no puede dejar el registro a medias.
    const [c] = await db.select().from(schema.customer).where(eq(schema.customer.id, id));
    expect(c!.name).toBe('Con nombre de verdad');
  });

  it('el nombre se guarda recortado, no con los espacios de los lados', async () => {
    const id = await crearComprador('Sin recortar');
    expect((await editar(id, { name: '  María Quispe  ' })).json().data.name).toBe('María Quispe');
  });

  it('un VENDEDOR no edita: es un registro enlazado desde ventas cerradas', async () => {
    const id = await crearComprador('Intocable');
    expect((await editar(id, { name: 'Otro' }, vendedorToken)).statusCode).toBe(403);
  });

  it('el de otro negocio es 404', async () => {
    expect((await editar(otro.customerId, { name: 'Ajeno' })).statusCode).toBe(404);
  });
});

describe('eliminar: borrar o desactivar', () => {
  const eliminar = (id: string, token = t.adminToken) =>
    app.inject({ method: 'DELETE', url: `/api/v1/customers/${id}`, headers: auth(token) });

  it('uno que nunca compró se BORRA de verdad', async () => {
    // Un error de tecleo al dar de alta no tiene por qué quedarse para siempre.
    const id = await crearComprador('Error de tecleo');
    const res = await eliminar(id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.eliminado).toBe(true);

    const [c] = await db.select().from(schema.customer).where(eq(schema.customer.id, id));
    expect(c).toBeUndefined();
  });

  it('uno CON COMPRAS no: se desactiva y se dice cuántas', async () => {
    /*
      `sale.customer_id` cuelga en SET NULL, así que un `DELETE` a secas no habría fallado
      — habría dejado dos ventas cerradas sin saber a quién se le hicieron, que es
      justamente lo que un recibo necesita responder meses después.
    */
    const id = await crearComprador('Cliente de años');
    await venderle(id, '50.00', 910);
    await venderle(id, '70.00', 911);

    const res = await eliminar(id);
    expect(res.json().data.eliminado).toBe(false);
    expect(res.json().data.mensaje).toContain('2 compras registradas');
    expect(res.json().data.colgando).toEqual(['2 compras registradas']);

    const [c] = await db.select().from(schema.customer).where(eq(schema.customer.id, id));
    expect(c!.isActive).toBe(false);

    // Y sus ventas siguen sabiendo de quién son, que era el punto.
    const ventas = await db.select().from(schema.sale).where(eq(schema.sale.customerId, id));
    expect(ventas).toHaveLength(2);
  });

  it('con UNA sola compra el mensaje va en singular', async () => {
    // El plural mal puesto en el único mensaje que explica por qué no se pudo borrar hace
    // dudar del resto del mensaje.
    const id = await crearComprador('Una vez');
    await venderle(id, '10.00', 920);
    expect((await eliminar(id)).json().data.mensaje).toContain('1 compra registrada');
  });

  /**
   * Comprobar y borrar tienen que ser la MISMA operación, y con la fila tomada.
   *
   * `colgandoDeComprador()` contaba en su propia transacción y el `delete` corría en otra.
   * Entre las dos cabe una venta: un admin borra a «Recién llegado» (0 compras) justo
   * cuando un cajero cierra su primera venta — la cuenta ya devolvió 0, el comprador se
   * borra en duro y `sale.customer_id` cae a NULL. El recibo recién emitido pierde para
   * siempre a quién iba dirigido, que es exactamente la pérdida que la política de
   * borrar-o-desactivar existe para evitar, y el API responde «se eliminó» sin decir que
   * algo quedó huérfano.
   *
   * ⚠️ Juntarlas en una transacción NO bastaba. En READ COMMITTED —el modo de siempre— un
   * `SELECT count(*)` no bloquea nada: la venta se puede confirmar justo después de contar
   * y el `DELETE` sigue adelante igual. Lo que cierra la ventana es tomar la fila del
   * comprador con `FOR UPDATE` antes de contar. Un INSERT en `sale` toma `FOR KEY SHARE`
   * sobre la fila que referencia, así que los dos caminos se serializan: o esperamos a que
   * la venta se confirme —y entonces la contamos, y el comprador se desactiva en vez de
   * borrarse—, o llegamos antes y es la venta la que se encuentra con que ya no existe.
   *
   * El test fuerza esa carrera en vez de esperar a tener suerte: deja una venta insertada
   * en una transacción SIN CONFIRMAR, lanza el borrado, y la confirma después.
   */
  it('una venta que llega a la vez NO deja el comprador borrado y el recibo huérfano', async () => {
    const id = await crearComprador('Recién llegado a media venta');
    const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // La venta del cajero, abierta y sin confirmar: toma la fila del comprador y la
    // mantiene tomada mientras el admin intenta borrarlo.
    let confirmar!: () => void;
    const venta = withTenant(t.businessId, async (tx) => {
      await tx.insert(schema.sale).values({
        id: crypto.randomUUID(),
        businessId: t.businessId,
        locationId: t.locationId,
        userId: t.adminId,
        customerId: id,
        subtotal: '75.00',
        total: '75.00',
        paymentMethod: 'cash',
        receiptNumber: 970,
        clientCreatedAt: new Date(),
      });
      await new Promise<void>((res) => {
        confirmar = res;
      });
    });
    await esperar(150);

    const borrado = eliminar(id); // sin `await`: se queda esperando la fila
    await esperar(150);
    confirmar();
    await venta;

    const res = await borrado;
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.eliminado, 'se borró con una venta suya en vuelo').toBe(false);
    expect(res.json().data.mensaje).toContain('1 compra registrada');

    // Y el recibo sigue sabiendo de quién es, que es todo el asunto.
    const ventas = await db.select().from(schema.sale).where(eq(schema.sale.customerId, id));
    expect(ventas, 'el recibo se quedó sin comprador').toHaveLength(1);
  });

  it('un VENDEDOR no elimina', async () => {
    const id = await crearComprador('A salvo');
    expect((await eliminar(id, vendedorToken)).statusCode).toBe(403);
  });

  it('el de otro negocio es 404, y sigue vivo', async () => {
    expect((await eliminar(otro.customerId)).statusCode).toBe(404);
    const [c] = await db
      .select()
      .from(schema.customer)
      .where(eq(schema.customer.id, otro.customerId));
    expect(c, 'se borró el comprador de otro negocio').toBeTruthy();
  });
});

describe('el alta rápida del mostrador', () => {
  it('un VENDEDOR sí puede crear: es lo que hace al cobrar', async () => {
    // Si esto pidiera administrador, quien atiende tendría que ir a buscar a alguien para
    // poder poner un nombre en un recibo.
    const id = await crearComprador('Doña Rosa', vendedorToken);
    expect(id).toBeTruthy();
  });

  it('sin nombre no se crea', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/customers',
      headers: auth(vendedorToken),
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  /*
    El alta va por el MISMO esquema que la edición, así que el arreglo del recorte tiene
    que cubrir las dos puertas. Ésta es la que más se usa: es el alta rápida del mostrador,
    con alguien tecleando deprisa mientras cobra.
  */
  it('un nombre de sólo espacios tampoco crea un cliente sin nombre', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/customers',
      headers: auth(vendedorToken),
      payload: { name: '   ' },
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it('y el que sí tiene nombre se guarda recortado', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/customers',
      headers: auth(vendedorToken),
      payload: { name: '  Doña Rosa  ' },
    });
    expect(res.json().data.name).toBe('Doña Rosa');
  });
});

/**
 * El alcance por sucursal del HISTORIAL.
 *
 * El comprador es del negocio —quien compró en Norte puede volver por la Central— y por eso
 * esta pantalla no filtra por ubicación. Pero sus COMPRAS sí son de una sucursal, y ahí
 * manda la misma regla que en `GET /sales`: un vendedor vende donde está, no supervisa a
 * nadie.
 *
 * Esto se rompió al quitar el fiado, y de la peor manera: la excepción al alcance estaba
 * escrita a propósito y justificada por escrito («lo que se fía se le fía AL NEGOCIO»),
 * pero quien la sostenía era el filtro `payment_method = 'credit'`. Al irse el fiado se fue
 * el filtro y **se quedó la excepción**, ya sin nada que la justificara. La lección: un
 * comentario que justifica una excepción deja de justificarla cuando cambia lo que hay
 * debajo.
 */
describe('el historial no cruza sucursales', () => {
  let norteToken = '';
  let compradorId = '';

  beforeAll(async () => {
    const [norte] = await db
      .insert(schema.location)
      .values({ businessId: t.businessId, name: 'Norte', isCentral: false })
      .returning();

    await db.insert(schema.appUser).values({
      businessId: t.businessId,
      locationId: norte!.id,
      name: 'Vendedor del Norte',
      username: 'vendedor.norte',
      passwordHash: await argon2.hash('secreto123'),
      role: 'seller',
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'vendedor.norte', password: 'secreto123', business: 'compradores-a' },
    });
    norteToken = login.json().data.accessToken;

    // Un comprador con DOS ventas en la Central y ninguna en Norte.
    compradorId = await crearComprador('Cliente de la Central');
    await venderle(compradorId, '500.00', 9001);
    await venderle(compradorId, '300.00', 9002);
  });

  it('el vendedor de otra sucursal no ve las compras hechas en la Central', async () => {
    const res = await detalle(compradorId, norteToken);
    expect(res.statusCode, res.body).toBe(200);
    const d = res.json().data;
    // El comprador SÍ se ve —es del negocio, y lo necesita para venderle hoy—, pero su
    // historial de otra sucursal no.
    expect(d.name).toBe('Cliente de la Central');
    expect(d.compras, 'se filtraron ventas de otra sucursal').toHaveLength(0);
  });

  it('tampoco se le escapa por el total gastado', async () => {
    // El total es un solo número, pero dice cuánto factura la otra sucursal con ese
    // cliente. Filtrar la lista y dejar la suma sería cerrar la puerta y abrir la ventana.
    const d = (await detalle(compradorId, norteToken)).json().data;
    expect(Number(d.totalGastado), 'el total delata las ventas de otra sucursal').toBe(0);
  });

  it('ni por la cuenta de compras de la lista', async () => {
    const fila = (await lista(norteToken)).find((c: any) => c.id === compradorId);
    expect(fila, 'el comprador desapareció de la lista').toBeTruthy();
    expect(fila.compras, 'la cuenta incluye ventas de otra sucursal').toBe(0);
  });

  it('el admin de la central sigue viéndolo todo', async () => {
    const d = (await detalle(compradorId)).json().data;
    expect(d.compras).toHaveLength(2);
    expect(Number(d.totalGastado)).toBe(800);
  });
});
