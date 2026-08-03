import { API_PREFIX } from '@ventafacil/shared';
import { buildApp } from './app.js';
import { env } from './env.js';

const app = await buildApp();

app
  .listen({ port: env.port, host: '0.0.0.0' })
  .then(() => app.log.info(`API en http://localhost:${env.port}${API_PREFIX}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
