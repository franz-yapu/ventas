import { db, schema } from '@ventafacil/db';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTenant, makeApp, resetDb, type Tenant } from './helpers.js';

/**
 * Subir la foto de un producto: lo que se escribe en el disco y quién puede escribirlo.
 *
 * `lib/almacen.ts` ya tenía red —dónde puede escribir, qué rechaza— pero **ningún endpoint
 * lo llamaba**: las imágenes estaban a medio conectar desde hacía días. Esto cubre la otra
 * mitad, que es la que recibe bytes de fuera.
 *
 * Lo que se fija:
 *
 * - **Que el archivo acabe en el disco y el producto lo apunte**, que es lo mínimo.
 * - **Que reemplazar borre el anterior.** Sin eso el disco del VPS se llena de fotos que
 *   ya no enseña nadie, y no hay ningún contador que avise: el número a mirar es el
 *   espacio libre del servidor.
 * - **Que un archivo que MIENTE sobre su tipo se rechace.** El `Content-Type` lo elige
 *   quien sube; subir un HTML diciendo que es WebP y conseguir que lo sirvamos desde
 *   nuestro dominio es el camino clásico para colar un script en la sesión de otro.
 * - **Que el alcance se respete**: ni un vendedor, ni el admin de otra sucursal, ni otro
 *   negocio.
 */

const RAIZ = process.env.MEDIA_DIR!;

let app: FastifyInstance;
let t: Tenant;
let otro: Tenant;
let vendedorToken = '';

/** Los primeros bytes de un WebP de verdad: "RIFF" …… "WEBP". */
function webp(bytes = 512): Buffer {
  const b = Buffer.alloc(bytes, 7);
  b.write('RIFF', 0);
  b.write('WEBP', 8);
  return b;
}

function subir(productId: string, datos: Buffer, tipo = 'image/webp', token = t.adminToken) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/products/${productId}/image`,
    headers: { ...auth(token), 'content-type': tipo },
    payload: datos,
  });
}

/** Cuántos archivos hay en la carpeta de un negocio. */
function archivosDe(businessId: string): string[] {
  const dir = join(RAIZ, businessId);
  return existsSync(dir) ? readdirSync(dir) : [];
}

async function imagenDe(productId: string): Promise<string | null> {
  const [p] = await db.select().from(schema.product).where(eq(schema.product.id, productId));
  return p?.imageUrl ?? null;
}

beforeAll(async () => {
  app = await makeApp();
  await resetDb();
  t = await createTenant(app, 'imagen-a');
  otro = await createTenant(app, 'imagen-b');

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
    payload: { username: 'vendedora', password: 'secreto123', business: 'imagen-a' },
  });
  vendedorToken = login.json().data.accessToken;
});

afterAll(async () => {
  await app.close();
});

describe('subir', () => {
  it('escribe el archivo y el producto lo apunta', async () => {
    const res = await subir(t.productId, webp());
    expect(res.statusCode, res.body).toBe(200);

    const url = res.json().data.imageUrl as string;
    expect(url).toMatch(new RegExp(`^/media/${t.businessId}/[0-9a-f-]{36}\\.webp$`));
    expect(await imagenDe(t.productId)).toBe(url);
    expect(existsSync(join(RAIZ, url.slice('/media/'.length)))).toBe(true);
  });

  it('y el servidor la devuelve, cacheable para siempre', async () => {
    /*
      La caché eterna es correcta PORQUE el nombre lleva un uuid y cambia al reemplazar la
      foto. Si algún día alguien pusiera un nombre fijo, esta cabecera pasaría de ser una
      optimización a hacer que una foto nueva no se viera en horas.
    */
    const url = (await imagenDe(t.productId))!;
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/webp');
    expect(res.headers['cache-control']).toContain('immutable');
    // Y sin permiso para ejecutar nada, por si algún día se cuela algo raro.
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('y el navegador la puede pintar desde OTRO origen, que es el caso real', async () => {
    /*
      Esto lo cazó abrir la pantalla, no un test — y por eso el test existe ahora.

      Helmet pone `Cross-Origin-Resource-Policy: same-origin` en todo, correcto para una
      API de datos. Pero la web y el API son orígenes distintos (dominios en producción,
      puertos en local), así que con ese valor el navegador bloqueaba cada `<img>` con
      `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`: el catálogo entero sin fotos, con las
      cabeceras «perfectas» y toda la suite en verde.

      `app.inject` no aplica políticas de navegador, así que lo único que se puede fijar
      desde aquí es el valor de la cabecera. Es poco, y es exactamente lo que faltaba.
    */
    const url = (await imagenDe(t.productId))!;
    const res = await app.inject({ method: 'GET', url });
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('pero las respuestas del API siguen cerradas a otros orígenes', async () => {
    // El contrapeso del test de arriba: lo que se abrió es `/media`, no los datos.
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: auth(t.adminToken),
    });
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
  });

  it('reemplazar BORRA la anterior: si no, el disco se llena de huérfanas', async () => {
    const antes = await imagenDe(t.productId);
    expect(archivosDe(t.businessId)).toHaveLength(1);

    const res = await subir(t.productId, webp(600));
    const despues = res.json().data.imageUrl as string;

    expect(despues).not.toBe(antes);
    expect(archivosDe(t.businessId), 'quedó la foto vieja en el disco').toHaveLength(1);
    expect(existsSync(join(RAIZ, antes!.slice('/media/'.length)))).toBe(false);
  });

  it('RECHAZA lo que dice ser una imagen y no lo es', async () => {
    // El caso que justifica comprobar los primeros bytes: un HTML servido desde nuestro
    // dominio con el tipo de una imagen.
    const html = Buffer.from('<script>alert(1)</script>' + ' '.repeat(200));
    const res = await subir(t.productId, html, 'image/webp');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('no parece una imagen');
  });

  it('RECHAZA un formato que no admitimos', async () => {
    const res = await subir(t.productId, webp(), 'image/gif');
    // Fastify no tiene analizador para ese tipo: se corta antes incluso de llegar al disco.
    expect([400, 415]).toContain(res.statusCode);
  });

  it('un cuerpo vacío no crea un archivo de cero bytes', async () => {
    const antes = archivosDe(t.businessId).length;
    const res = await subir(t.productId, Buffer.alloc(0));
    expect(res.statusCode).toBe(400);
    expect(archivosDe(t.businessId)).toHaveLength(antes);
  });

  it('lo que pasa del tope se corta', async () => {
    const enorme = webp(3 * 1024 * 1024);
    const res = await subir(t.productId, enorme);
    expect(res.statusCode).toBe(413);
  });
});

describe('quién puede', () => {
  it('un VENDEDOR no sube fotos', async () => {
    const res = await subir(t.productId, webp(), 'image/webp', vendedorToken);
    expect(res.statusCode).toBe(403);
  });

  it('el producto de OTRO negocio no existe para mí', async () => {
    const antes = archivosDe(otro.businessId).length;
    const res = await subir(otro.productId, webp());
    expect(res.statusCode).toBe(404);
    expect(archivosDe(otro.businessId), 'escribió en la carpeta de otro negocio').toHaveLength(
      antes,
    );
  });
});

describe('quitar la foto', () => {
  const quitar = (productId: string, token = t.adminToken) =>
    app.inject({
      method: 'DELETE',
      url: `/api/v1/products/${productId}/image`,
      headers: auth(token),
    });

  it('borra el archivo y deja el producto sin foto', async () => {
    await subir(t.productId, webp());
    const url = (await imagenDe(t.productId))!;

    const res = await quitar(t.productId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.imageUrl).toBeNull();
    expect(await imagenDe(t.productId)).toBeNull();
    expect(existsSync(join(RAIZ, url.slice('/media/'.length)))).toBe(false);
  });

  it('quitarla dos veces no es un error: el resultado es el mismo', async () => {
    expect((await quitar(t.productId)).statusCode).toBe(200);
  });

  it('un VENDEDOR tampoco la quita', async () => {
    expect((await quitar(t.productId, vendedorToken)).statusCode).toBe(403);
  });
});

describe('la ruta pública no es una puerta al disco', () => {
  it.each([
    ['/media/../../../etc/passwd'],
    ['/media/..%2f..%2fetc%2fpasswd'],
    [`/media/${t?.businessId ?? 'x'}/../../etc/passwd`],
  ])('%s no sirve nada de fuera', async (url) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.body).not.toContain('root:');
  });

  it('la carpeta de un negocio no se puede listar', async () => {
    const res = await app.inject({ method: 'GET', url: `/media/${t.businessId}/` });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});

/**
 * Las fotos no pueden gastar el cupo con el que se cobra.
 *
 * El tope global por IP se dimensionó cuando este servicio «sólo respondía JSON, nunca
 * HTML»: 600 peticiones por minuto son muchísimas para un puñado de cajas llamando al API.
 * Dejaron de serlo el día que empezó a servir imágenes, porque una tienda entera sale por
 * UNA IP y una rejilla de POS pide una foto por producto.
 *
 * El desenlace es el peor posible: el cupo se gasta mirando fotos y el `POST /sales`
 * siguiente vuelve con un 429 — el cajero no puede cobrarle al cliente que tiene delante,
 * y como los 429 de las fotos se ven como imágenes rotas, nada en pantalla lo explica.
 */
describe('el cupo de las fotos va aparte del cupo del API', () => {
  /** Lo que le queda al cubo del API, leído de la cabecera de una petición cualquiera. */
  const restanteDelApi = async (): Promise<number> => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    return Number(res.headers['x-ratelimit-remaining']);
  };

  it('pedir imágenes no le quita cupo al cobro', async () => {
    const antes = await restanteDelApi();

    // Veinte miniaturas, lo que carga una sola pantalla del POS.
    for (let i = 0; i < 20; i++) {
      await app.inject({ method: 'GET', url: `/media/no-existe-${i}.webp` });
    }

    const despues = await restanteDelApi();
    /*
      Entre las dos lecturas sólo han pasado las dos peticiones a `/health`, así que el
      cubo del API tiene que haber bajado exactamente 1 (la primera lectura ya se contó a
      sí misma). Si las fotos compartieran cubo, habrían bajado 21.
    */
    expect(antes - despues, 'las imágenes están gastando el cupo del API').toBe(1);
  });

  it('las fotos siguen teniendo SU tope, no barra libre', async () => {
    // Quitarles el límite del todo dejaría una puerta sin contador en el único sitio que
    // sirve archivos. Lo que se quiere es un cubo aparte, no ninguno.
    //
    // Se mide sobre una foto que EXISTE: un 404 lo resuelve el manejador global, que vive
    // fuera de este ámbito y no pasa por su tope.
    const url = (await subir(t.productId, webp())).json().data.imageUrl as string;
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['x-ratelimit-limit'], '/media quedó sin ningún tope').toBeDefined();
    // Y su cubo es el suyo: diez veces el del API, no el mismo número.
    expect(Number(res.headers['x-ratelimit-limit'])).toBeGreaterThan(600);
  });
});
