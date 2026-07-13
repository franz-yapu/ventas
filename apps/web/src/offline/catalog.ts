import { api } from '@/lib/api';
import type { Location, Paginated, Product } from '@/lib/types';
import { db, setMeta } from './db';

/**
 * Descarga el catálogo completo (productos + ubicaciones) a IndexedDB.
 * Estrategia stale-while-revalidate: la UI usa la copia local y esto la refresca.
 */
export async function syncCatalog(): Promise<void> {
  const all: Product[] = [];
  let page = 1;
  // Pagina hasta traer todo el catálogo (negocios medianos: cientos/miles de items).
  for (;;) {
    const res = await api.get<Paginated<Product>>(`/products?page=${page}&limit=100`);
    all.push(...res.items);
    if (all.length >= res.total || res.items.length === 0) break;
    page++;
  }
  await db.transaction('rw', db.catalog, async () => {
    await db.catalog.clear();
    await db.catalog.bulkPut(all);
  });

  const locations = await api.get<Location[]>('/locations');
  await setMeta('locations', locations);
  await setMeta('catalogSyncedAt', new Date().toISOString());
}

/** Busca un producto por código de barras exacto en el catálogo local. */
export async function findByBarcode(barcode: string): Promise<Product | undefined> {
  const b = barcode.trim();
  if (!b) return undefined;
  return db.catalog.where('barcode').equals(b).first();
}

/** Búsqueda local (funciona offline). */
export async function searchCatalog(term: string, limit = 24): Promise<Product[]> {
  const t = term.trim().toLowerCase();
  if (!t) return db.catalog.orderBy('name').limit(limit).toArray();
  const all = await db.catalog.toArray();
  return all
    .filter(
      (p) =>
        p.name.toLowerCase().includes(t) ||
        p.sku.toLowerCase().includes(t) ||
        (p.barcode ?? '').toLowerCase().includes(t),
    )
    .slice(0, limit);
}
