import type { Role } from '@ventafacil/shared';

/** Contenido del access token: la identidad SIEMPRE sale de aqui, nunca del body. */
export interface AuthUser {
  sub: string; // userId
  businessId: string;
  locationId: string | null;
  /** true si su ubicación es la central: puede VER todas las ubicaciones. */
  isCentral: boolean;
  role: Role;
  name: string;
}

/**
 * Identidad del operador de plataforma. Deliberadamente NO tiene `businessId`: el
 * panel no actúa "como" un negocio, mira por encima de todos.
 */
export interface PlatformUser {
  sub: string; // platformAdmin.id
  email: string;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Poblado por el hook de auth. */
    authUser?: AuthUser;
    /** Poblado por requirePlatform. Nunca coexiste con authUser. */
    platformUser?: PlatformUser;
    /** Verificador del JWT de plataforma (namespace `platform` de @fastify/jwt). */
    platformVerify: <T = unknown>() => Promise<T>;
  }
  interface FastifyInstance {
    /**
     * Tope de intentos del login para ESTA instancia.
     *
     * Vive en la instancia y no sólo en `env` para que los tests puedan levantar una app
     * con el tope de verdad (20) mientras el resto de la suite corre con uno alto. Sin
     * esto, cada test que inicia sesión gastaba cupo del mismo contador global y la suite
     * se rompía al añadir el test número veintiuno — que es exactamente lo que pasó.
     */
    loginRateLimitMax: number;
    requireAuth: import('fastify').preHandlerHookHandler;
    requireAdmin: import('fastify').preHandlerHookHandler;
    /** Admin de la central: acciones que afectan al negocio entero. */
    requireCentralAdmin: import('fastify').preHandlerHookHandler;
    /** Cierra la ruta si el plan del negocio no incluye la función. */
    requireFeature: (
      feature: import('@ventafacil/shared').PlanFeature,
    ) => import('fastify').preHandlerHookHandler;
    /** Exige un token del panel de plataforma (secreto propio, ver platform-auth.ts). */
    requirePlatform: import('fastify').preHandlerHookHandler;
    /** Firmador del JWT de plataforma (namespace `platform` de @fastify/jwt). */
    platformJwt: { sign: (payload: object) => string };
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    /**
     * `jti` = id de la fila de `refresh_session` (sólo en el refresh).
     * `tv`  = versión de tokens del usuario; si no coincide con la de la base, el
     *         token fue revocado (baja, cambio de contraseña, cerrar en todas partes).
     */
    payload: AuthUser & { typ?: 'access' | 'refresh'; jti?: string; tv?: number };
    user: AuthUser & { typ?: 'access' | 'refresh'; jti?: string; tv?: number };
  }
}
