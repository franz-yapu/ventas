import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Piezas de estructura de página, compartidas por los 20 módulos.
 *
 * Antes cada pantalla resolvía por su cuenta el encabezado (`text-2xl font-semibold` en
 * unas, otra medida en otras), el "cargando" era un texto gris suelto y el vacío no
 * existía: una tabla sin filas se veía igual que una tabla que todavía no ha cargado.
 * Con esto las tres cosas se deciden en un sitio y se ven igual en todas partes.
 */

/** Contenedor de página: el mismo aire y el mismo ritmo vertical en todas. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-4 p-4', className)}>{children}</div>;
}

/**
 * Encabezado: título, una línea de contexto y las acciones a la derecha.
 *
 * La descripción no es adorno. En pantallas como Inventario o Lectura Z, decir en una
 * línea qué se está mirando ahorra la pregunta que si no acaba en el teléfono.
 */
export function PageHeader({
  titulo,
  descripcion,
  acciones,
}: {
  titulo: string;
  descripcion?: ReactNode;
  acciones?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em]">{titulo}</h1>
        {descripcion && (
          <p className="mt-1 text-[13px] leading-relaxed text-muted">{descripcion}</p>
        )}
      </div>
      {acciones && <div className="flex shrink-0 flex-wrap gap-2">{acciones}</div>}
    </div>
  );
}

/**
 * Estado vacío: qué falta, por qué, y el botón que lo arregla.
 *
 * Una tabla vacía sin explicación se lee como un error de la aplicación. Con el motivo
 * y la acción al lado, se lee como lo que es: todavía no hay nada, y esto es lo que hay
 * que hacer.
 */
export function EmptyState({
  icono: Icono,
  titulo,
  descripcion,
  accion,
}: {
  icono?: React.ComponentType<{ size?: number | string; className?: string }>;
  titulo: string;
  descripcion?: string;
  accion?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 px-6 py-14 text-center">
      {Icono && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/10 text-muted">
          <Icono size={22} />
        </div>
      )}
      <h3 className="text-[15px] font-bold tracking-[-0.01em]">{titulo}</h3>
      {descripcion && (
        <p className="max-w-sm text-[13px] leading-relaxed text-muted">{descripcion}</p>
      )}
      {accion && <div className="mt-1">{accion}</div>}
    </div>
  );
}

/**
 * Bloque gris que ocupa el sitio de lo que está por llegar.
 *
 * Se prefiere a un "Cargando…" porque no mueve la página: cuando llegan los datos, se
 * rellenan los mismos huecos en vez de empujar todo hacia abajo. En una caja, ese salto
 * es la diferencia entre pulsar el botón que se quería y pulsar el de al lado.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('rounded-theme-sm', className)}
      // Los dos tonos vienen del tema: en claro son dos cremas y en oscuro dos grafitos.
      // Con `bg-muted/15` el hueco se veía casi blanco sobre el fondo oscuro, que es
      // justo lo contrario de "esto todavía no ha llegado".
      style={{
        background: 'linear-gradient(90deg, var(--color-skel-a), var(--color-skel-b))',
        animation: 'vf-shimmer 1.4s ease-in-out infinite',
      }}
      aria-hidden
    />
  );
}

/** Varias filas de esqueleto, para tablas y listas. */
export function SkeletonRows({ filas = 5, className }: { filas?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2 p-3', className)} role="status" aria-label="Cargando">
      {Array.from({ length: filas }, (_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

/** Rejilla de tarjetas-esqueleto, para paneles de métricas. */
export function SkeletonTiles({ n = 4 }: { n?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="status" aria-label="Cargando">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className="h-[86px] w-full" />
      ))}
    </div>
  );
}
