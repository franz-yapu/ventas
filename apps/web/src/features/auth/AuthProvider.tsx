import { SUBDOMINIOS_RESERVADOS, type Role } from '@ventafacil/shared';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, tokens } from '@/lib/api';

export interface AuthUser {
  sub: string;
  businessId: string;
  locationId: string | null;
  isCentral: boolean;
  role: Role;
  name: string;
  /**
   * Correo y su estado. No van en el JWT porque cambian sin volver a firmarlo; los
   * añade GET /auth/me. Sin correo verificado no se puede recuperar la contraseña,
   * y de eso avisa la app.
   */
  email?: string | null;
  emailVerified?: boolean;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface ProfileUpdate {
  name?: string;
  email?: string | null;
  currentPassword?: string;
  newPassword?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /** `business` = slug del negocio. Sólo hace falta si varios comparten la instalación. */
  login: (username: string, password: string, business?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Cierra la sesión en todos los dispositivos. Echa también de éste. */
  logoutEverywhere: () => Promise<void>;
  updateProfile: (input: ProfileUpdate) => Promise<void>;
  /** Relee /auth/me. Se usa tras confirmar el correo para quitar el aviso. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Deduce el negocio del subdominio: `llantas.ventafacil.com` -> `llantas`.
 *
 * Es lo que permite que cada cliente entre por SU dirección y no vea jamás que la
 * plataforma es compartida: nada de pedirle un "código de negocio" en el login.
 *
 * Requiere `VITE_APP_DOMAIN` (el dominio base) para no confundir el nombre del dominio
 * con un negocio: sin él, `ventafacil.com` daría el slug "ventafacil".
 */
export function slugDesdeHostname(
  hostname: string,
  dominioBase: string | undefined,
): string | undefined {
  if (!dominioBase) return undefined;
  const host = hostname.toLowerCase();
  const base = dominioBase.toLowerCase();
  if (host === base || !host.endsWith(`.${base}`)) return undefined;

  const prefijo = host.slice(0, -(base.length + 1));
  // Sólo un nivel: "a.b.dominio" no es un negocio llamado "a.b".
  if (!prefijo || prefijo.includes('.')) return undefined;
  if (SUBDOMINIOS_RESERVADOS.has(prefijo)) return undefined;
  return prefijo;
}

/**
 * ¿Se entró por el subdominio del panel de plataforma (`admin.midominio.com`)?
 *
 * `admin` ya estaba en SUBDOMINIOS_RESERVADOS, así que ningún negocio puede llamarse
 * así y quedarse con esa dirección.
 */
export function esSubdominioPlataforma(
  hostname: string,
  dominioBase: string | undefined,
): boolean {
  if (!dominioBase) return false;
  const host = hostname.toLowerCase();
  const base = dominioBase.toLowerCase();
  if (!host.endsWith(`.${base}`)) return false;
  return host.slice(0, -(base.length + 1)) === 'admin';
}

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

  const login = useCallback(async (username: string, password: string, business?: string) => {
    // Cómo se resuelve el negocio, en orden. Lo normal es que acierte el subdominio y
    // que la persona no tenga que saber nada:
    //   1. El subdominio por el que entró (cada cliente tiene el suyo).
    //   2. VITE_BUSINESS_SLUG, para un frontend dedicado a un solo cliente.
    //   3. Lo que escriba a mano: último recurso, sólo si el API lo pide.
    //   4. Nada: el API lo resuelve solo cuando hay un único negocio.
    const slug =
      slugDesdeHostname(window.location.hostname, import.meta.env.VITE_APP_DOMAIN) ||
      import.meta.env.VITE_BUSINESS_SLUG ||
      business?.trim() ||
      undefined;
    const res = await api.post<LoginResponse>('/auth/login', {
      username,
      password,
      business: slug,
    });
    tokens.set(res.accessToken, res.refreshToken);
    // La respuesta del login no trae correo ni verificación (no van en el token).
    // Se relee /auth/me para que el aviso aparezca ya en la primera pantalla.
    setUser(res.user);
    api
      .get<AuthUser>('/auth/me')
      .then(setUser)
      .catch(() => undefined);
  }, []);

  const logout = useCallback(async () => {
    // Se avisa al servidor para que cierre la sesión de VERDAD. Antes esto sólo
    // borraba los tokens del navegador: quien tuviera una copia del refresh seguía
    // entrando durante 30 días. No se espera al resultado para vaciar la sesión local:
    // si el servidor no responde, la persona igual quiere salir de esta pantalla.
    const refresh = tokens.refresh;
    tokens.clear();
    setUser(null);
    if (refresh) {
      await api.post('/auth/logout', { refreshToken: refresh }).catch(() => undefined);
    }
  }, []);

  /** Cierra la sesión en todos los dispositivos, incluido éste. */
  const logoutEverywhere = useCallback(async () => {
    await api.post('/auth/sessions/revoke-all');
    tokens.clear();
    setUser(null);
  }, []);

  /** Relee la identidad completa. El JWT no lleva correo ni verificación. */
  const refresh = useCallback(async () => {
    const me = await api.get<AuthUser>('/auth/me');
    setUser(me);
  }, []);

  const updateProfile = useCallback(
    async (input: ProfileUpdate) => {
      await api.patch<{ name: string }>('/auth/me', input);
      // Se relee en vez de parchear en memoria: si cambió el correo, el servidor lo
      // deja sin verificar, y eso hay que reflejarlo.
      await refresh();
    },
    [refresh],
  );

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, logoutEverywhere, updateProfile, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
