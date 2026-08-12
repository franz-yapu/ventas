/**
 * Un UUID v4, también donde `crypto.randomUUID` no existe.
 *
 * ## Por qué no se usa `crypto.randomUUID` directamente
 *
 * Esa API sólo está disponible en **contextos seguros**: HTTPS o `localhost`. Servida por
 * `http://` a una IP o a un nombre de la red local —que es como corre un POS en la LAN de
 * una tienda, y como corre la instancia de prueba— `crypto.randomUUID` es `undefined` y
 * llamarla lanza.
 *
 * Eso bloqueó la caja entera: `checkout()` empieza generando el id de la venta, así que
 * reventaba antes de guardar nada. Y como en producción hay HTTPS, no se veía ahí: es el
 * tipo de fallo que sólo aparece donde el sistema se usa de verdad.
 *
 * `crypto.getRandomValues`, en cambio, existe también en contextos no seguros, y es lo que
 * de verdad importa aquí: el id es la clave de idempotencia de la venta —lo que impide que
 * un reintento la duplique—, así que tiene que ser único de verdad, no «suficientemente
 * distinto».
 *
 * El último recurso con `Math.random()` es para un navegador sin `crypto` en absoluto. No
 * sirve para nada criptográfico, pero para una clave de idempotencia local es preferible a
 * no poder cobrar.
 */
export function uuid(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // Los dos campos que hacen que sea un v4 y no una cadena de bytes cualquiera.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // versión 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variante RFC 4122

  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}
