import type { Seccion } from '@/components/Exportar';
import { dateTime } from '@/lib/format';

/**
 * El informe en PDF: el mismo listado que baja en Excel, pero para imprimir y firmar.
 *
 * El Excel cubre el 90 % de lo que se pide y es lo que se manda al contador. Esto es lo
 * otro: el papel que se lleva a una reunión, se firma y se archiva. Por eso lleva cosas
 * que a una hoja de cálculo le sobran —el logo del negocio, los filtros escritos en
 * castellano, quién lo generó y cuándo, y las dos rayas del final— y le falta lo que a un
 * papel no le sirve: no se puede ordenar ni sumar.
 *
 * Se arma en el NAVEGADOR, por la misma razón que el Excel: el VPS tiene 1 vCPU para todo
 * el stack, y mientras compone doscientas páginas la caja de una tienda espera para
 * cobrar. El navegador de quien pidió el informe está ocioso.
 *
 * ## Por qué la lógica está partida en funciones sueltas
 *
 * Todo lo que decide QUÉ dice el papel —el título, la línea de filtros, el tope, cómo se
 * ve cada celda— son funciones puras que se prueban sin generar un PDF. Sólo `construirPdf`
 * toca la librería. Un test que abriera el PDF y buscara texto dentro estaría probando el
 * formato de Adobe, no nuestras decisiones.
 */

/**
 * Por encima de esto no se genera: se avisa y se manda al Excel.
 *
 * A ~40 filas por página, 1.500 filas son unas 38 páginas — ya mucho para imprimir, pero
 * todavía un documento. El listado de actividad llega a 20.000, que son 500 páginas y
 * varios segundos de trabajo del navegador para algo que nadie va a imprimir.
 *
 * El tope AVISA en vez de recortar. Un PDF que trae las primeras 1.500 de 8.320 filas sin
 * decirlo es la peor de las salidas: el informe llega, sólo que incompleto, y quien lo
 * firma no tiene forma de notarlo.
 */
export const MAX_FILAS_PDF = 1500;

/**
 * Aproximación para el aviso. Medida sobre un informe de ventas real: a 8 pt y en
 * horizontal entran 24 por hoja, no las 40 que se supusieron al escribir esto. Se deja en
 * 25 porque el aviso sirve para disuadir: quedarse corto —"unas 208 páginas" cuando son
 * 347— es el error que resta razones a la advertencia.
 */
const FILAS_POR_PAGINA = 25;

export function paginasAprox(filas: number): number {
  return Math.max(1, Math.ceil(filas / FILAS_POR_PAGINA));
}

/** El aviso cuando el listado no cabe en un papel. Dice el tamaño y a dónde ir. */
export function avisoDeTamano(filas: number): string {
  return (
    `Son ${filas.toLocaleString('es-BO')} filas, unas ${paginasAprox(filas)} páginas. ` +
    'El PDF es para imprimir; para este tamaño usa Excel.'
  );
}

const TITULOS: Record<Seccion, string> = {
  ventas: 'Ventas',
  productos: 'Productos',
  inventario: 'Inventario',
  clientes: 'Clientes',
  caja: 'Caja',
  actividad: 'Actividad',
};

export function tituloDe(seccion: Seccion): string {
  return TITULOS[seccion] ?? seccion;
}

const FECHA_PELADA = /^\d{4}-\d{2}-\d{2}$/;
const INSTANTE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * "1 de agosto de 2026" a partir de `2026-08-01`.
 *
 * Se formatea en **UTC** a propósito. Una fecha pelada la parsea `Date` como medianoche
 * UTC; pidiéndole después la zona del negocio (UTC−4) sale el día ANTERIOR — un informe
 * "del 31 de julio" cuando se pidió del 1 de agosto. Aquí no hay hora que corregir: el
 * texto tiene que decir el mismo día que escribió quien puso el filtro.
 */
function diaLargo(fecha: string, conAno = true): string {
  return new Date(`${fecha}T00:00:00Z`).toLocaleDateString('es-BO', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    ...(conAno ? { year: 'numeric' } : {}),
  });
}

/**
 * La línea que va bajo el título: qué recorte de los datos es este papel.
 *
 * Sin esto, dos informes del mismo listado son indistinguibles encima de una mesa — y el
 * que se firmó es uno de los dos. El mes y el año no se repiten si son los mismos en las
 * dos puntas: "del 1 al 31 de agosto de 2026", no "del 1 de agosto de 2026 al 31 de
 * agosto de 2026".
 */
export function lineaDeFiltros(f: {
  desde?: string;
  hasta?: string;
  alcance?: string;
  /** Hay un filtro de sucursal pero nadie dijo cómo se llama. Ver `Exportar`. */
  alcanceSinNombre?: boolean;
}): string {
  const partes: string[] = [];

  const desde = f.desde && FECHA_PELADA.test(f.desde) ? f.desde : undefined;
  const hasta = f.hasta && FECHA_PELADA.test(f.hasta) ? f.hasta : undefined;
  if (desde && hasta) {
    const mismoMes = desde.slice(0, 7) === hasta.slice(0, 7);
    const mismoAno = desde.slice(0, 4) === hasta.slice(0, 4);
    partes.push(
      mismoMes
        ? `del ${new Date(`${desde}T00:00:00Z`).getUTCDate()} al ${diaLargo(hasta)}`
        : `del ${diaLargo(desde, !mismoAno)} al ${diaLargo(hasta)}`,
    );
  } else if (desde) {
    partes.push(`desde el ${diaLargo(desde)}`);
  } else if (hasta) {
    partes.push(`hasta el ${diaLargo(hasta)}`);
  }

  if (f.alcance) partes.push(f.alcance);
  // Se dice que está filtrado aunque no se sepa por cuál. Callarlo dejaría un papel que
  // parece de todo el negocio y es de una sola sucursal.
  else if (f.alcanceSinNombre) partes.push('una sucursal');

  return partes.length ? partes.join(' · ') : 'todo el registro';
}

/**
 * "Generado por Ana Pérez · 11/8/26, 4:40 p. m."
 *
 * La fecha se formatea con el mismo `dateTime` que usan las quince pantallas: si algún día
 * se decide que el reloj va en 24 horas, cambia en un sitio y cambia también en el papel.
 */
export function lineaDeOrigen(quien: string, cuando: Date): string {
  return `Generado por ${quien} · ${dateTime(cuando.toISOString())}`;
}

/**
 * Cómo se ve una celda en el papel.
 *
 * Las fechas llegan en ISO desde el API —`2026-08-11T20:13:44.000Z`— y en un papel eso no
 * lo lee nadie. Los vacíos salen como raya y no como "null", que es lo que aparecía al
 * pasar el objeto crudo.
 */
export function celda(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';
  const s = String(valor);
  if (INSTANTE_ISO.test(s) && !Number.isNaN(new Date(s).getTime())) return dateTime(s);
  return s;
}

/** Un decimal en columna se lee mucho mejor alineado a la derecha. */
export function esNumerica(columna: string, filas: Array<Record<string, unknown>>): boolean {
  const muestra = filas.slice(0, 50).map((f) => f[columna]);
  const utiles = muestra.filter((v) => v !== null && v !== undefined && v !== '');
  if (utiles.length === 0) return false;
  return utiles.every((v) => typeof v === 'number' || /^-?\d+([.,]\d+)?$/.test(String(v)));
}

export interface DatosDelInforme {
  seccion: Seccion;
  filas: Array<Record<string, unknown>>;
  negocio: string;
  /** Data URI del logo (se guarda en PNG). Si falla al dibujarse, se sigue sin él. */
  logoUrl?: string | null;
  generadoPor: string;
  ahora: Date;
  desde?: string;
  hasta?: string;
  alcance?: string;
  alcanceSinNombre?: boolean;
}

/**
 * Genera el PDF y devuelve el archivo listo para descargar.
 *
 * `jspdf` y su tabla se cargan aquí dentro, no arriba del módulo: son ~350 kB que no tiene
 * por qué bajar quien abre la caja por la mañana para cobrar, igual que se hizo con
 * `exceljs`. Si se importaran arriba, entrarían en el paquete de entrada de toda la
 * aplicación aunque nadie pulse nunca el botón.
 */
export async function construirPdf(d: DatosDelInforme): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const columnas = Object.keys(d.filas[0] ?? {});
  // Con muchas columnas en vertical, las de texto se estrujan hasta partir cada palabra en
  // tres líneas. El listado de ventas tiene diez.
  const horizontal = columnas.length > 5;
  const doc = new jsPDF({
    orientation: horizontal ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();
  const MARGEN = 12;
  // Lo que se reserva arriba para que la tabla no pise la cabecera al pasar de página.
  const ALTO_CABECERA = 30;

  const titulo = tituloDe(d.seccion);
  const filtros = lineaDeFiltros(d);
  const origen = lineaDeOrigen(d.generadoPor, d.ahora);

  /*
    El logo, si se puede.

    Se guarda como PNG data URI de 256 px (`fileToLogo` en Configuración), que es lo que
    `addImage` sabe leer. Aun así va en try/catch: un logo guardado por una versión futura
    en otro formato reventaría la descarga entera, y perder el logo es mucho menos grave
    que no poder sacar el informe.
  */
  let conLogo = false;
  if (d.logoUrl) {
    try {
      doc.addImage(d.logoUrl, MARGEN, MARGEN - 2, 12, 12);
      conLogo = true;
    } catch {
      conLogo = false;
    }
  }
  const xTexto = MARGEN + (conLogo ? 16 : 0);

  /**
   * La cabecera de una página, sea de la tabla o la que se abre para la firma.
   *
   * Está suelta porque `didDrawPage` sólo dispara en las páginas que compone la tabla. La
   * hoja que se añade a mano para que la firma no quede cortada salía **en blanco con dos
   * rayas**: ni de qué negocio era, ni de qué informe, ni de qué fechas. Y es precisamente
   * la hoja que alguien firma y archiva por separado.
   */
  const dibujarCabecera = () => {
    if (conLogo) {
      try {
        doc.addImage(d.logoUrl!, MARGEN, MARGEN - 2, 12, 12);
      } catch {
        /* Ya salió una vez; si falla aquí, la página va sin logo y basta. */
      }
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(20);
    doc.text(`${d.negocio} — ${titulo}`, xTexto, MARGEN + 3);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text(filtros, xTexto, MARGEN + 8.5);
    doc.text(origen, ancho - MARGEN, MARGEN + 8.5, { align: 'right' });

    doc.setDrawColor(200);
    doc.line(MARGEN, ALTO_CABECERA - 5, ancho - MARGEN, ALTO_CABECERA - 5);
  };

  autoTable(doc, {
    head: [columnas],
    body: d.filas.map((f) => columnas.map((c) => celda(f[c]))),
    startY: ALTO_CABECERA,
    margin: { top: ALTO_CABECERA, left: MARGEN, right: MARGEN, bottom: 18 },
    styles: { fontSize: 8, cellPadding: 1.6, overflow: 'linebreak' },
    // Gris oscuro y no el color de la marca: esto se imprime, muchas veces en blanco y
    // negro y casi siempre en una impresora de tienda. Un encabezado de color se lleva
    // tinta y sale gris de todas formas.
    headStyles: { fillColor: [55, 65, 81], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    columnStyles: Object.fromEntries(
      columnas.map((c, i) => [i, esNumerica(c, d.filas) ? { halign: 'right' as const } : {}]),
    ),
    // La cabecera se dibuja en CADA página: a partir de la segunda hoja, un listado sin
    // encabezado es un montón de números sin dueño.
    didDrawPage: dibujarCabecera,
  });

  /*
    Las dos rayas del final, que son el motivo de que este informe exista.

    Van una sola vez, al terminar la tabla. Si lo que queda de hoja no da para las rayas
    más su rótulo, se abre una página: media firma cortada por el borde no vale para nada.
  */
  const tabla = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  let y = (tabla?.finalY ?? ALTO_CABECERA) + 18;
  if (y > alto - 32) {
    doc.addPage();
    // Con su cabecera: si no, esta hoja no dice de qué informe es. Ver `dibujarCabecera`.
    dibujarCabecera();
    y = ALTO_CABECERA + 10;
  }
  const anchoFirma = Math.min(70, (ancho - MARGEN * 2 - 20) / 2);
  doc.setDrawColor(120);
  doc.setFontSize(9);
  doc.setTextColor(90);
  for (const [i, rotulo] of ['Firma', 'Aclaración'].entries()) {
    const x = MARGEN + i * (anchoFirma + 20);
    doc.line(x, y, x + anchoFirma, y);
    doc.text(rotulo, x, y + 4.5);
  }

  /*
    El pie, al final y en una pasada aparte.

    "Página 3 de 12" no se puede escribir mientras se dibuja la página 3: el total no se
    sabe hasta que la última fila cae en su sitio. Por eso se recorren todas al terminar.
  */
  const paginas = doc.getNumberOfPages();
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(130);
    doc.text(
      `${d.filas.length.toLocaleString('es-BO')} ${d.filas.length === 1 ? 'fila' : 'filas'}`,
      MARGEN,
      alto - 8,
    );
    doc.text(`Página ${p} de ${paginas}`, ancho - MARGEN, alto - 8, { align: 'right' });
  }

  return doc.output('blob');
}
