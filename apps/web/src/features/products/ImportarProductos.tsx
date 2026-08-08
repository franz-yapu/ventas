import { AlertTriangle, Check, Download, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import {
  aCsv,
  CAMPOS,
  faltanObligatorios,
  interpretar,
  proponerMapeo,
  type Campo,
  type FilaInterpretada,
  type Mapeo,
} from './importar';

/**
 * Importar el inventario inicial desde Excel o CSV.
 *
 * Tres pasos, y cada uno existe por una razón concreta:
 *
 * 1. **Mapear** — el archivo de un cliente real nunca trae las columnas que esperamos. Se
 *    proponen las correspondencias y la persona corrige lo que haga falta, en vez de tener
 *    que renombrar su planilla para que le encaje a un programa.
 * 2. **Revisar** — nadie confía en un botón que se traga 5.000 filas a ciegas, y con razón:
 *    si un precio se leyó mal, el error se descubre cobrando. Aquí se ve antes de escribir.
 * 3. **Subir por lotes** — 5.000 filas en una sola petición se pasan de cualquier tiempo de
 *    espera razonable. De 300 en 300, con progreso, y si algo falla a mitad se sabe qué
 *    entró.
 *
 * Y al final, lo que convierte un callejón sin salida en un segundo intento: las filas
 * rechazadas se bajan en CSV para corregirlas y volver a subir **sólo ésas**.
 */

const TAMAÑO_LOTE = 300;

type Paso = 'mapear' | 'revisar' | 'subiendo' | 'listo';

interface Resultado {
  creados: number;
  errores: Array<{ fila: number; sku?: string; nombre?: string; motivo: string }>;
}

export function ImportarProductos({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [paso, setPaso] = useState<Paso>('mapear');
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [cabeceras, setCabeceras] = useState<string[]>([]);
  const [filas, setFilas] = useState<Array<Record<string, unknown>>>([]);
  const [mapeo, setMapeo] = useState<Mapeo>({});
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
  const buenas = interpretadas.filter((f) => f.errores.length === 0);
  const malas = interpretadas.filter((f) => f.errores.length > 0);
  const faltan = faltanObligatorios(mapeo);

  async function subir() {
    setPaso('subiendo');
    setProgreso(0);
    const errores: Resultado['errores'] = [];
    let creados = 0;

    for (let i = 0; i < buenas.length; i += TAMAÑO_LOTE) {
      const lote = buenas.slice(i, i + TAMAÑO_LOTE);
      try {
        const r = await api.post<Resultado & { created: number; skipped: number }>(
          '/products/import',
          { rows: lote.map((f) => f.valores) },
        );
        creados += r.created;
        /*
          La fila del archivo se traduce AQUÍ, no en el servidor.

          El servidor numera su lote de forma densa (1, 2, 3…), pero `buenas` está
          filtrado: si las filas buenas del archivo son la 2, la 3 y la 5, un error en la
          tercera del lote se informaría como "fila 4" — una que en el archivo está bien,
          mientras la que de verdad falló no aparece. Quien corrige va a la 4, no ve nada
          raro, y deja de fiarse del informe entero.

          Antes se mandaba `desdeFila` al servidor, que sólo funciona si no falta ninguna.
        */
        for (const e of r.errores ?? []) {
          const real = lote[e.fila - 1];
          errores.push({ ...e, fila: real?.fila ?? e.fila });
        }
      } catch (e) {
        /*
          Un lote que se cae NO se traga las filas que quedan.

          Antes se hacía `break` y la pantalla enseñaba el visto verde igual: las filas
          restantes desaparecían sin que nadie supiera cuáles eran. Ahora se paran los
          envíos —seguir a ciegas contra un servidor que acaba de fallar no ayuda— pero
          todo lo que no llegó a subirse entra en el informe, así que sale en el CSV de
          rechazadas y se puede reintentar.
        */
        const motivo =
          e instanceof Error && e.message ? e.message : 'Se cortó la subida en esta fila.';
        for (const f of buenas.slice(i)) {
          errores.push({ fila: f.fila, nombre: String(f.valores.name ?? ''), motivo });
        }
        setError(
          `${motivo} Lo que ya había entrado está guardado; el resto está en el archivo de rechazadas.`,
        );
        break;
      }
      setProgreso(Math.min(i + TAMAÑO_LOTE, buenas.length));
    }

    setResultado({ creados, errores });
    setPaso('listo');
    onDone();
  }

  function bajarRechazadas() {
    const delArchivo = malas;
    const delServidor = (resultado?.errores ?? []).map<FilaInterpretada>((e) => {
      const orig = interpretadas.find((f) => f.fila === e.fila);
      return {
        fila: e.fila,
        valores: {},
        errores: [e.motivo],
        original: orig?.original ?? { name: e.nombre, sku: e.sku },
      };
    });
    const csv = aCsv([...delArchivo, ...delServidor], cabeceras);
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `no-importados-${nombreArchivo.replace(/\.[^.]+$/, '')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function cerrar() {
    setAbierto(false);
    setFilas([]);
    setResultado(null);
    setError(null);
  }

  return (
    <>
      <input
        ref={ref}
        type="file"
        accept=".xlsx,.xls,.csv,text/csv"
        className="hidden"
        onChange={alElegirArchivo}
      />
      <Button variant="outline" onClick={() => ref.current?.click()}>
        <Upload size={18} /> Importar
      </Button>

      {abierto && (
        <Modal open onClose={cerrar} title="Importar productos" className="sm:max-w-2xl">
          {error && (
            <div className="mb-4 rounded-theme-sm bg-danger-bg p-3 text-sm text-danger">
              {error}
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
                <Button variant="outline" className="flex-1" onClick={cerrar}>
                  Cancelar
                </Button>
                <Button
                  className="flex-1"
                  disabled={faltan.length > 0}
                  onClick={() => setPaso('revisar')}
                >
                  Ver qué se importará
                </Button>
              </div>
            </div>
          )}

          {paso === 'revisar' && (
            <div className="flex flex-col gap-4">
              <div className="flex gap-3">
                <div className="flex-1 rounded-theme-sm bg-success-bg p-3">
                  <div className="text-2xl font-extrabold text-success">{buenas.length}</div>
                  <div className="text-xs text-success">entran</div>
                </div>
                <div className="flex-1 rounded-theme-sm bg-danger-bg p-3">
                  <div className="text-2xl font-extrabold text-danger">{malas.length}</div>
                  <div className="text-xs text-danger">no entran</div>
                </div>
              </div>

              {malas.length > 0 && (
                <div className="flex max-h-[30vh] flex-col gap-1.5 overflow-auto">
                  {malas.slice(0, 50).map((f) => (
                    <div key={f.fila} className="flex gap-2 text-[13px]">
                      <span className="shrink-0 font-mono text-muted">fila {f.fila}</span>
                      <span className="text-danger">{f.errores.join(' · ')}</span>
                    </div>
                  ))}
                  {malas.length > 50 && (
                    <p className="text-xs text-muted">
                      …y {malas.length - 50} más. Bájalas al terminar para corregirlas.
                    </p>
                  )}
                </div>
              )}

              {/* Las primeras filas ya interpretadas: es lo que permite darse cuenta de que
                  el precio se leyó de la columna equivocada ANTES de escribir nada. */}
              {buenas.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="ds-table w-full text-[13px]">
                    <thead className="text-left text-muted">
                      <tr>
                        <th className="p-2">Nombre</th>
                        <th className="p-2">Código</th>
                        <th className="p-2 text-right">Precio</th>
                        <th className="p-2 text-right">Stock</th>
                      </tr>
                    </thead>
                    <tbody>
                      {buenas.slice(0, 5).map((f) => (
                        <tr key={f.fila}>
                          <td className="p-2">{String(f.valores.name)}</td>
                          <td className="p-2 font-mono text-xs">{String(f.valores.sku ?? '—')}</td>
                          <td className="p-2 text-right">{String(f.valores.price)}</td>
                          <td className="p-2 text-right">
                            {String(f.valores.initialStock ?? '—')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setPaso('mapear')}>
                  Volver a las columnas
                </Button>
                <Button className="flex-1" disabled={buenas.length === 0} onClick={subir}>
                  Importar {buenas.length}
                </Button>
              </div>
            </div>
          )}

          {paso === 'subiendo' && (
            <div className="flex flex-col gap-3 py-6 text-center">
              <p className="text-sm">
                Subiendo {progreso} de {buenas.length}…
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-track">
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{ width: `${(progreso / Math.max(1, buenas.length)) * 100}%` }}
                />
              </div>
              <p className="text-xs text-muted">No cierres esta ventana.</p>
            </div>
          )}

          {paso === 'listo' && resultado && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                {resultado.errores.length + malas.length === 0 ? (
                  <Check className="text-success" size={28} />
                ) : (
                  <AlertTriangle className="text-warning" size={28} />
                )}
                <div>
                  <div className="text-lg font-bold">
                    {resultado.creados} producto{resultado.creados === 1 ? '' : 's'} importado
                    {resultado.creados === 1 ? '' : 's'}
                  </div>
                  {resultado.errores.length + malas.length > 0 && (
                    <div className="text-sm text-muted">
                      {resultado.errores.length + malas.length} no entraron
                    </div>
                  )}
                </div>
              </div>

              {resultado.errores.length + malas.length > 0 && (
                <>
                  <p className="text-sm text-muted">
                    Bájalas, corrige lo que dice cada línea y vuelve a importar{' '}
                    <strong className="text-fg">sólo ese archivo</strong>: lo que ya entró no se
                    duplica.
                  </p>
                  <Button variant="outline" onClick={bajarRechazadas}>
                    <Download size={18} /> Bajar las que no entraron
                  </Button>
                </>
              )}

              <Button onClick={cerrar}>Cerrar</Button>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
