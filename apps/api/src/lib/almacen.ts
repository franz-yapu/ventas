import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { env } from '../env.js';

/**
 * Dónde viven los archivos que suben los clientes.
 *
 * Hoy: el disco del VPS, en un volumen. No hay proceso nuevo, no hay RAM extra —el
 * servidor tiene 1 vCPU para todo el stack— y el respaldo entra en el mismo `tar` que ya
 * se hace. Con ~60 kB por imagen (ver `lib/imagen.ts` en la web), 5.000 productos son
 * 300 MB: cabe sin drama.
 *
 * El código de negocio NO sabe nada de esto: llama a `guardar` y `borrar` y recibe una
 * URL. El día que el disco se quede corto, o que haya dos servidores y un archivo escrito
 * en uno no exista en el otro, se añade un motor S3 aquí y el resto no se entera. Esa es
 * toda la razón de que esto sea un módulo y no cuatro líneas dentro del handler.
 *
 * ## Lo que hay que vigilar
 *
 * El disco. No hay cupo propio de imágenes por plan —lo acota el límite de productos—,
 * así que el número a mirar es el espacio libre del VPS, no un contador nuestro.
 */

/** Raíz de los archivos subidos. En Docker, un volumen; en local, una carpeta. */
const RAIZ = resolve(env.mediaDir);

/** Lo que se acepta. WebP porque es lo que produce el navegador tras redimensionar. */
const TIPOS: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** Tope del lado del servidor. La web ya baja a ~60 kB; esto ataja lo que no pase por ahí. */
export const MAX_BYTES = 2 * 1024 * 1024;

export class ErrorDeArchivo extends Error {}

/**
 * Nombre del archivo dentro del negocio.
 *
 * Lleva un uuid y no el id del producto **a propósito**: si se reemplaza la foto de un
 * producto, el nombre cambia. Con un nombre fijo, el navegador y el service worker
 * seguirían enseñando la anterior durante horas —tienen el catálogo precacheado— y el
 * cliente pensaría que la subida no funcionó. Un nombre nuevo se ve al instante.
 */
function nombreNuevo(ext: string): string {
  return `${randomUUID()}.${ext}`;
}

/**
 * Guarda un archivo y devuelve la ruta pública.
 *
 * Se agrupa por negocio para que borrar un negocio sea borrar una carpeta, y para que
 * mirar el disco diga a simple vista quién ocupa qué.
 */
export async function guardar(
  businessId: string,
  datos: Buffer,
  tipo: string,
): Promise<{ url: string; bytes: number }> {
  const ext = TIPOS[tipo];
  if (!ext) throw new ErrorDeArchivo('Formato no admitido. Usa WebP, JPG o PNG.');
  if (datos.byteLength > MAX_BYTES) {
    throw new ErrorDeArchivo(`El archivo no puede pasar de ${MAX_BYTES / 1024 / 1024} MB.`);
  }
  /*
    Se comprueba que el contenido SEA lo que dice el tipo.

    El `Content-Type` lo pone quien sube, así que por sí solo no vale nada: subir un `.html`
    diciendo que es `image/webp` y conseguir que el servidor lo sirva desde nuestro dominio
    es el camino clásico para colar un script en la sesión de otro. Los primeros bytes de un
    archivo no se pueden falsificar tan fácil.
  */
  if (!pareceImagen(datos, ext)) {
    throw new ErrorDeArchivo('El archivo no parece una imagen.');
  }

  const nombre = nombreNuevo(ext);
  const relativa = join(businessId, nombre);
  const destino = join(RAIZ, relativa);
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, datos);

  return { url: `/media/${businessId}/${nombre}`, bytes: datos.byteLength };
}

/**
 * Borra un archivo por su URL pública, si es nuestro y del negocio que dice.
 *
 * Se comprueba el negocio y se normaliza la ruta: sin eso, un `../` en la URL guardada
 * convertiría "borra la foto de este producto" en "borra lo que quieras del servidor".
 */
export async function borrar(businessId: string, url: string | null | undefined): Promise<void> {
  if (!url?.startsWith(`/media/${businessId}/`)) return;
  const relativa = normalize(url.slice('/media/'.length));
  if (relativa.startsWith('..') || relativa.split(sep)[0] !== businessId) return;
  await rm(join(RAIZ, relativa), { force: true });
}

/** Carpeta de un negocio: se borra entera cuando se borra el negocio. */
export async function borrarTodoDe(businessId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) return;
  await rm(join(RAIZ, businessId), { recursive: true, force: true });
}

/**
 * ¿Los primeros bytes corresponden al formato declarado?
 *
 * No es una validación completa —para eso haría falta decodificar— pero descarta lo que
 * importa: cualquier cosa que no empiece como una imagen.
 */
function pareceImagen(b: Buffer, ext: string): boolean {
  if (b.byteLength < 12) return false;
  if (ext === 'png') return b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (ext === 'jpg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  // WebP: "RIFF" .... "WEBP"
  return b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';
}

/** Hash del contenido, por si algún día conviene no guardar dos veces la misma foto. */
export function huella(datos: Buffer): string {
  return createHash('sha256').update(datos).digest('hex').slice(0, 16);
}

export { RAIZ as RAIZ_MEDIA };
