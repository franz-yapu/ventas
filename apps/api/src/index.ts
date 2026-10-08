import { queryClient } from '@ventafacil/db';
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

// Apagado ordenado. Cada despliegue manda SIGTERM y, sin esto, el proceso moría de
// golpe: la venta que se estuviera cobrando en ese instante quedaba a medias. Ahora
// deja de aceptar peticiones, termina las que están en curso y cierra la base.
// Docker espera 10 s antes de matar con SIGKILL; el plazo propio va por debajo para
// salir por nuestro pie y dejarlo dicho en el log.
const PLAZO_CIERRE_MS = 8_000;
let cerrando = false;

async function apagar(senal: NodeJS.Signals) {
  if (cerrando) return;
  cerrando = true;
  app.log.info({ senal }, 'Cerrando: se terminan las peticiones en curso…');
  const plazo = setTimeout(() => {
    app.log.error(`No cerró en ${PLAZO_CIERRE_MS / 1000} s: salida forzada`);
    process.exit(1);
  }, PLAZO_CIERRE_MS);
  plazo.unref();
  try {
    await app.close();
    await queryClient.end({ timeout: 2 });
    app.log.info('API cerrada');
    process.exit(0);
  } catch (err) {
    app.log.error(err, 'Fallo al cerrar');
    process.exit(1);
  }
}

process.once('SIGTERM', () => void apagar('SIGTERM'));
process.once('SIGINT', () => void apagar('SIGINT'));
