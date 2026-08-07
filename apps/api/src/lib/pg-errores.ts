/**
 * Reconocer los errores de PostgreSQL sin leerles el texto.
 *
 * Antes cada módulo hacía `String(e).includes('nombre_de_la_restriccion')` en su propio
 * `catch`. Funcionaba por casualidad: dependía de que el mensaje del driver llevara
 * dentro el nombre del índice. Al subir drizzle-orm de 0.36 a 0.45 dejó de llevarlo —los
 * errores pasaron a venir envueltos en `DrizzleQueryError`, cuyo texto es sólo el SQL y
 * los parámetros— y **los seis sitios se rompieron a la vez**: el alta duplicada de un
 * producto, de un usuario, de un negocio, el cambio de subdominio y la segunda caja
 * abierta dejaron de responder 409 y pasaron a responder 500.
 *
 * De los seis, sólo uno tenía test. Los otros cinco se habrían descubierto en producción,
 * con un cliente delante viendo "error del servidor" donde antes leía "ya existe un
 * producto con ese código".
 *
 * Por eso esto vive en un solo sitio y mira el CÓDIGO de PostgreSQL (`23505`) y el nombre
 * de la restricción, que son contrato de la base, no del cliente que la consulta.
 */

/** Violación de restricción única. Es contrato de PostgreSQL, no de drizzle. */
const UNIQUE_VIOLATION = '23505';
/** Texto que no se puede convertir al tipo de la columna. Típicamente un uuid mal escrito. */
const INVALID_TEXT_REPRESENTATION = '22P02';

/**
 * Recorre la cadena de causas.
 *
 * drizzle envuelve el error del driver, y el driver podría envolver otro. Buscar sólo en
 * el primer nivel es lo que dejó de funcionar al subir de versión; recorrer la cadena
 * entera sobrevive a la próxima.
 */
function* causas(e: unknown): Generator<Record<string, unknown>> {
  let actual: unknown = e;
  // Un tope por si alguna vez llega una cadena circular.
  for (let i = 0; i < 10 && actual && typeof actual === 'object'; i++) {
    yield actual as Record<string, unknown>;
    actual = (actual as { cause?: unknown }).cause;
  }
}

/**
 * ¿Este error es la violación de ESTA restricción única?
 *
 * @param nombre nombre del índice o constraint, tal como está en la migración.
 */
export function violaUnica(e: unknown, nombre: string): boolean {
  for (const c of causas(e)) {
    if (c.code !== UNIQUE_VIOLATION) continue;
    // `constraint_name` es lo que trae `postgres`; `constraint`, lo que traen otros
    // drivers. Se miran los dos para no volver a atarse a uno.
    const restriccion = c.constraint_name ?? c.constraint;
    if (typeof restriccion === 'string' && restriccion.includes(nombre)) return true;
  }
  return false;
}

/**
 * ¿El error es "eso no es un identificador válido"?
 *
 * Un `:id` que no es un uuid llega hasta la base y allí revienta con 22P02. Sin esto la
 * app respondía **500** a `/sales/abc`, `/customers/123` o cualquier enlace viejo mal
 * copiado. Y no era sólo el código equivocado: cada 500 se escribe en el log como "error
 * no controlado" y dispara un aviso por correo, así que un rastreador probando URLs
 * llenaba el buzón de operación con avisos de algo que no está roto.
 *
 * Es un 400: el problema está en lo que pidió el cliente, y no hay nada que reintentar.
 */
export function esIdInvalido(e: unknown): boolean {
  for (const c of causas(e)) {
    if (c.code === INVALID_TEXT_REPRESENTATION) return true;
  }
  return false;
}
