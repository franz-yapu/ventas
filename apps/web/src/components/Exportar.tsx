import { Download } from 'lucide-react';
import { useState } from 'react';
import * as XLSX from 'xlsx';
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

/** Ancho de columna aproximado por el contenido: sin esto todo sale en 8 caracteres. */
function anchos(filas: Array<Record<string, unknown>>): Array<{ wch: number }> {
  if (filas.length === 0) return [];
  return Object.keys(filas[0]!).map((col) => {
    const largo = Math.max(
      col.length,
      ...filas.slice(0, 200).map((f) => String(f[col] ?? '').length),
    );
    return { wch: Math.min(Math.max(largo + 2, 10), 45) };
  });
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

      const hoja = XLSX.utils.json_to_sheet(r.filas);
      hoja['!cols'] = anchos(r.filas);
      const libro = XLSX.utils.book_new();
      // El nombre de la hoja tiene un tope de 31 caracteres en Excel; con secciones de
      // una palabra nunca se llega, pero el recorte evita un archivo corrupto el día que
      // alguien añada una sección con nombre largo.
      XLSX.utils.book_append_sheet(libro, hoja, seccion.slice(0, 31));

      const hoy = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(libro, `${seccion}-${hoy}.xlsx`);
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
