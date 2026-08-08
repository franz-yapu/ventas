import { Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/AuthProvider';
import { api } from '@/lib/api';

/**
 * Bajar los datos de una pantalla en Excel.
 *
 * El servidor devuelve las filas y **el navegador arma el archivo**. Es deliberado: el
 * VPS tiene 1 vCPU para todo el stack, y construir una hoja de 20.000 filas es trabajo
 * real de CPU — mientras dura, la caja de una tienda espera para cobrar. El navegador de
 * quien pidió el informe está ocioso y ya trae la librería cargada.
 *
 * Sólo para el admin de la central, igual que la exportación completa: es el que responde
 * por los datos del negocio.
 */

export type Seccion = 'ventas' | 'productos' | 'inventario' | 'clientes' | 'caja' | 'actividad';

interface Props {
  seccion: Seccion;
  /** Los MISMOS filtros que está viendo la pantalla, para que baje lo que se ve. */
  filtros?: Record<string, string | undefined>;
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

export function Exportar({ seccion, filtros, className }: Props) {
  const { user } = useAuth();
  const [bajando, setBajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Quien no puede exportar no ve el botón: uno que siempre responde "no tienes permiso"
  // es peor que no estar.
  if (user?.role !== 'admin' || !user.isCentral) return null;

  async function bajar() {
    setBajando(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filtros ?? {})) if (v) params.set(k, v);
      const qs = params.toString();
      const r = await api.get<{ seccion: string; filas: Array<Record<string, unknown>> }>(
        `/export/${seccion}${qs ? `?${qs}` : ''}`,
      );

      if (r.filas.length === 0) {
        setError('No hay nada que exportar con los filtros de ahora.');
        return;
      }

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
      const hoy = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(
        new Blob([buf], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `${seccion}-${hoy}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo exportar. Inténtalo de nuevo.');
    } finally {
      setBajando(false);
    }
  }

  return (
    <div className={className}>
      <Button variant="outline" onClick={bajar} disabled={bajando}>
        <Download size={18} /> {bajando ? 'Preparando…' : 'Excel'}
      </Button>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
