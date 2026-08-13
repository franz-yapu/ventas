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

/**
 * Convierte "1.234,50", "Bs 1234.5" o 1234.5 a "1234.50". `null` si no es un número.
 *
 * El caso difícil es un separador SOLO: `"1.234"` puede ser mil doscientos treinta y
 * cuatro (punto de miles) o uno con doscientos treinta y cuatro (punto decimal), y el
 * texto no lo dice. Antes se resolvía dejándoselo a `Number`, que lo leía como 1,23 — un
 * precio de Bs 1.234 entraba como Bs 1,23 y se vendía así hasta que alguien lo notara.
 *
 * La regla que desempata es contar los dígitos que siguen al separador:
 *
 * - **exactamente 3** → es de MILES. Nadie escribe tres decimales en un precio, y "1.234"
 *   en una planilla boliviana es mil doscientos treinta y cuatro.
 * - **1 o 2** → es decimal: "45.9", "45,90".
 * - **más de 3, o varios separadores** → miles: "1.234.567".
 *
 * No es infalible —un precio de Bs 1,234 existe en teoría— pero acierta en lo que la gente
 * escribe de verdad, y el caso que falla es el raro en vez del común.
 */
export function aMoneda(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(2) : null;

  let t = String(v).replace(/[^\d.,-]/g, '');
  if (!t) return null;

  const puntos = (t.match(/\./g) ?? []).length;
  const comas = (t.match(/,/g) ?? []).length;

  if (puntos && comas) {
    // Con los dos, el ÚLTIMO que aparece es el decimal: "1.234,50" y "1,234.50".
    const decimal = t.lastIndexOf(',') > t.lastIndexOf('.') ? ',' : '.';
    const miles = decimal === ',' ? '.' : ',';
    t = t.split(miles).join('').replace(decimal, '.');
  } else if (puntos + comas === 1) {
    const sep = puntos ? '.' : ',';
    const detras = t.length - t.indexOf(sep) - 1;
    // Tres dígitos detrás = separador de miles. Uno o dos = decimales.
    t = detras === 3 ? t.replace(sep, '') : t.replace(sep, '.');
  } else if (puntos + comas > 1) {
    // Varios separadores iguales sólo pueden ser miles: "1.234.567".
    t = t.replace(/[.,]/g, '');
  }

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
      if (sku) valores.sku = sku;
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

// ── Repetidos ────────────────────────────────────────────────────────────────
/*
  Un producto puede estar repetido de dos maneras, y las dos se deciden, no se rechazan.

  Antes el código repetido DENTRO del archivo era un error de validación —la segunda fila
  se descartaba sin más— y el que ya existía en el catálogo ni se miraba: se subía, el
  servidor lo rechazaba por la restricción única y aparecía en el informe final, cuando ya
  no se podía hacer nada. Las dos cosas dejan a la persona sin la decisión que sólo ella
  puede tomar: cuál de las dos filas vale, y si pisar o no lo que ya tenía guardado.
*/

/** Un producto del catálogo, tal como lo devuelve `POST /products/lookup`. */
export interface ProductoExistente {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  description: string | null;
  price: string;
  cost: string | null;
  stock: number | null;
  minStock: number | null;
}

export interface Cambio {
  campo: string;
  etiqueta: string;
  de: string;
  a: string;
}

export interface Repetido {
  /** Clave estable del grupo. La usa la pantalla para recordar la decisión. */
  clave: string;
  /** `archivo` = viene dos veces en el Excel. `catalogo` = ya está guardado. */
  motivo: 'archivo' | 'catalogo';
  /** Qué coincidió. */
  por: 'sku' | 'nombre';
  /** Filas del archivo implicadas. Con `catalogo` es una; con `archivo`, dos o más. */
  filas: FilaInterpretada[];
  /** El producto guardado. Sólo en `catalogo`. */
  existente?: ProductoExistente;
  /** Qué cambiaría al actualizar. Vacío = los datos ya son iguales. */
  cambios: Cambio[];
}

/** Sin tildes no: «Café» y «Cafe» son distintos, igual que en el servidor. */
function claveNombre(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Con qué se identifica una fila para buscarle pareja.
 *
 * El código manda cuando lo hay: es el que tiene restricción única en la base, o sea el
 * que provoca el rechazo seguro. Sin código se usa el nombre, que es lo único que queda
 * para pillar al cliente que sube dos veces la misma planilla.
 */
export function claveDe(f: FilaInterpretada): { clave: string; por: 'sku' | 'nombre' } | null {
  const sku = typeof f.valores.sku === 'string' ? f.valores.sku.trim() : '';
  if (sku) return { clave: `sku:${sku.toLowerCase()}`, por: 'sku' };
  const nombre = typeof f.valores.name === 'string' ? f.valores.name : '';
  return nombre ? { clave: `nombre:${claveNombre(nombre)}`, por: 'nombre' } : null;
}

const ETIQUETA_CAMBIO: Record<string, string> = {
  name: 'Nombre',
  price: 'Precio',
  cost: 'Costo',
  barcode: 'Código de barras',
  description: 'Descripción',
  initialStock: 'Existencias',
  minStock: 'Stock mínimo',
};

/**
 * Qué cambiaría si esta fila pisara al producto guardado.
 *
 * Sólo se comparan los campos que el archivo TRAE: los que no vienen no se van a tocar,
 * así que listarlos como «cambio» sería mentir. Y si no cambia nada se devuelve vacío,
 * que es lo que permite a la pantalla decir «sin cambios» y ahorrarle a la persona una
 * decisión que no lo es.
 */
export function diferencias(
  valores: Record<string, unknown>,
  existente: ProductoExistente,
): Cambio[] {
  const actual: Record<string, unknown> = {
    name: existente.name,
    price: existente.price,
    cost: existente.cost,
    barcode: existente.barcode,
    description: existente.description,
    initialStock: existente.stock,
    minStock: existente.minStock,
  };
  const cambios: Cambio[] = [];
  for (const [campo, etiqueta] of Object.entries(ETIQUETA_CAMBIO)) {
    if (!(campo in valores)) continue;
    const a = valores[campo];
    const de = actual[campo];
    // Comparado como texto: el precio viaja como "18.00" y el stock como número.
    if (String(de ?? '') === String(a ?? '')) continue;
    cambios.push({ campo, etiqueta, de: String(de ?? '—'), a: String(a ?? '—') });
  }
  return cambios;
}

export interface Clasificacion {
  /** Filas limpias y sin pareja: entran sin preguntar nada. */
  entran: FilaInterpretada[];
  /** Grupos que necesitan una decisión. */
  repetidos: Repetido[];
  /** Filas que no entran por venir mal. */
  noEntran: FilaInterpretada[];
}

/**
 * Reparte las filas en las tres cosas que la pantalla enseña.
 *
 * El orden importa: primero se agrupan los repetidos DEL ARCHIVO y sólo el representante
 * del grupo se busca en el catálogo. Al revés, una fila que viene tres veces y además ya
 * existe saldría cuatro veces en la pantalla pidiendo cuatro decisiones que en realidad
 * son una.
 */
export function clasificar(
  interpretadas: FilaInterpretada[],
  existentes: ProductoExistente[] = [],
): Clasificacion {
  const noEntran = interpretadas.filter((f) => f.errores.length > 0);
  const buenas = interpretadas.filter((f) => f.errores.length === 0);

  const porSku = new Map<string, ProductoExistente>();
  const porNombre = new Map<string, ProductoExistente>();
  for (const p of existentes) {
    porSku.set(p.sku.trim().toLowerCase(), p);
    // El primero gana: dos productos guardados con el mismo nombre son cosa del catálogo,
    // no del archivo, y elegir uno cualquiera es mejor que no ofrecer actualizar ninguno.
    if (!porNombre.has(claveNombre(p.name))) porNombre.set(claveNombre(p.name), p);
  }

  // Agrupar por clave, conservando el orden en que aparecen en el archivo.
  const grupos = new Map<string, { por: 'sku' | 'nombre'; filas: FilaInterpretada[] }>();
  const sinClave: FilaInterpretada[] = [];
  for (const f of buenas) {
    const k = claveDe(f);
    if (!k) {
      sinClave.push(f);
      continue;
    }
    const g = grupos.get(k.clave);
    if (g) g.filas.push(f);
    else grupos.set(k.clave, { por: k.por, filas: [f] });
  }

  const entran: FilaInterpretada[] = [...sinClave];
  const repetidos: Repetido[] = [];

  for (const [clave, g] of grupos) {
    const valor = clave.slice(clave.indexOf(':') + 1);
    const existente = g.por === 'sku' ? porSku.get(valor) : porNombre.get(valor);

    if (g.filas.length > 1) {
      // Repetido dentro del archivo. La decisión es cuál de las filas vale; si además ya
      // existe, la pantalla ofrece después actualizar con la elegida.
      repetidos.push({
        clave,
        motivo: 'archivo',
        por: g.por,
        filas: g.filas,
        existente,
        cambios: existente ? diferencias(g.filas[0]!.valores, existente) : [],
      });
      continue;
    }
    if (existente) {
      repetidos.push({
        clave,
        motivo: 'catalogo',
        por: g.por,
        filas: g.filas,
        existente,
        cambios: diferencias(g.filas[0]!.valores, existente),
      });
      continue;
    }
    entran.push(g.filas[0]!);
  }

  // Devueltas en el orden del archivo: quien revisa mira su hoja de cálculo, no la
  // nuestra, y una lista desordenada obliga a buscar cada fila a mano.
  entran.sort((a, b) => a.fila - b.fila);
  repetidos.sort((a, b) => a.filas[0]!.fila - b.filas[0]!.fila);
  return { entran, repetidos, noEntran };
}

/** Qué se decidió para un grupo de repetidos. */
export type Decision =
  | { tipo: 'omitir' }
  /** Pisar el producto guardado con los datos del archivo. */
  | { tipo: 'actualizar' }
  /** Cuál de las filas repetidas del archivo es la que vale. */
  | { tipo: 'fila'; fila: number };

/**
 * Qué se hace con cada grupo si nadie toca nada.
 *
 * **Omitir** cuando el producto ya está en el catálogo: pisar precios y costos es
 * irreversible, y un valor por defecto que sobrescribe datos convierte un descuido en una
 * pérdida. Un botón «Actualizar todos» lo resuelve en un clic para quien viene a eso.
 *
 * Cuando el repetido es sólo del ARCHIVO —viene dos veces y no existe todavía— el defecto
 * es la PRIMERA fila, no omitir. Omitir ahí no sería prudente sino inútil: la persona
 * quiere ese producto, lo único dudoso es cuál de las dos filas vale.
 */
export function decisionPorDefecto(r: Repetido): Decision {
  return r.existente ? { tipo: 'omitir' } : { tipo: 'fila', fila: r.filas[0]!.fila };
}

/**
 * Las filas que se le mandan al servidor, ya con su modo.
 *
 * Función aparte del componente porque es donde una equivocación no se ve y sí se paga:
 * mandar como «crear» algo que había que actualizar choca contra la restricción única, y
 * mandar como «actualizar» algo que se decidió omitir pisa datos que nadie quiso tocar.
 */
export interface FilaAEnviar {
  /** Línea del ARCHIVO de la que salió. Es lo que se enseña si el servidor la rechaza. */
  fila: number;
  datos: Record<string, unknown>;
}

export function filasParaEnviar(
  c: Clasificacion,
  decisiones: Record<string, Decision>,
): FilaAEnviar[] {
  const salida: FilaAEnviar[] = c.entran.map((f) => ({ fila: f.fila, datos: { ...f.valores } }));
  for (const rep of c.repetidos) {
    const d = decisiones[rep.clave] ?? decisionPorDefecto(rep);
    if (d.tipo === 'omitir') continue;
    if (d.tipo === 'actualizar') {
      // Sin producto guardado no hay nada que actualizar. Mandarlo igual sería un
      // «actualizar» sin `productId`, que el servidor rechaza con un 400 y se llevaría por
      // delante el lote entero.
      if (!rep.existente) continue;
      salida.push({
        fila: rep.filas[0]!.fila,
        datos: { ...rep.filas[0]!.valores, modo: 'actualizar', productId: rep.existente.id },
      });
      continue;
    }
    const elegida = rep.filas.find((f) => f.fila === d.fila) ?? rep.filas[0]!;
    salida.push({ fila: elegida.fila, datos: { ...elegida.valores } });
  }
  /*
    Cada fila se lleva SU número de línea del archivo pegado, en vez de deducirlo después
    comparando nombres y códigos. Con repetidos, esa deducción puede señalar la fila
    equivocada — y un informe que manda a corregir una fila que está bien, mientras la que
    de verdad falló no aparece, hace que se deje de creer el informe entero.
  */
  return salida;
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
