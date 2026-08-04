import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { API_PREFIX } from '@ventafacil/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { env, originPermitido } from './env.js';
import { authPlugin } from './plugins/auth.js';
import { auditPlugin } from './plugins/audit.js';
import { platformAuthPlugin } from './plugins/platform-auth.js';
import { subscriptionPlugin } from './plugins/subscription.js';
import { analyticsRoutes } from './modules/analytics.js';
import { auditRoutes } from './modules/audit.js';
import { authRoutes } from './modules/auth.js';
import { dashboardConfigRoutes } from './modules/dashboard-config.js';
import { inventoryRoutes } from './modules/inventory.js';
import { businessRoutes } from './modules/business.js';
import { cashRoutes } from './modules/cash.js';
import { categoryRoutes } from './modules/categories.js';
import { customerRoutes } from './modules/customers.js';
import { locationRoutes } from './modules/locations.js';
import { platformRoutes } from './modules/platform.js';
import { productRoutes } from './modules/products.js';
import { registerRoutes } from './modules/register.js';
import { reportRoutes } from './modules/reports.js';
import { saleRoutes } from './modules/sales.js';
import { subscriptionRoutes } from './modules/subscription.js';
import { userRoutes } from './modules/users.js';
import './types.js';

/**
 * Construye la app sin escucharla. Separado de index.ts para que los tests puedan
 * levantarla en memoria (app.inject) sin abrir un puerto.
 */
export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : env.nodeEnv === 'development'
          ? { transport: { target: 'pino-pretty' } }
          : true,
  });

  // Cabeceras de seguridad. Se desactiva CSP: este servicio sólo responde JSON, nunca
  // HTML, así que una política de contenido no protege nada y sí puede estorbar.
  await app.register(helmet, { contentSecurityPolicy: false });

  // Con un subdominio por cliente, los orígenes no se pueden enumerar: `CORS_ORIGINS`
  // admite comodín (`https://*.ventafacil.com`) y aquí se resuelve por petición.
  await app.register(cors, {
    origin:
      env.corsOrigins === true
        ? true
        : (origin, cb) => {
            // Sin cabecera Origin (curl, healthchecks, la propia app en el servidor).
            if (!origin) return cb(null, true);
            cb(null, originPermitido(origin, env.corsOrigins as string[]));
          },
    credentials: true,
  });

  // Tope global por IP. Los límites finos van por ruta (ver /auth/login).
  await app.register(rateLimit, {
    max: env.rateLimitMax,
    timeWindow: env.rateLimitWindow,
    // Mensaje en el formato { data, error } que usa el resto del API.
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      data: null,
      error: `Demasiadas peticiones. Reintenta en ${Math.ceil(context.ttl / 1000)} s.`,
    }),
  });

  await app.register(authPlugin);
  await app.register(platformAuthPlugin);
  await app.register(auditPlugin);
  await app.register(subscriptionPlugin);

  app.get('/health', async () => ({ data: { status: 'ok' }, error: null }));

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(registerRoutes);
      await api.register(platformRoutes);
      await api.register(subscriptionRoutes);
      await api.register(businessRoutes);
      await api.register(categoryRoutes);
      await api.register(productRoutes);
      await api.register(locationRoutes);
      await api.register(userRoutes);
      await api.register(inventoryRoutes);
      await api.register(customerRoutes);
      await api.register(saleRoutes);
      await api.register(cashRoutes);
      await api.register(reportRoutes);
      await api.register(analyticsRoutes);
      await api.register(dashboardConfigRoutes);
      await api.register(auditRoutes);
    },
    { prefix: API_PREFIX },
  );

  return app;
}
