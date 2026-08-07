import { API_PREFIX } from '@ventafacil/shared';

const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000') + API_PREFIX;

const ACCESS_KEY = 'vf_access';
const REFRESH_KEY = 'vf_refresh';

export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh?: string) {
    localStorage.setItem(ACCESS_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  /** Motivo legible por código en los 402: `subscription_blocked`, `plan_limit`… */
  code?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Presente en los errores de plan, para distinguirlos del resto. */
    public code?: string,
  ) {
    super(message);
  }
}

/** Desenvuelve `{ data, error }` o lanza ApiError. Común a los dos clientes. */
async function desenvolver<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({ data: null, error: res.statusText }))) as
    ApiResponse<T> | undefined;

  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? 'Error de red', body?.code);
  }
  return body!.data as T;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  // Sólo con cuerpo: Fastify rechaza con 400 una petición que declara JSON y llega
  // vacía. Pasaba en los POST sin datos ("cerrar en todos", "reenviar correo").
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (tokens.access) headers.set('Authorization', `Bearer ${tokens.access}`);

  const res = await fetch(BASE + path, { ...init, headers });

  // Intenta refrescar el access token una vez ante un 401.
  if (res.status === 401 && retry && tokens.refresh && path !== '/auth/refresh') {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, init, false);
  }

  return desenvolver<T>(res);
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(BASE + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refresh }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as ApiResponse<{ accessToken: string }>;
    if (body.data?.accessToken) {
      tokens.set(body.data.accessToken);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ── Cliente del panel de plataforma ────────────────────────────
//
// Token propio, guardado con OTRA clave: si el operador entra al panel desde el mismo
// navegador donde tiene abierta la sesión de un negocio (cosa habitual mientras das
// soporte), ninguna de las dos pisa a la otra. Sin refresh: la sesión del panel dura
// 8 h y se vuelve a entrar; es la cuenta con más alcance y menos piezas que revocar.
const PLATFORM_KEY = 'vf_platform_access';

export const platformTokens = {
  get access() {
    return localStorage.getItem(PLATFORM_KEY);
  },
  set(access: string) {
    localStorage.setItem(PLATFORM_KEY, access);
  },
  clear() {
    localStorage.removeItem(PLATFORM_KEY);
  },
};

async function platformRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (platformTokens.access) headers.set('Authorization', `Bearer ${platformTokens.access}`);
  const res = await fetch(BASE + path, { ...init, headers });
  return desenvolver<T>(res);
}

export const platformApi = {
  get: <T>(path: string) => platformRequest<T>(path),
  post: <T>(path: string, body?: unknown) =>
    platformRequest<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    platformRequest<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
};

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
