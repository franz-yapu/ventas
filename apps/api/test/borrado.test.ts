import { db, schema } from '@ventafacil/db';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearUserCache } from '../src/lib/sessions.js';
import { auth, createTenant, makeApp, resetDb, type Tenant } from './helpers.js';

/**
 * Eliminar una sucursal o un usuario: borrar de verdad, o desactivar.
 *
 * La política pedida: si no cuelga nada, se borra físicamente —un error de tecleo al dar
 * de alta no tiene por qué quedarse para siempre—; si cuelga algo, se desactiva y se dice
 * QUÉ cuelga y CUÁNTO.
 *
 * Lo que de verdad se está protegiendo aquí no es la política sino lo que hay debajo: las
 * claves foráneas NO defienden todo. `cash_register.location_id` cuelga en **CASCADE**, así
 * que un borrado sin contar antes se llevaría el historial de arqueos de una sucursal que
 * parecía vacía porque no tenía ventas. Y de un usuario, `cash_movement` y `audit_log`
 * quedan en SET NULL: el registro sobrevive sin saber quién lo hizo, que en el caso de la
 * bitácora es lo mismo que no tenerla.
 */

let app: FastifyInstance;
let t: Tenant;

beforeAll(async () => {
  app = await makeApp();
  await resetDb();
  t = await createTenant(app, 'borrado');
});

afterAll(async () => {
  await app.close();
});

async function crearSucursal(nombre: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/locations',
    headers: auth(t.adminToken),
    payload: { name: nombre },
  });
  return res.json().data.id;
}

/**
 * Vuelve a entrar y actualiza el token del admin.
 *
 * Hace falta porque mover el cargo de sucursal principal REVOCA las sesiones de los
 * afectados —`isCentral` viaja dentro del token—, así que después de cada cambio el token
 * anterior ya no vale. Que los tests tengan que hacer esto es, en sí, la prueba de que la
 * revocación funciona.
 */
/** Sucursal con un admin dentro: es lo que exige poder hacerla principal. */
async function crearSucursalConAdmin(nombre: string, usuario: string): Promise<string> {
  const id = await crearSucursal(nombre);
  await app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: auth(t.adminToken),
    payload: {
      name: `Admin de ${nombre}`,
      username: usuario,
      password: 'secreto123',
      role: 'admin',
      locationId: id,
    },
  });
  return id;
}

async function reentrar(): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'secreto123', business: t.slug },
  });
  t.adminToken = res.json().data.accessToken;
}

async function existeSucursal(id: string): Promise<boolean> {
  const [r] = await db.select().from(schema.location).where(eq(schema.location.id, id));
  return !!r;
}

describe('eliminar una sucursal', () => {
  it('una recién creada y vacía se BORRA de verdad', async () => {
    const id = await crearSucursal('Sucursal de prueba');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/locations/${id}`,
      headers: auth(t.adminToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.eliminada).toBe(true);
    expect(await existeSucursal(id)).toBe(false);
  });

  it('con TURNOS DE CAJA no se borra: se desactiva y se dice por qué', async () => {
    /*
      El caso que justifica todo este archivo. Esta sucursal no tiene NI UNA VENTA, así
      que el RESTRICT de `sale` no la protege; y `cash_register` cuelga en CASCADE, o sea
      que un `DELETE` a secas le habría borrado el historial de arqueos sin decir nada.
    */
    const id = await crearSucursal('Sucursal con turnos');
    await db.insert(schema.cashRegister).values({
      businessId: t.businessId,
      locationId: id,
      userId: t.adminId,
      openingAmount: '100.00',
      closedAt: new Date(),
      closingAmount: '100.00',
      expectedAmount: '100.00',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/locations/${id}`,
      headers: auth(t.adminToken),
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.eliminada).toBe(false);
    expect(d.mensaje).toContain('turno de caja');
    expect(await existeSucursal(id), 'se borró pese a tener historial').toBe(true);

    // El turno sigue ahí, que es de lo que se trataba.
    const turnos = await db
      .select()
      .from(schema.cashRegister)
      .where(eq(schema.cashRegister.locationId, id));
    expect(turnos).toHaveLength(1);
  });

  it('con STOCK tampoco: es mercadería que está en la estantería', async () => {
    const id = await crearSucursal('Sucursal con stock');
    await db.insert(schema.inventory).values({
      businessId: t.businessId,
      productId: t.productId,
      locationId: id,
      quantity: 5,
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/locations/${id}`,
      headers: auth(t.adminToken),
    });
    expect(res.json().data.eliminada).toBe(false);
    expect(res.json().data.mensaje).toContain('con stock');
  });

  it('una fila de inventario en CERO no cuenta: es contabilidad, no mercadería', async () => {
    const id = await crearSucursal('Sucursal en cero');
    await db.insert(schema.inventory).values({
      businessId: t.businessId,
      productId: t.productId,
      locationId: id,
      quantity: 0,
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/locations/${id}`,
      headers: auth(t.adminToken),
    });
    expect(res.json().data.eliminada, res.json().data.mensaje).toBe(true);
  });

  it('la sucursal PRINCIPAL no se elimina: primero hay que mover el cargo', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/locations/${t.locationId}`,
      headers: auth(t.adminToken),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('es_principal');
  });
});

describe('mover el cargo de sucursal principal', () => {
  it('NO se puede hacer principal una sucursal sin administrador', async () => {
    /*
      Salió escribiendo el test de concurrencia, y es un callejón sin salida de verdad:
      sólo un admin DE LA CENTRAL administra el negocio, así que mover el cargo a una
      sucursal sin ninguno deja al negocio sin quien cree usuarios, abra sucursales, toque
      la configuración… ni deshaga este mismo cambio. Sólo se sale llamando a soporte.
    */
    const huerfana = await crearSucursal('Sin nadie a cargo');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/locations/${huerfana}/principal`,
      headers: auth(t.adminToken),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('sin_admin_en_destino');
  });

  it('marca la nueva, desmarca la anterior y no deja dos', async () => {
    const id = await crearSucursalConAdmin('La nueva central', 'admin.nueva');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/locations/${id}/principal`,
      headers: auth(t.adminToken),
    });
    expect(res.statusCode, res.body).toBe(200);

    const centrales = await db
      .select()
      .from(schema.location)
      .where(eq(schema.location.businessId, t.businessId));
    expect(centrales.filter((l) => l.isCentral)).toHaveLength(1);
    expect(centrales.find((l) => l.isCentral)!.id).toBe(id);
  });

  it('y echa a quien le cambió el alcance', async () => {
    /*
      `isCentral` viaja DENTRO del token. Sin revocar, el admin de la vieja central
      seguiría viendo el negocio entero hasta que le caducara la sesión: quince minutos
      de alcance que ya no le corresponde. Es el mismo razonamiento por el que degradar a
      un usuario ya revoca.
    */
    clearUserCache();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: auth(t.adminToken),
    });
    expect(res.statusCode, 'el token viejo seguía valiendo').toBe(401);
  });
});

describe('eliminar un usuario', () => {
  let adminToken = '';

  beforeAll(async () => {
    // El admin original perdió su sesión al mover el cargo: se entra de nuevo.
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'secreto123', business: t.slug },
    });
    adminToken = login.json().data.accessToken;
  });

  async function crearUsuario(username: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(adminToken),
      payload: {
        name: `Usuario ${username}`,
        username,
        password: 'secreto123',
        role: 'seller',
        locationId: t.locationId,
      },
    });
    return res.json().data.id;
  }

  it('uno que nunca hizo nada se BORRA', async () => {
    const id = await crearUsuario('efimero');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${id}`,
      headers: auth(adminToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.eliminado).toBe(true);

    const [u] = await db.select().from(schema.appUser).where(eq(schema.appUser.id, id));
    expect(u).toBeUndefined();
  });

  it('uno con MOVIMIENTOS DE CAJA no: perdería quién los hizo', async () => {
    /*
      El camino "se desactiva y se dice por qué" del lado de los usuarios.

      `cash_movement.user_id` cuelga en SET NULL: el retiro sobreviviría al borrado pero
      sin autor, que es justo el dato por el que existe el registro — un retiro sin nombre
      es indistinguible de un faltante.

      Este caso lo cubría antes un abono de fiado. Al quitarse el fiado, el único test que
      probaba la desactivación de un usuario se iba con él; se repone aquí sobre una tabla
      que cuelga igual.
    */
    const id = await crearUsuario('cajero');
    const [caja] = await db
      .insert(schema.cashRegister)
      .values({
        businessId: t.businessId,
        locationId: t.locationId,
        userId: id,
        openingAmount: '100.00',
        closedAt: new Date(),
        closingAmount: '100.00',
        expectedAmount: '100.00',
      })
      .returning();
    await db.insert(schema.cashMovement).values({
      businessId: t.businessId,
      cashRegisterId: caja!.id,
      userId: id,
      type: 'out',
      amount: '50.00',
      reason: 'Pago al proveedor',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${id}`,
      headers: auth(adminToken),
    });
    expect(res.json().data.eliminado).toBe(false);
    expect(res.json().data.mensaje).toContain('movimiento de caja');

    const [u] = await db.select().from(schema.appUser).where(eq(schema.appUser.id, id));
    expect(u!.isActive).toBe(false);
  });

  it('nadie se elimina a sí mismo', async () => {
    const yo = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: auth(adminToken),
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${yo.json().data.sub}`,
      headers: auth(adminToken),
    });
    expect(res.statusCode).toBe(409);
  });

  it('borrar a alguien le cierra la sesión aunque estuviera dentro', async () => {
    const id = await crearUsuario('conectado');
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'conectado', password: 'secreto123', business: t.slug },
    });
    const suyo = login.json().data.accessToken;

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${id}`,
      headers: auth(adminToken),
    });
    clearUserCache();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: auth(suyo),
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('mover el cargo, con su propio negocio', () => {
  /**
   * Negocio aparte, y no es pereza: mover el cargo de central **revoca las sesiones** y
   * deja al admin original sin alcance sobre el negocio. Hacerlo sobre el negocio
   * compartido rompía los tres casos siguientes por un motivo que no tenía nada que ver
   * con lo que probaban. Es la tercera vez hoy que aparece la misma lección: **el test que
   * muta estado compartido se trae el suyo.**
   */
  let otro: Tenant;
  let sucursalA = '';
  let sucursalB = '';

  beforeAll(async () => {
    otro = await createTenant(app, 'cargo-central');
    for (const [nombre, usuario] of [
      ['Candidata A', 'admin.a'],
      ['Candidata B', 'admin.b'],
    ] as const) {
      const loc = await app.inject({
        method: 'POST',
        url: '/api/v1/locations',
        headers: auth(otro.adminToken),
        payload: { name: nombre },
      });
      const id = loc.json().data.id;
      await app.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: auth(otro.adminToken),
        payload: {
          name: `Admin de ${nombre}`,
          username: usuario,
          password: 'secreto123',
          role: 'admin',
          locationId: id,
        },
      });
      if (nombre === 'Candidata A') sucursalA = id;
      else sucursalB = id;
    }
  });

  it('la BASE impide una segunda central, pase lo que pase por encima', async () => {
    /*
      Esto es lo concluyente, y por eso se prueba contra la base y no por el endpoint.

      El handler desmarca y marca en la misma transacción, pero eso no basta contra dos
      peticiones a la vez: las dos leen que hay una central, las dos la desmarcan y las dos
      marcan la suya. A partir de ahí `isCentral` deja de significar nada — dos personas
      mandarían en el mismo negocio.

      Un test que llame al endpoint dos veces en paralelo pasa igual **con y sin** el
      índice, porque no siempre consigue que las dos transacciones se solapen. Insertar la
      segunda central a mano sí demuestra qué es lo que lo impide.
    */
    await expect(
      db.insert(schema.location).values({
        businessId: otro.businessId,
        name: 'Central colada por la puerta de atrás',
        isCentral: true,
      }),
    ).rejects.toThrow();
  });

  it('y dos cambios simultáneos por el endpoint dejan sólo una', async () => {
    const pedir = (id: string) =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/locations/${id}/principal`,
        headers: auth(otro.adminToken),
      });
    await Promise.allSettled([pedir(sucursalA), pedir(sucursalB)]);

    const centrales = (
      await db.select().from(schema.location).where(eq(schema.location.businessId, otro.businessId))
    ).filter((l) => l.isCentral);
    expect(centrales, 'quedaron dos centrales').toHaveLength(1);
  });
});
