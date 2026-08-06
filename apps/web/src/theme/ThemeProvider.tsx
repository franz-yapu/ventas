import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { slugDesdeHostname, useAuth } from '@/features/auth/AuthProvider';
import { api } from '@/lib/api';
import { aplicarColorDeMarca } from '@/lib/color';

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

/**
 * La marca, y sólo la marca: lo que se puede saber de un negocio SIN haber entrado.
 * Es lo que pinta el login, la recuperación de contraseña y la verificación de correo.
 */
export interface Marca {
  name: string;
  appName: string;
  logoUrl: string | null;
  theme: { primary?: string; secondary?: string; radius?: string };
}

const BusinessContext = createContext<BusinessConfig | null>(null);
const MarcaContext = createContext<Marca | null>(null);

/** El negocio al que apunta esta pestaña, deducido del subdominio o fijado por build. */
function slugActual(): string | undefined {
  return (
    slugDesdeHostname(window.location.hostname, import.meta.env.VITE_APP_DOMAIN) ||
    import.meta.env.VITE_BUSINESS_SLUG ||
    undefined
  );
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const slug = slugActual();

  const { data } = useQuery({
    queryKey: ['business', user?.businessId],
    queryFn: () => api.get<BusinessConfig>('/business/me'),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  /**
   * Marca pública, para cuando todavía no hay sesión.
   *
   * Sin esto, el cliente que abre `su-negocio.dominio.com` veía un login genérico con
   * la marca del proveedor: el white-label se rompía justo en la primera pantalla. Sólo
   * se pide si el subdominio dice de qué negocio se trata; en el dominio base no hay
   * negocio que mostrar y no se pide nada.
   *
   * `retry: false` porque un 404 aquí es una respuesta legítima ("este subdominio no es
   * de nadie"), no un fallo que reintentar.
   */
  const { data: publica } = useQuery({
    queryKey: ['marca', slug],
    queryFn: () => api.get<Marca>(`/public/business/${slug}`),
    enabled: !user && !!slug,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  // La sesión manda sobre la marca pública: en cuanto se entra, los datos son los
  // completos y además pueden estar más frescos que la copia cacheada del login.
  const marca: Marca | null = data
    ? {
        name: data.name,
        appName: data.texts?.app_name ?? data.name,
        logoUrl: data.logoUrl,
        theme: data.theme,
      }
    : (publica ?? null);

  // Aplica el tema del negocio (theme_json) a las variables CSS -> white-label real.
  useEffect(() => {
    if (!marca) return;
    const root = document.documentElement.style;
    if (marca.theme?.primary) {
      // Fija también el color del texto que va encima, calculado del color elegido.
      aplicarColorDeMarca('primary', marca.theme.primary);
      // Refleja el color en la barra del navegador / PWA.
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', marca.theme.primary);
    }
    if (marca.theme?.secondary) aplicarColorDeMarca('secondary', marca.theme.secondary);
    if (marca.theme?.radius) root.setProperty('--radius', marca.theme.radius);
    if (marca.appName) document.title = marca.appName;
  }, [marca]);

  return (
    <BusinessContext.Provider value={data ?? null}>
      <MarcaContext.Provider value={marca}>{children}</MarcaContext.Provider>
    </BusinessContext.Provider>
  );
}

export function useBusiness() {
  return useContext(BusinessContext);
}

/** Marca para pintar: sirve con sesión y sin ella. */
export function useMarca() {
  return useContext(MarcaContext);
}
