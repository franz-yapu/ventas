/**
 * Un único sitio que decide si el costo sale por el cable.
 *
 * Vivía dentro de `products.ts` y sólo se aplicaba a la lista de productos, así que el
 * costo seguía saliendo por otras tres puertas: el detalle de una venta, el historial de
 * un producto y la exportación del negocio. Cerrar una y dejar tres abiertas no protege
 * nada, y la razón de que pasara es que el criterio estaba escrito en un módulo en vez de
 * estar a mano de todos los que lo necesitan.
 *
 * La regla es una sola: el VENDEDOR no ve lo que costó la mercadería. Vende al precio que
 * le marcan; el margen es del dueño.
 */

/**
 * Las columnas que revelan el margen, con los nombres que tienen en cada tabla.
 * `unitCostSnapshot` es el costo congelado en la línea de una venta: el mismo dato,
 * guardado en otro sitio.
 */
const CLAVES_DE_COSTO = ['cost', 'costWholesale', 'unitCostSnapshot'] as const;

type Rol = { role: 'admin' | 'seller' };

/**
 * Quita el costo de una fila cuando quien pregunta es un vendedor.
 *
 * La pantalla de Productos ya escondía esas columnas, pero el servidor las mandaba igual:
 * bastaba abrir las herramientas del navegador para leer el margen de cada producto.
 * Esconder en el dibujo no es proteger — quien decide qué sale por el cable es el
 * servidor.
 *
 * Se borran las claves en vez de mandarlas en `null` para que la diferencia se note si
 * alguna vez alguien vuelve a exponerlas por descuido.
 */
export function sinCostos<T extends object>(fila: T, user: Rol): T {
  if (user.role === 'admin') return fila;
  const resto = { ...fila } as Record<string, unknown>;
  for (const clave of CLAVES_DE_COSTO) delete resto[clave];
  return resto as T;
}

/** Lo mismo sobre una lista. */
export function sinCostosLista<T extends object>(filas: T[], user: Rol): T[] {
  if (user.role === 'admin') return filas;
  return filas.map((f) => sinCostos(f, user));
}

/**
 * Lo mismo sobre el `before`/`after` de una fila de auditoría.
 *
 * Ahí el costo viaja de contrabando: al dar de alta un producto se guarda la fila entera
 * como `after`, y al editarlo se guardan las dos versiones completas. Es un `jsonb`, así
 * que puede ser cualquier cosa —incluida `null`— y hay que comprobarlo antes de tocarlo.
 */
export function sinCostosEnJson(valor: unknown, user: Rol): unknown {
  if (user.role === 'admin') return valor;
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) return valor;
  return sinCostos(valor as Record<string, unknown>, user);
}
