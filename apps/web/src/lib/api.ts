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

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (tokens.access) headers.set('Authorization', `Bearer ${tokens.access}`);

  const res = await fetch(BASE + path, { ...init, headers });

  // Intenta refrescar el access token una vez ante un 401.
  if (res.status === 401 && retry && tokens.refresh && path !== '/auth/refresh') {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, init, false);
  }

  const body = (await res.json().catch(() => ({ data: null, error: res.statusText }))) as
    | ApiResponse<T>
    | undefined;

  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? 'Error de red', body?.code);
  }
  return body!.data as T;
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
