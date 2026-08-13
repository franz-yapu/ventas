import { AlertTriangle, Check, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import {
  aCsv,
  CAMPOS,
  clasificar,
  decisionPorDefecto,
  faltanObligatorios,
  filasParaEnviar,
  interpretar,
  proponerMapeo,
  type Campo,
  type Clasificacion,
  type Decision,
  type FilaInterpretada,
  type Mapeo,
  type ProductoExistente,
  type Repetido,
} from './importar';

/**
 * Importar el inventario inicial desde Excel o CSV.
 *
 * Cuatro pasos, y cada uno existe por una razón concreta:
 *
 * 1. **Guía** — qué campos hay y cómo tiene que venir el archivo, ANTES de pedirlo. Sin
 *    esto, la primera pantalla que ve alguien es un selector de archivos y un formulario
 *    de correspondencias que no sabe rellenar. Con plantilla descargable, que resuelve de
 *    una vez al que no tiene nada armado.
 * 2. **Columnas** — el archivo de un cliente real nunca trae las columnas que esperamos.
 *    Se proponen las correspondencias y la persona corrige lo que haga falta, en vez de
 *    tener que renombrar su planilla para que le encaje a un programa.
 * 3. **Revisar** — nadie confía en un botón que se traga 5.000 filas a ciegas, y con
 *    razón: si un precio se leyó mal, el error se descubre cobrando. Aquí se ve antes de
 *    escribir nada, repartido en lo que entra, lo que está repetido y lo que no entra.
 * 4. **Subir por lotes** — 5.000 filas en una sola petición se pasan de cualquier tiempo
 *    de espera razonable. De 300 en 300, con progreso, y si algo falla a mitad se sabe
 *    qué entró.
 *
 * Y al final, lo que convierte un callejón sin salida en un segundo intento: las filas
 * rechazadas se bajan en CSV para corregirlas y volver a subir **sólo ésas**.
 */

const TAMAÑO_LOTE = 300;

type Paso = 'guia' | 'mapear' | 'revisar' | 'subiendo' | 'listo';

interface Resultado {
  creados: number;
  actualizados: number;
  omitidos: number;
  errores: Array<{ fila: number; sku?: string; nombre?: string; motivo: string }>;
}

/** La plantilla que se descarga: cabeceras que el sistema reconoce y una fila de ejemplo. */
function plantillaCsv(): string {
  const cabeceras = [
    'Nombre',
    'Precio',
    'Codigo',
    'Codigo de barras',
    'Descripcion',
    'Costo',
    'Cantidad',
    'Stock minimo',
  ];
  const ejemplo = [
    'Foco LED 9W',
    '21.50',
    'A-001',
    '7771234567890',
    'Luz fría',
    '14.00',
    '24',
    '5',
  ];
  return [cabeceras.join(','), ejemplo.join(',')].join('\n');
}

function descargar(nombre: string, texto: string) {
  // El BOM va delante para que Excel abra las tildes bien en Windows.
  const url = URL.createObjectURL(new Blob([`﻿${texto}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportarProductos({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [paso, setPaso] = useState<Paso>('guia');
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [cabeceras, setCabeceras] = useState<string[]>([]);
  const [filas, setFilas] = useState<Array<Record<string, unknown>>>([]);
  const [mapeo, setMapeo] = useState<Mapeo>({});
  const [existentes, setExistentes] = useState<ProductoExistente[]>([]);
  const [decisiones, setDecisiones] = useState<Record<string, Decision>>({});
  const [buscando, setBuscando] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function alElegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      // Igual que en `Exportar`: la librería pesa casi un mega y sólo hace falta aquí.
      // Cargarla arriba se la haría bajar a cada caja al abrir la aplicación.
      const { default: ExcelJS } = await import('exceljs');
      const libro = new ExcelJS.Workbook();
      if (/\.csv$/i.test(file.name)) {
        // exceljs lee CSV desde un stream de texto.
        await libro.csv.read(new Blob([buf]).stream() as unknown as NodeJS.ReadableStream);
      } else {
        await libro.xlsx.load(buf);
      }
      const hoja = libro.worksheets[0];
      if (!hoja) throw new Error('vacío');

      /*
        Se lee a mano y no con un ayudante, para poder decidir dos cosas:

        - Una celda vacía tiene que SEGUIR ahí como cadena vacía. Si desaparece de la fila,
          las columnas se desalinean y todo lo que venga detrás es basura.
        - Una fecha llega como `Date` y un número como `number`; los dejamos tal cual y ya
          los interpreta `importar.ts`, que sabe qué hacer con cada campo.
      */
      const fila1 = hoja.getRow(1);
      const cols: string[] = [];
      fila1.eachCell({ includeEmpty: false }, (celda, col) => {
        cols[col - 1] = String(celda.value ?? '').trim();
      });
      const cabecerasLimpias = cols.map((c, i) => c || `Columna ${i + 1}`);

      const datos: Array<Record<string, unknown>> = [];
      hoja.eachRow({ includeEmpty: false }, (fila, n) => {
        if (n === 1) return;
        const obj: Record<string, unknown> = {};
        cabecerasLimpias.forEach((cab, i) => {
          const v = fila.getCell(i + 1).value;
          // Una celda con fórmula trae `{ result }`: interesa el resultado, no la fórmula.
          obj[cab] =
            v && typeof v === 'object' && 'result' in v
              ? ((v as { result: unknown }).result ?? '')
              : (v ?? '');
        });
        // Una fila entera vacía es un separador visual de la planilla, no un producto.
        if (Object.values(obj).some((x) => String(x ?? '').trim() !== '')) datos.push(obj);
      });
      if (datos.length === 0) throw new Error('sin filas');
      setNombreArchivo(file.name);
      setCabeceras(cabecerasLimpias);
      setFilas(datos);
      setMapeo(proponerMapeo(cabecerasLimpias));
      setExistentes([]);
      setDecisiones({});
      setPaso('mapear');
      setResultado(null);
      setAbierto(true);
    } catch {
      setError('No se pudo leer el archivo. ¿Es un Excel o un CSV con una fila de títulos?');
      setAbierto(true);
    }
    if (ref.current) ref.current.value = '';
  }

  const interpretadas = filas.length ? interpretar(filas, mapeo) : [];
  const clasificacion: Clasificacion = clasificar(interpretadas, existentes);
  const { repetidos, noEntran } = clasificacion;
  const faltan = faltanObligatorios(mapeo);

  /**
   * Antes de revisar, se le pregunta al servidor cuáles de estos productos ya tiene.
   *
   * Se hace aquí y no al subir porque es lo único que permite decidir: subirlo primero y
   * enterarse después, que es lo que pasaba hasta ahora, deja a la persona con un informe
   * de errores y nada que hacer con él.
   */
  async function irARevisar() {
    setBuscando(true);
    setError(null);
    try {
      const buenas = interpretadas.filter((f) => f.errores.length === 0);
      const skus = [
        ...new Set(
          buenas
            .map((f) => (typeof f.valores.sku === 'string' ? f.valores.sku : ''))
            .filter(Boolean),
        ),
      ];
      const nombres = [
        ...new Set(
          buenas
            .map((f) => (typeof f.valores.name === 'string' ? f.valores.name : ''))
            .filter(Boolean),
        ),
      ];
      const r = await api.post<{ encontrados: ProductoExistente[] }>('/products/lookup', {
        skus: skus.slice(0, 2000),
        nombres: nombres.slice(0, 2000),
      });
      setExistentes(r.encontrados);
      const nuevas: Record<string, Decision> = {};
      for (const rep of clasificar(interpretadas, r.encontrados).repetidos) {
        nuevas[rep.clave] = decisionPorDefecto(rep);
      }
      setDecisiones(nuevas);
    } catch {
      /*
        Que falle la consulta no puede bloquear la importación entera: se sigue sin la
        lista de repetidos y el servidor los rechazará como antes, avisando en el informe.
        Peor sería dejar a alguien sin poder importar porque una consulta auxiliar falló.
      */
      setExistentes([]);
      setError(
        'No se pudo comprobar cuáles ya existen. Puedes seguir; los repetidos se avisarán al final.',
      );
    } finally {
      setBuscando(false);
      setPaso('revisar');
    }
  }

  const aEnviar = filasParaEnviar(clasificacion, decisiones);
  const omitidos = repetidos.filter(
    (r) => (decisiones[r.clave] ?? decisionPorDefecto(r)).tipo === 'omitir',
  ).length;

  function decidirTodos(tipo: 'omitir' | 'actualizar') {
    const nuevas = { ...decisiones };
    for (const r of repetidos) {
      // «Actualizar todos» sólo alcanza a los que existen: en un repetido del archivo que
      // aún no está guardado no hay nada que actualizar, y forzarlo lo dejaría fuera.
      if (tipo === 'actualizar' && !r.existente) continue;
      nuevas[r.clave] = { tipo };
    }
    setDecisiones(nuevas);
  }

  async function subir() {
    setPaso('subiendo');
    setProgreso(0);
    const errores: Resultado['errores'] = [];
    let creados = 0;
    let actualizados = 0;
    const lista = aEnviar;

    for (let i = 0; i < lista.length; i += TAMAÑO_LOTE) {
      const lote = lista.slice(i, i + TAMAÑO_LOTE);
      try {
        const r = await api.post<{
          created: number;
          updated: number;
          skipped: number;
          errores: Resultado['errores'];
        }>('/products/import', { rows: lote.map((f) => f.datos) });
        creados += r.created;
        actualizados += r.updated ?? 0;
        /*
          La fila del archivo se traduce AQUÍ, no en el servidor.

          El servidor numera su lote de forma densa (1, 2, 3…), pero lo que se le manda
          está filtrado y reordenado: si un error volviera con el número del lote, quien
          corrige iría a una fila del archivo que está perfecta mientras la que de verdad
          falló no aparece — y deja de fiarse del informe entero.
        */
        for (const e of r.errores ?? []) {
          // El servidor numera su lote de forma densa; cada fila trae pegado su número
          // real del archivo, que es el único que le sirve a quien mira su hoja.
          errores.push({ ...e, fila: lote[e.fila - 1]?.fila ?? 0 });
        }
      } catch (e) {
        /*
          Un lote que se cae NO se traga las filas que quedan: se paran los envíos —seguir
          a ciegas contra un servidor que acaba de fallar no ayuda— pero todo lo que no
          llegó a subirse entra en el informe, así que sale en el CSV de rechazadas.
        */
        const motivo =
          e instanceof Error && e.message ? e.message : 'Se cortó la subida en esta fila.';
        for (const f of lista.slice(i)) {
          errores.push({ fila: f.fila, nombre: String(f.datos.name ?? ''), motivo });
        }
        setError(
          `${motivo} Lo que ya había entrado está guardado; el resto está en el archivo de rechazadas.`,
        );
        break;
      }
      setProgreso(Math.min(i + TAMAÑO_LOTE, lista.length));
    }

    setResultado({ creados, actualizados, omitidos, errores });
    setPaso('listo');
    onDone();
  }

  function bajarRechazadas() {
    const delServidor = (resultado?.errores ?? []).map<FilaInterpretada>((e) => {
      const orig = interpretadas.find((f) => f.fila === e.fila);
      return {
        fila: e.fila,
        valores: {},
        errores: [e.motivo],
        original: orig?.original ?? { name: e.nombre, sku: e.sku },
      };
    });
    descargar(
      `no-importados-${nombreArchivo.replace(/\.[^.]+$/, '')}.csv`,
      aCsv([...noEntran, ...delServidor], cabeceras),
    );
  }

  function cerrar() {
    setAbierto(false);
    setFilas([]);
    setExistentes([]);
    setDecisiones({});
    setResultado(null);
    setError(null);
    setPaso('guia');
  }

  const numeroDePaso = paso === 'guia' ? 1 : paso === 'mapear' ? 2 : paso === 'revisar' ? 3 : 4;

  return (
    <>
      <input
        ref={ref}
        type="file"
        accept=".xlsx,.xls,.csv,text/csv"
        className="hidden"
        onChange={alElegirArchivo}
      />
      <Button variant="outline" onClick={() => setAbierto(true)}>
        <Upload size={18} /> Importar
      </Button>

      {abierto && (
        <Modal
          open
          onClose={cerrar}
          title={`Importar productos · paso ${numeroDePaso} de 4`}
          className="sm:max-w-2xl"
        >
          {error && (
            <div className="mb-4 rounded-theme-sm bg-danger-bg p-3 text-sm text-danger">
              {error}
            </div>
          )}

          {paso === 'guia' && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted">
                Sube tu lista en <strong className="text-fg">Excel</strong> o{' '}
                <strong className="text-fg">CSV</strong>. Sólo necesita una fila de títulos arriba y
                un producto por fila.
              </p>

              <div className="rounded-theme-sm border border-border">
                <div className="border-b border-border px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted">
                  Qué puede llevar tu archivo
                </div>
                <ul className="flex flex-col gap-1.5 p-3">
                  {CAMPOS.map((c) => (
                    <li key={c.campo} className="flex items-center gap-2 text-sm">
                      <span
                        className={
                          c.obligatorio
                            ? 'rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary'
                            : 'rounded bg-track px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted'
                        }
                      >
                        {c.obligatorio ? 'obligatorio' : 'opcional'}
                      </span>
                      <span>{c.etiqueta}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-muted">
                <li>
                  <strong className="text-fg">El orden da igual</strong>, y los títulos también:
                  reconoce «CANT», «P. VENTA», «Existencia» y muchos más. Lo que no acierte lo
                  corriges en el paso siguiente.
                </li>
                <li>
                  Los precios se entienden en cualquier formato: <code>1.234,50</code>,{' '}
                  <code>1234.5</code> o <code>Bs 1,234.50</code>.
                </li>
                <li>
                  Sin código, se genera uno automático.{' '}
                  <strong className="text-fg">El costo</strong> no lo ve el cliente y es lo que hace
                  que el reporte de ganancia diga la verdad.
                </li>
                <li>
                  Si un producto <strong className="text-fg">ya existe</strong>, se te avisa antes
                  de subir nada y decides tú si se queda como está o se actualiza.
                </li>
              </ul>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => descargar('plantilla-productos.csv', plantillaCsv())}
                >
                  <Download size={18} /> Descargar plantilla
                </Button>
                <Button className="flex-1" onClick={() => ref.current?.click()}>
                  <FileSpreadsheet size={18} /> Elegir archivo
                </Button>
              </div>
            </div>
          )}

          {paso === 'mapear' && filas.length > 0 && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted">
                <strong className="text-fg">{filas.length}</strong> filas en{' '}
                <strong className="text-fg">{nombreArchivo}</strong>. Revisa que cada columna de tu
                archivo esté en su sitio; lo que no uses, déjalo en «No importar».
              </p>

              <div className="flex max-h-[45vh] flex-col gap-2 overflow-auto">
                {cabeceras.map((col) => (
                  <div key={col} className="grid grid-cols-[1fr_1fr] items-center gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{col}</div>
                      {/* Un ejemplo real de la columna: es lo que permite darse cuenta de
                          que "CANT" no era la cantidad sino el número de caja. */}
                      <div className="truncate text-xs text-muted">
                        ej. {String(filas[0]?.[col] ?? '—') || '—'}
                      </div>
                    </div>
                    <Select
                      filter
                      value={mapeo[col] ?? ''}
                      onChange={(e) =>
                        setMapeo({ ...mapeo, [col]: (e.target.value || null) as Campo | null })
                      }
                      aria-label={`Columna ${col}`}
                    >
                      <option value="">No importar</option>
                      {CAMPOS.map((c) => (
                        <option key={c.campo} value={c.campo}>
                          {c.etiqueta}
                          {c.obligatorio ? ' *' : ''}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>

              {faltan.length > 0 && (
                <p className="text-sm text-warning">
                  Falta indicar: <strong>{faltan.join(', ')}</strong>
                </p>
              )}

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setPaso('guia')}>
                  Atrás
                </Button>
                <Button
                  className="flex-1"
                  disabled={faltan.length > 0 || buscando}
                  onClick={irARevisar}
                >
                  {buscando ? 'Comprobando…' : 'Ver qué se importará'}
                </Button>
              </div>
            </div>
          )}

          {paso === 'revisar' && (
            <div className="flex flex-col gap-4">
              <div className="flex gap-3">
                <div className="flex-1 rounded-theme-sm bg-success-bg p-3">
                  <div className="text-2xl font-extrabold text-success">{aEnviar.length}</div>
                  <div className="text-xs text-success">entran</div>
                </div>
                <div className="flex-1 rounded-theme-sm bg-warning-bg p-3">
                  <div className="text-2xl font-extrabold text-warning">{repetidos.length}</div>
                  <div className="text-xs text-warning">repetidos</div>
                </div>
                <div className="flex-1 rounded-theme-sm bg-danger-bg p-3">
                  <div className="text-2xl font-extrabold text-danger">{noEntran.length}</div>
                  <div className="text-xs text-danger">no entran</div>
                </div>
              </div>

              {repetidos.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold">Repetidos · decide qué hacer</h3>
                    <div className="flex gap-2">
                      <button
                        onClick={() => decidirTodos('omitir')}
                        className="rounded-theme border border-field px-2 py-1 text-xs font-semibold text-muted hover:bg-muted/10"
                      >
                        Omitir todos
                      </button>
                      <button
                        onClick={() => decidirTodos('actualizar')}
                        className="rounded-theme border border-field px-2 py-1 text-xs font-semibold text-muted hover:bg-muted/10"
                      >
                        Actualizar todos
                      </button>
                    </div>
                  </div>

                  <div className="flex max-h-[38vh] flex-col gap-2 overflow-auto">
                    {repetidos.map((r) => (
                      <GrupoRepetido
                        key={r.clave}
                        repetido={r}
                        decision={decisiones[r.clave] ?? decisionPorDefecto(r)}
                        onCambio={(d) => setDecisiones({ ...decisiones, [r.clave]: d })}
                      />
                    ))}
                  </div>
                </div>
              )}

              {noEntran.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-sm font-bold text-danger">No entran, y por qué</h3>
                  <div className="flex max-h-[22vh] flex-col gap-1.5 overflow-auto">
                    {noEntran.slice(0, 50).map((f) => (
                      <div key={f.fila} className="flex gap-2 text-[13px]">
                        <span className="shrink-0 font-mono text-muted">fila {f.fila}</span>
                        <span className="text-danger">{f.errores.join(' · ')}</span>
                      </div>
                    ))}
                    {noEntran.length > 50 && (
                      <p className="text-xs text-muted">
                        …y {noEntran.length - 50} más. Bájalas al terminar para corregirlas.
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setPaso('mapear')}>
                  Atrás
                </Button>
                <Button className="flex-1" disabled={aEnviar.length === 0} onClick={subir}>
                  Importar {aEnviar.length}
                </Button>
              </div>
            </div>
          )}

          {paso === 'subiendo' && (
            <div className="flex flex-col items-center gap-3 py-6">
              <p className="text-sm font-semibold">
                Subiendo {progreso} de {aEnviar.length}…
              </p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-track">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${aEnviar.length ? (progreso / aEnviar.length) * 100 : 0}%` }}
                />
              </div>
              <p className="text-xs text-muted">No cierres esta ventana.</p>
            </div>
          )}

          {paso === 'listo' && resultado && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col items-center gap-2 py-2">
                <Check className="text-success" size={32} />
                <p className="text-center text-sm">
                  <strong>{resultado.creados}</strong> productos nuevos
                  {resultado.actualizados > 0 && (
                    <>
                      {' y '}
                      <strong>{resultado.actualizados}</strong> actualizados
                    </>
                  )}
                  .
                </p>
              </div>

              <div className="flex flex-col gap-1 text-[13px] text-muted">
                {resultado.omitidos > 0 && (
                  <p>
                    <strong className="text-fg">{resultado.omitidos}</strong> repetidos omitidos por
                    decisión tuya: siguen como estaban.
                  </p>
                )}
                {(noEntran.length > 0 || resultado.errores.length > 0) && (
                  <p className="flex items-start gap-1.5 text-warning">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    <span>
                      {noEntran.length + resultado.errores.length} filas no se pudieron importar.
                    </span>
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                {(noEntran.length > 0 || resultado.errores.length > 0) && (
                  <Button variant="outline" className="flex-1" onClick={bajarRechazadas}>
                    <Download size={18} /> Bajar las que no entraron
                  </Button>
                )}
                <Button className="flex-1" onClick={cerrar}>
                  Listo
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

/** Una decisión: qué hacer con este producto repetido. */
function GrupoRepetido({
  repetido: r,
  decision,
  onCambio,
}: {
  repetido: Repetido;
  decision: Decision;
  onCambio: (d: Decision) => void;
}) {
  const nombre = String(r.filas[0]!.valores.name ?? '');
  const codigo = typeof r.filas[0]!.valores.sku === 'string' ? r.filas[0]!.valores.sku : null;
  const opcion = (activa: boolean) =>
    `rounded-theme border px-2 py-1 text-xs font-semibold ${
      activa ? 'border-primary bg-primary-soft text-primary' : 'border-field text-muted'
    }`;

  return (
    <div className="rounded-theme-sm border border-border p-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-semibold">{nombre}</span>
        {codigo && <span className="font-mono text-xs text-muted">{codigo}</span>}
        <span className="text-xs text-muted">
          {r.motivo === 'catalogo'
            ? '· ya está en tu catálogo'
            : `· viene ${r.filas.length} veces en el archivo (filas ${r.filas
                .map((f) => f.fila)
                .join(', ')})`}
        </span>
      </div>

      {r.existente && (
        <div className="mt-1 text-xs">
          {r.cambios.length === 0 ? (
            <span className="text-muted">Sin cambios: los datos son iguales.</span>
          ) : (
            <span className="text-muted">
              {r.cambios.map((c) => (
                <span key={c.campo} className="mr-3 inline-block">
                  {c.etiqueta} <span className="line-through">{c.de}</span> →{' '}
                  <strong className="text-fg">{c.a}</strong>
                </span>
              ))}
            </span>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          className={opcion(decision.tipo === 'omitir')}
          onClick={() => onCambio({ tipo: 'omitir' })}
        >
          Omitir
        </button>
        {r.existente && (
          <button
            className={opcion(decision.tipo === 'actualizar')}
            onClick={() => onCambio({ tipo: 'actualizar' })}
            disabled={r.cambios.length === 0}
            title={r.cambios.length === 0 ? 'No hay nada que cambiar' : undefined}
          >
            Actualizar el existente
          </button>
        )}
        {/* Cuál de las filas del archivo vale. Sólo cuando hay más de una que elegir. */}
        {r.filas.length > 1 &&
          r.filas.map((f) => (
            <button
              key={f.fila}
              className={opcion(decision.tipo === 'fila' && decision.fila === f.fila)}
              onClick={() => onCambio({ tipo: 'fila', fila: f.fila })}
            >
              Usar fila {f.fila}
              {f.valores.price != null && ` · ${String(f.valores.price)}`}
            </button>
          ))}
      </div>
    </div>
  );
}
