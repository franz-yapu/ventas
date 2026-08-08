import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * El almacén de archivos subidos: dónde puede escribir y dónde no.
 *
 * Este módulo estaba al **0 % de cobertura**, y es justamente el que decide si un archivo
 * que sube un cliente desconocido puede acabar fuera de su carpeta. Todavía no hay ningún
 * endpoint que lo use —las imágenes están a medio conectar—, y por eso mismo conviene que
 * llegue con red puesta: el día que se enchufe, lo que falle aquí ya no será un `500`
 * sino un archivo escrito donde no debía.
 *
 * `MEDIA_DIR` se fija a un directorio temporal ANTES de importar el módulo, porque la ruta
 * raíz se resuelve al cargarlo.
 */

let almacen: typeof import('../src/lib/almacen.js');
let RAIZ = '';

/** Los primeros bytes de un WebP de verdad: "RIFF" …… "WEBP". */
function webpFalso(bytes = 64): Buffer {
  const b = Buffer.alloc(bytes);
  b.write('RIFF', 0);
  b.write('WEBP', 8);
  return b;
}

beforeAll(async () => {
  RAIZ = mkdtempSync(join(tmpdir(), 'vf-media-'));
  process.env.MEDIA_DIR = RAIZ;
  almacen = await import('../src/lib/almacen.js');
});

const NEGOCIO = '11111111-1111-4111-8111-111111111111';
const OTRO = '22222222-2222-4222-8222-222222222222';

describe('guardar un archivo', () => {
  it('lo escribe dentro de la carpeta de SU negocio', async () => {
    const { url } = await almacen.guardar(NEGOCIO, webpFalso(), 'image/webp');
    expect(url.startsWith(`/media/${NEGOCIO}/`)).toBe(true);
    expect(readdirSync(join(RAIZ, NEGOCIO))).toHaveLength(1);
  });

  it('cada subida estrena nombre, aunque sea la misma foto', async () => {
    /*
      A propósito, y no es un detalle: si el nombre fuera fijo —el id del producto, por
      ejemplo—, al reemplazar una foto el navegador y el service worker seguirían
      enseñando la anterior durante horas (tienen el catálogo precacheado) y el cliente
      pensaría que la subida no funcionó. Un nombre nuevo se ve al instante.
    */
    const a = await almacen.guardar(NEGOCIO, webpFalso(), 'image/webp');
    const b = await almacen.guardar(NEGOCIO, webpFalso(), 'image/webp');
    expect(a.url).not.toBe(b.url);
  });

  it('RECHAZA lo que dice ser una imagen y no lo es', async () => {
    /*
      El `Content-Type` lo pone quien sube, así que por sí solo no vale nada. Subir un
      `.html` diciendo que es `image/webp` y conseguir que el servidor lo sirva desde
      nuestro dominio es el camino clásico para colar un script en la sesión de otro.
      Los primeros bytes de un archivo no se falsifican tan fácil.
    */
    const html = Buffer.from('<html><script>robar()</script></html>');
    await expect(almacen.guardar(NEGOCIO, html, 'image/webp')).rejects.toThrow(/no parece/i);
  });

  it('RECHAZA un formato que no admitimos', async () => {
    await expect(almacen.guardar(NEGOCIO, webpFalso(), 'image/svg+xml')).rejects.toThrow(
      /no admitido/i,
    );
  });

  it('RECHAZA lo que pasa del tope', async () => {
    // La web ya baja a ~60 kB; esto ataja lo que no pase por ahí.
    const enorme = webpFalso(almacen.MAX_BYTES + 1);
    await expect(almacen.guardar(NEGOCIO, enorme, 'image/webp')).rejects.toThrow(/no puede pasar/i);
  });
});

describe('borrar un archivo', () => {
  it('borra el suyo', async () => {
    const { url } = await almacen.guardar(NEGOCIO, webpFalso(), 'image/webp');
    const antes = readdirSync(join(RAIZ, NEGOCIO)).length;
    await almacen.borrar(NEGOCIO, url);
    expect(readdirSync(join(RAIZ, NEGOCIO))).toHaveLength(antes - 1);
  });

  it('NO borra el de otro negocio, aunque le pasen su URL', async () => {
    const ajeno = await almacen.guardar(OTRO, webpFalso(), 'image/webp');
    await almacen.borrar(NEGOCIO, ajeno.url);
    expect(readdirSync(join(RAIZ, OTRO)).length).toBeGreaterThan(0);
  });

  it('NO se sale de la carpeta con `..`, que es el ataque clásico', async () => {
    /*
      Sin normalizar la ruta, "borra la foto de este producto" se convierte en "borra lo
      que quieras del servidor". La URL viene de la base, pero la base guarda lo que
      alguien escribió alguna vez.
    */
    const testigo = join(RAIZ, 'no-me-toques.txt');
    writeFileSync(testigo, 'aquí sigo');

    for (const malicia of [
      `/media/${NEGOCIO}/../no-me-toques.txt`,
      `/media/${NEGOCIO}/../../etc/passwd`,
      `/media/${NEGOCIO}/..%2Fno-me-toques.txt`,
    ]) {
      await almacen.borrar(NEGOCIO, malicia);
    }
    expect(readdirSync(RAIZ)).toContain('no-me-toques.txt');
  });

  it('una URL que no es nuestra se ignora sin ruido', async () => {
    // Un `null` o una URL vieja de otro almacén no tienen por qué reventar nada.
    await expect(almacen.borrar(NEGOCIO, null)).resolves.toBeUndefined();
    await expect(almacen.borrar(NEGOCIO, 'https://otro-sitio.com/x.webp')).resolves.toBeUndefined();
  });
});

describe('borrar todo lo de un negocio', () => {
  it('se lleva su carpeta entera', async () => {
    const propio = '33333333-3333-4333-8333-333333333333';
    await almacen.guardar(propio, webpFalso(), 'image/webp');
    await almacen.borrarTodoDe(propio);
    expect(readdirSync(RAIZ)).not.toContain(propio);
  });

  it('con un id que no es un uuid NO borra nada', async () => {
    // La guarda que impide que un `..` disfrazado de id de negocio se lleve la raíz.
    await almacen.borrarTodoDe('..');
    await almacen.borrarTodoDe('');
    expect(readdirSync(RAIZ).length).toBeGreaterThan(0);
  });
});
