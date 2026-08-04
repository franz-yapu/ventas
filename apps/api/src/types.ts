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

declare module 'fastify' {
  interface FastifyRequest {
    /** Poblado por el hook de auth. */
    authUser?: AuthUser;
  }
  interface FastifyInstance {
    requireAuth: import('fastify').preHandlerHookHandler;
    requireAdmin: import('fastify').preHandlerHookHandler;
    /** Cierra la ruta si el plan del negocio no incluye la función. */
    requireFeature: (
      feature: import('@ventafacil/shared').PlanFeature,
    ) => import('fastify').preHandlerHookHandler;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser & { typ?: 'access' | 'refresh' };
    user: AuthUser & { typ?: 'access' | 'refresh' };
  }
}
