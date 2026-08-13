import { API_PREFIX } from '@ventafacil/shared';
import { buildApp } from './app.js';
import { env } from './env.js';

const app = await buildApp();

app
  .listen({ port: env.port, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`API en http://localhost:${env.port}${API_PREFIX}`);
    // Por dónde salen los correos, dicho en voz alta al arrancar: es la diferencia entre
    // «el cliente no recibió el enlace» y «el enlace está en este log».
    app.log.info(
      { driver: env.correoDriver, de: env.emailFrom },
      env.correoDriver === 'consola'
        ? '📧 Correo: driver de CONSOLA, no sale nada de esta máquina'
        : `📧 Correo por ${env.correoDriver}`,
    );
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
