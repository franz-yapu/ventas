import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { api } from '@/lib/api';

export interface BusinessConfig {
  id: string;
  name: string;
  logoUrl: string | null;
  theme: { primary?: string; secondary?: string; radius?: string };
  texts: Record<string, string>;
  productSchema: Array<{ key: string; label: string; type: string; required?: boolean }>;
  currency: string;
  taxRate: string;
  /** Tope de descuento del vendedor, en % del subtotal. */
  maxSellerDiscountPct: number;
}

const BusinessContext = createContext<BusinessConfig | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const { data } = useQuery({
    queryKey: ['business', user?.businessId],
    queryFn: () => api.get<BusinessConfig>('/business/me'),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  // Aplica el tema del negocio (theme_json) a las variables CSS -> white-label real.
  useEffect(() => {
    if (!data?.theme) return;
    const root = document.documentElement.style;
    if (data.theme.primary) {
      root.setProperty('--color-primary', data.theme.primary);
      // Refleja el color en la barra del navegador / PWA.
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', data.theme.primary);
    }
    if (data.theme.secondary) root.setProperty('--color-secondary', data.theme.secondary);
    if (data.theme.radius) root.setProperty('--radius', data.theme.radius);
    if (data.name) document.title = data.texts?.app_name ?? data.name;
  }, [data]);

  return <BusinessContext.Provider value={data ?? null}>{children}</BusinessContext.Provider>;
}

export function useBusiness() {
  return useContext(BusinessContext);
}
