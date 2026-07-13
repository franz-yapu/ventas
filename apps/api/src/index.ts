import cors from '@fastify/cors';
import { API_PREFIX } from '@ventafacil/shared';
import Fastify from 'fastify';
import { env } from './env.js';
import { authPlugin } from './plugins/auth.js';
import { auditPlugin } from './plugins/audit.js';
import { analyticsRoutes } from './modules/analytics.js';
import { auditRoutes } from './modules/audit.js';
import { authRoutes } from './modules/auth.js';
import { dashboardConfigRoutes } from './modules/dashboard-config.js';
import { inventoryRoutes } from './modules/inventory.js';
import { businessRoutes } from './modules/business.js';
import { categoryRoutes } from './modules/categories.js';
import { customerRoutes } from './modules/customers.js';
import { locationRoutes } from './modules/locations.js';
import { productRoutes } from './modules/products.js';
import { reportRoutes } from './modules/reports.js';
import { saleRoutes } from './modules/sales.js';
import { userRoutes } from './modules/users.js';
import './types.js';

const app = Fastify({
  logger:
    env.nodeEnv === 'development'
      ? { transport: { target: 'pino-pretty' } }
      : true,
});

await app.register(cors, { origin: true, credentials: true });
await app.register(authPlugin);
await app.register(auditPlugin);

app.get('/health', async () => ({ data: { status: 'ok' }, error: null }));

await app.register(
  async (api) => {
    await api.register(authRoutes);
    await api.register(businessRoutes);
    await api.register(categoryRoutes);
    await api.register(productRoutes);
    await api.register(locationRoutes);
    await api.register(userRoutes);
    await api.register(inventoryRoutes);
    await api.register(customerRoutes);
    await api.register(saleRoutes);
    await api.register(reportRoutes);
    await api.register(analyticsRoutes);
    await api.register(dashboardConfigRoutes);
    await api.register(auditRoutes);
  },
  { prefix: API_PREFIX },
);

app
  .listen({ port: env.port, host: '0.0.0.0' })
  .then(() => app.log.info(`API en http://localhost:${env.port}${API_PREFIX}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
