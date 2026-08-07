import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Paginated } from '@/lib/types';

/**
 * Lista con scroll infinito / "Cargar más" sobre endpoints que devuelven { items, total, page, limit }.
 * `path` puede incluir querystring; se le añade page/limit.
 */
export function useInfiniteList<T>(key: unknown[], path: string, limit = 30) {
  const q = useInfiniteQuery({
    queryKey: [...key, 'infinite'],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.get<Paginated<T>>(
        `${path}${path.includes('?') ? '&' : '?'}page=${pageParam}&limit=${limit}`,
      ),
    getNextPageParam: (last) => (last.page * last.limit < last.total ? last.page + 1 : undefined),
  });

  const items = (q.data?.pages.flatMap((p) => p.items) ?? []) as T[];
  const total = q.data?.pages[0]?.total ?? 0;
  // Suma del conjunto filtrado (igual en todas las páginas); undefined si el endpoint no la envía.
  const sumTotal = q.data?.pages[0]?.sumTotal;
  return { ...q, items, total, sumTotal };
}
