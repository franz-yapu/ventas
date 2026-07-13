import type { Role } from '@ventafacil/shared';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, tokens } from '@/lib/api';

export interface AuthUser {
  sub: string;
  businessId: string;
  locationId: string | null;
  isCentral: boolean;
  role: Role;
  name: string;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface ProfileUpdate {
  name?: string;
  currentPassword?: string;
  newPassword?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  updateProfile: (input: ProfileUpdate) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Al cargar, si hay token, recupera la sesión.
  useEffect(() => {
    if (!tokens.access) {
      setLoading(false);
      return;
    }
    api
      .get<AuthUser>('/auth/me')
      .then(setUser)
      .catch(() => tokens.clear())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    // Multi-negocio: cada frontend white-label puede fijar su negocio con
    // VITE_BUSINESS_SLUG. Si no está definido, el API resuelve el único negocio.
    const business = import.meta.env.VITE_BUSINESS_SLUG || undefined;
    const res = await api.post<LoginResponse>('/auth/login', { username, password, business });
    tokens.set(res.accessToken, res.refreshToken);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    tokens.clear();
    setUser(null);
  }, []);

  // Actualiza nombre/contraseña propios. El JWT conserva el nombre viejo hasta
  // el próximo login/refresh, así que reflejamos el nuevo nombre en memoria.
  const updateProfile = useCallback(async (input: ProfileUpdate) => {
    const updated = await api.patch<{ name: string }>('/auth/me', input);
    setUser((prev) => (prev ? { ...prev, name: updated.name } : prev));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
