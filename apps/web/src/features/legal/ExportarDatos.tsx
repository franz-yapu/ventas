import { Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { tokens } from '@/lib/api';
import { API_PREFIX } from '@ventafacil/shared';
import { useBusiness } from '@/theme/ThemeProvider';

const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000') + API_PREFIX;

/**
 * Descarga de todos los datos del negocio.
 *
 * Va con `fetch` y no con un enlace normal porque el endpoint necesita la cabecera de
 * autorización: un `<a href>` no la lleva, y pasar el token por la URL lo dejaría en
 * los registros del servidor y en el historial del navegador.
 */
export function ExportarDatos() {
  const business = useBusiness();
  const [bajando, setBajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function descargar() {
    setError(null);
    setBajando(true);
    try {
      const res = await fetch(BASE + '/business/export', {
        headers: { Authorization: `Bearer ${tokens.access}` },
      });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${business?.name ?? 'negocio'}-datos-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo descargar. Inténtalo de nuevo en un momento.');
    } finally {
      setBajando(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <p className="text-sm font-semibold">Descargar mis datos</p>
        <p className="text-xs text-muted">
          Una copia completa: productos, inventario, ventas con su detalle, clientes,
          cajas y actividad. Sirve para guardarla o para migrar a otro sistema.
        </p>
        {error && <p className="text-[13px] text-danger">{error}</p>}
        <Button variant="outline" onClick={descargar} disabled={bajando}>
          <Download size={16} /> {bajando ? 'Preparando…' : 'Descargar (JSON)'}
        </Button>
      </CardContent>
    </Card>
  );
}
