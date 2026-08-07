/**
 * Leer el inventario de un cliente y convertirlo en productos.
 *
 * Esto es la barrera de entrada del producto: un negocio con 5.000 referencias no se
 * pone a teclearlas, así que si la importación no funciona el cliente no empieza. Y el
 * primer día es cuando se decide si se queda.
 *
 * **Lo difícil no es leer el archivo.** Leer un `.xlsx` son tres líneas. Lo difícil es que
 * el archivo de un cliente real nunca tiene las columnas que uno espera: se llaman
 * "DESCRIPCION", "Cant.", "P. VENTA", vienen en otro orden, hay filas de subtotal en medio
 * y celdas vacías. Un importador que exige `sku,name,price` funciona con el archivo de
 * ejemplo y con ninguno más.
 *
 * De ahí las tres piezas de este módulo:
 *   1. `proponerMapeo` — adivina qué columna es cuál, para que la persona corrija en vez
 *      de configurar desde cero.
 *   2. `interpretar` — convierte y valida fila por fila, **sin escribir nada**.
 *   3. `aCsv` — devuelve las rechazadas para corregirlas y reintentar sólo ésas.
 */

/** Los campos que sabemos importar. `null` = esa columna se ignora. */
export type Campo =
  'sku' | 'name' | 'description' | 'barcode' | 'price' | 'cost' | 'initialStock' | 'minStock';

export const CAMPOS: Array<{ campo: Campo; etiqueta: string; obligatorio: boolean }> = [
  { campo: 'name', etiqueta: 'Nombre del producto', obligatorio: true },
  { campo: 'price', etiqueta: 'Precio de venta', obligatorio: true },
  { campo: 'sku', etiqueta: 'Código / SKU', obligatorio: false },
  { campo: 'barcode', etiqueta: 'Código de barras', obligatorio: false },
  { campo: 'description', etiqueta: 'Descripción', obligatorio: false },
  { campo: 'cost', etiqueta: 'Precio de compra', obligatorio: false },
  { campo: 'initialStock', etiqueta: 'Cantidad en stock', obligatorio: false },
  { campo: 'minStock', etiqueta: 'Stock mínimo', obligatorio: false },
];

/**
 * Cómo se llaman de verdad estas columnas en los archivos de la gente.
 *
 * Salido de mirar planillas reales, no de imaginar. Nadie escribe "initialStock": escribe
 * "CANT", "Cantidad", "Stock" o "Existencia". Cada acierto aquí es un desplegable que la
 * persona no tiene que tocar, y la diferencia entre "esto se configura solo" y "esto es un
 * formulario de ocho campos antes de empezar".
 */
const SINONIMOS: Record<Campo, string[]> = {
  name: ['nombre', 'producto', 'descripcion', 'detalle', 'articulo', 'item', 'name', 'product'],
  price: [
    'precio',
    'precio venta',
    'p venta',
    'pventa',
    'venta',
    'price',
    'pvp',
    'precio unitario',
  ],
  sku: ['sku', 'codigo', 'cod', 'clave', 'referencia', 'ref', 'code'],
  barcode: ['codigo de barras', 'barras', 'barcode', 'ean', 'upc'],
  description: ['descripcion larga', 'detalle', 'observacion', 'nota', 'description'],
  cost: ['costo', 'precio compra', 'p compra', 'pcompra', 'compra', 'cost'],
  initialStock: ['cantidad', 'cant', 'stock', 'existencia', 'existencias', 'saldo', 'qty'],
  minStock: ['minimo', 'stock minimo', 'min', 'reorden'],
};

/** Sin tildes, sin puntuación y en minúsculas: "P. VENTA" y "p venta" son lo mismo. */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type Mapeo = Record<string, Campo | null>;

/**
 * Propone qué columna del archivo corresponde a cada campo.
 *
 * Primero busca coincidencia exacta y después que la cabecera contenga el sinónimo, en el
 * orden en que están escritos. El orden importa: para `name`, "descripcion" va después de
 * "nombre" y "producto", porque una planilla con las dos columnas casi siempre usa
 * "descripcion" como el nombre largo y "nombre" como el corto.
 *
 * Un campo sólo se propone UNA vez: si dos cabeceras encajan con `price`, la segunda queda
 * sin asignar. Proponer la misma cosa dos veces obliga a deshacer, que es peor que no
 * proponer.
 */
export function proponerMapeo(cabeceras: string[]): Mapeo {
  const mapeo: Mapeo = {};
  const usados = new Set<Campo>();
  const normales = cabeceras.map(normalizar);

  for (const paso of ['exacto', 'contiene'] as const) {
    for (const { campo } of CAMPOS) {
      if (usados.has(campo)) continue;
      for (const sinonimo of SINONIMOS[campo]) {
        const i = normales.findIndex((h, idx) => {
          if (mapeo[cabeceras[idx]!]) return false;
          return paso === 'exacto' ? h === sinonimo : h.includes(sinonimo);
        });
        if (i >= 0) {
          mapeo[cabeceras[i]!] = campo;
          usados.add(campo);
          break;
        }
      }
    }
  }

  for (const h of cabeceras) if (!(h in mapeo)) mapeo[h] = null;
  return mapeo;
}

export interface FilaInterpretada {
  /** Número de línea EN EL ARCHIVO (con la cabecera contada), para poder ir a buscarla. */
  fila: number;
  valores: Record<string, unknown>;
  /** Vacío = la fila entra. */
  errores: string[];
  original: Record<string, unknown>;
}

/** Convierte "1.234,50", "Bs 1234.5" o 1234.5 a "1234.50". `null` si no es un número. */
export function aMoneda(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(2) : null;
  let t = String(v).replace(/[^\d.,-]/g, '');
  if (!t) return null;
  // Formato boliviano/europeo: el punto separa miles y la coma decimales.
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else if (t.includes(',')) t = t.replace(',', '.');
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return n.toFixed(2);
}

function aEntero(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Math.trunc(Number(String(v).replace(/[^\d.-]/g, '')));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Interpreta las filas y dice cuáles NO entrarían, sin escribir nada.
 *
 * La vista previa existe porque nadie confía en un botón que se traga 5.000 filas a
 * ciegas — y con razón: si el precio se leyó mal, el error se descubre cobrando.
 *
 * Los SKU repetidos DENTRO del archivo se detectan aquí, y no en el servidor, porque el
 * servidor los ve de uno en uno: el primero entraría y el segundo daría un error que
 * parece del sistema cuando en realidad el archivo trae el código dos veces.
 */
export function interpretar(
  filas: Array<Record<string, unknown>>,
  mapeo: Mapeo,
  opciones: { primeraFila?: number } = {},
): FilaInterpretada[] {
  const base = opciones.primeraFila ?? 2; // 1 es la cabecera
  const columnaDe = (campo: Campo) =>
    Object.keys(mapeo).find((col) => mapeo[col] === campo) ?? null;

  const colNombre = columnaDe('name');
  const colPrecio = columnaDe('price');
  const colSku = columnaDe('sku');

  const skusVistos = new Map<string, number>();

  return filas.map((original, i) => {
    const fila = base + i;
    const errores: string[] = [];
    const valores: Record<string, unknown> = {};

    const nombre = colNombre ? String(original[colNombre] ?? '').trim() : '';
    if (!nombre) errores.push('Sin nombre');
    else valores.name = nombre;

    const precio = colPrecio ? aMoneda(original[colPrecio]) : null;
    if (precio === null) {
      errores.push(
        colPrecio ? `Precio no válido: "${original[colPrecio] ?? ''}"` : 'Sin columna de precio',
      );
    } else {
      valores.price = precio;
    }

    if (colSku) {
      const sku = String(original[colSku] ?? '').trim();
      if (sku) {
        valores.sku = sku;
        const antes = skusVistos.get(sku.toLowerCase());
        if (antes) errores.push(`El código "${sku}" ya está en la fila ${antes} del archivo`);
        else skusVistos.set(sku.toLowerCase(), fila);
      }
    }

    for (const campo of ['barcode', 'description'] as const) {
      const col = columnaDe(campo);
      const v = col ? String(original[col] ?? '').trim() : '';
      if (v) valores[campo] = v;
    }

    const colCosto = columnaDe('cost');
    if (colCosto && original[colCosto] !== '' && original[colCosto] != null) {
      const costo = aMoneda(original[colCosto]);
      if (costo === null) errores.push(`Costo no válido: "${original[colCosto]}"`);
      else valores.cost = costo;
    }

    for (const campo of ['initialStock', 'minStock'] as const) {
      const col = columnaDe(campo);
      if (!col || original[col] === '' || original[col] == null) continue;
      const n = aEntero(original[col]);
      if (n === null) errores.push(`Cantidad no válida: "${original[col]}"`);
      else valores[campo] = n;
    }

    return { fila, valores, errores, original };
  });
}

/** ¿Falta algún campo obligatorio por mapear? Se comprueba antes de dejar continuar. */
export function faltanObligatorios(mapeo: Mapeo): string[] {
  const asignados = new Set(Object.values(mapeo).filter(Boolean));
  return CAMPOS.filter((c) => c.obligatorio && !asignados.has(c.campo)).map((c) => c.etiqueta);
}

/**
 * Las filas rechazadas, en CSV, para corregirlas y reintentar SÓLO ésas.
 *
 * Con 5.000 filas, "87 no entraron" sin decir cuáles obliga a volver a subir el archivo
 * entero y a que los 4.913 que sí entraron choquen por código repetido. Devolver las
 * rechazadas convierte un callejón sin salida en un segundo intento de 87 filas.
 */
export function aCsv(filas: FilaInterpretada[], cabeceras: string[]): string {
  const escapar = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cabecera = ['fila_original', 'motivo', ...cabeceras].map(escapar).join(',');
  const cuerpo = filas.map((f) =>
    [f.fila, f.errores.join(' · '), ...cabeceras.map((h) => f.original[h])].map(escapar).join(','),
  );
  return [cabecera, ...cuerpo].join('\n');
}
