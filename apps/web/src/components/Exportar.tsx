import { Download, FileText } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/AuthProvider';
import { api } from '@/lib/api';
import { avisoDeTamano, construirPdf, MAX_FILAS_PDF, tituloDe } from '@/lib/pdf';
import { useMarca } from '@/theme/ThemeProvider';

/**
 * Bajar los datos de una pantalla, en Excel o en PDF.
 *
 * El servidor devuelve las filas y **el navegador arma el archivo**. Es deliberado: el
 * VPS tiene 1 vCPU para todo el stack, y construir una hoja de 20.000 filas es trabajo
 * real de CPU — mientras dura, la caja de una tienda espera para cobrar. El navegador de
 * quien pidió el informe está ocioso y ya trae la librería cargada.
 *
 * Los dos formatos no compiten: el Excel es el que se manda al contador y el que aguanta
 * veinte mil filas; el PDF es el que se imprime, se firma y se archiva. Por eso el PDF
 * tiene tope y el Excel no.
 *
 * Sólo para el admin de la central, igual que la exportación completa: es el que responde
 * por los datos del negocio.
 */

export type Seccion = 'ventas' | 'productos' | 'inventario' | 'clientes' | 'caja' | 'actividad';

interface Props {
  seccion: Seccion;
  /** Los MISMOS filtros que está viendo la pantalla, para que baje lo que se ve. */
  filtros?: Record<string, string | undefined>;
  /**
   * Cómo se llama la sucursal de `filtros.locationId`, para que el PDF pueda decirlo.
   *
   * Lo pasa la pantalla porque es la única que tiene la lista cargada. Se podría pedir
   * `/locations` aquí, pero entonces una petición fallida dejaría un papel que parece de
   * todo el negocio siendo de una sola sucursal — y ese papel se firma. Si falta, el
   * informe dice "una sucursal" en vez de callarlo.
   */
  alcance?: string;
  className?: string;
}

/**
 * Ancho de cada columna, aproximado por su contenido.
 *
 * Sin esto todo sale en el ancho por defecto y las fechas aparecen como `#####`: quien lo
 * abre tiene que ensanchar nueve columnas a mano antes de poder leer nada. Se miran las
 * primeras 200 filas —suficiente para acertar— y se acota entre 10 y 45 para que una nota
 * larga no deje una columna de tres pantallas.
 */
function anchoDe(col: string, filas: Array<Record<string, unknown>>): number {
  const largo = Math.max(
    col.length,
    ...filas.slice(0, 200).map((f) => String(f[col] ?? '').length),
  );
  return Math.min(Math.max(largo + 2, 10), 45);
}

export function Exportar({ seccion, filtros, alcance, className }: Props) {
  const { user } = useAuth();
  const marca = useMarca();
  const [bajando, setBajando] = useState<null | 'excel' | 'pdf'>(null);
  const [error, setError] = useState<string | null>(null);

  // Quien no puede exportar no ve el botón: uno que siempre responde "no tienes permiso"
  // es peor que no estar.
  if (user?.role !== 'admin' || !user.isCentral) return null;

  /** Las filas que se ven en pantalla, con los mismos filtros. Lo común a los dos botones. */
  async function pedirFilas(): Promise<Array<Record<string, unknown>> | null> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filtros ?? {})) if (v) params.set(k, v);
    const qs = params.toString();
    const r = await api.get<{ seccion: string; filas: Array<Record<string, unknown>> }>(
      `/export/${seccion}${qs ? `?${qs}` : ''}`,
    );
    if (r.filas.length === 0) {
      setError('No hay nada que exportar con los filtros de ahora.');
      return null;
    }
    return r.filas;
  }

  function descargar(blob: Blob, extension: string) {
    const hoy = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${seccion}-${hoy}.${extension}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function bajarPdf() {
    setBajando('pdf');
    setError(null);
    try {
      const filas = await pedirFilas();
      if (!filas) return;

      /*
        El tope avisa y NO genera.

        Es la decisión deliberada frente a recortar: un PDF con las primeras 1.500 de 8.320
        filas y una nota al pie sigue siendo un papel incompleto que alguien va a firmar.
        Mejor mandarlo al Excel, que es exactamente la herramienta para ese tamaño.
      */
      if (filas.length > MAX_FILAS_PDF) {
        setError(avisoDeTamano(filas.length));
        return;
      }

      descargar(
        await construirPdf({
          seccion,
          filas,
          negocio: marca?.name ?? 'VentaFácil',
          logoUrl: marca?.logoUrl ?? null,
          generadoPor: user!.name,
          ahora: new Date(),
          desde: filtros?.from,
          hasta: filtros?.to,
          alcance,
          alcanceSinNombre: !!filtros?.locationId && !alcance,
        }),
        'pdf',
      );
    } catch {
      setError('No se pudo exportar. Inténtalo de nuevo.');
    } finally {
      setBajando(null);
    }
  }

  async function bajar() {
    setBajando('excel');
    setError(null);
    try {
      const filas = await pedirFilas();
      if (!filas) return;
      const r = { filas };

      /*
        `exceljs` se carga sólo al pulsar, no al abrir la aplicación.

        Importándola arriba se metía en el paquete de entrada y lo llevaba de 489 kB a
        1.421 kB — casi un mega más que baja TODO el mundo al abrir la caja por la mañana,
        para una función que usa el dueño una vez al mes. En una tablet barata por la
        conexión de una tienda, eso son varios segundos de pantalla en blanco.
      */
      const { default: ExcelJS } = await import('exceljs');
      const libro = new ExcelJS.Workbook();
      // El nombre de la hoja tiene un tope de 31 caracteres en Excel; con secciones de
      // una palabra nunca se llega, pero el recorte evita un archivo corrupto el día que
      // alguien añada una sección con nombre largo.
      const hoja = libro.addWorksheet(seccion.slice(0, 31));

      const columnas = Object.keys(r.filas[0]!);
      hoja.columns = columnas.map((c) => ({
        header: c,
        key: c,
        width: anchoDe(c, r.filas),
      }));
      hoja.addRows(r.filas);
      // La cabecera en negrita y congelada: con 20.000 filas, saber en qué columna se está
      // al bajar es la diferencia entre usar el archivo y volver a pedirlo.
      hoja.getRow(1).font = { bold: true };
      hoja.views = [{ state: 'frozen', ySplit: 1 }];

      const buf = await libro.xlsx.writeBuffer();
      descargar(
        new Blob([buf], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        'xlsx',
      );
    } catch {
      setError('No se pudo exportar. Inténtalo de nuevo.');
    } finally {
      setBajando(null);
    }
  }

  return (
    <div className={className}>
      <div className="flex gap-2">
        <Button variant="outline" onClick={bajar} disabled={!!bajando}>
          <Download size={18} /> {bajando === 'excel' ? 'Preparando…' : 'Excel'}
        </Button>
        <Button
          variant="outline"
          onClick={bajarPdf}
          disabled={!!bajando}
          title={`${tituloDe(seccion)} en PDF, para imprimir y firmar`}
        >
          <FileText size={18} /> {bajando === 'pdf' ? 'Preparando…' : 'PDF'}
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
