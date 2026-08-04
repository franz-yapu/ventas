import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { platformApi, platformTokens } from '@/lib/api';

export interface PlatformAdmin {
  sub: string;
  email: string;
  name: string;
}

interface PlatformAuthValue {
  admin: PlatformAdmin | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<PlatformAuthValue | null>(null);

/**
 * Sesión del panel de plataforma, completamente aparte de la de los negocios.
 *
 * No cuelga de `AuthProvider` ni lo usa: son dos identidades distintas, con tokens
 * firmados con secretos distintos en el servidor. Que aquí sean también dos providers
 * sin relación evita el error de "reaprovechar" el usuario de un negocio.
 */
export function PlatformAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<PlatformAdmin | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!platformTokens.access) {
      setLoading(false);
      return;
    }
    platformApi
      .get<PlatformAdmin>('/platform/me')
      .then(setAdmin)
      .catch(() => platformTokens.clear())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await platformApi.post<{ accessToken: string; admin: PlatformAdmin }>(
      '/platform/login',
      { email, password },
    );
    platformTokens.set(res.accessToken);
    setAdmin(res.admin);
  }, []);

  const logout = useCallback(() => {
    platformTokens.clear();
    setAdmin(null);
  }, []);

  return <Ctx.Provider value={{ admin, loading, login, logout }}>{children}</Ctx.Provider>;
}

export function usePlatformAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePlatformAuth debe usarse dentro de PlatformAuthProvider');
  return ctx;
}
