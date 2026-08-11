import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Los tests corren contra una base de datos DESECHABLE (ventafacil_test), nunca contra
 * la de desarrollo ni la de producción: el global-setup la recrea desde cero en cada
 * corrida. DATABASE_URL se fija aquí porque @ventafacil/db la lee al importarse.
 */
// `TEST_DB_SUFFIX` deja correr dos suites a la vez sin que se destruyan la base la una a
// la otra. Ver la explicación en `test/global-setup.ts`.
const OWNER_DB_URL =
  process.env.TEST_DATABASE_URL ??
  `postgres://ventafacil:cambia_esto_en_produccion@localhost:5434/ventafacil_test${process.env.TEST_DB_SUFFIX ?? ''}`;

// La app se conecta con un rol SIN privilegios de superusuario ni de dueño: es el
// único modo en que las políticas de RLS le aplican. El dueño se reserva para migrar.
const APP_DB_URL = (() => {
  const u = new URL(OWNER_DB_URL);
  u.username = 'ventafacil_app';
  u.password = 'app_test_pw';
  return u.toString();
})();

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    env: {
      DATABASE_URL: APP_DB_URL,
      OWNER_DATABASE_URL: OWNER_DB_URL,
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: 'test_access_secret',
      JWT_REFRESH_SECRET: 'test_refresh_secret',
      // Distinto de los anteriores a propósito: los tests comprueban que un token de
      // negocio no vale para el panel de plataforma ni al revés.
      JWT_PLATFORM_SECRET: 'test_platform_secret_distinto',
      // El registro y el "olvidé mi contraseña" están topados a 5/hora por IP en
      // producción, para que nadie los use como máquina de correo gratis. En los tests
      // todas las peticiones salen de la misma IP y agotarían el cupo a mitad de la
      // suite, así que se sube: el limitador en sí ya está cubierto en security.test.ts.
      REGISTER_RATE_LIMIT_MAX: '500',
      // Igual que arriba: el tope real (5/hora) cortaría la suite a mitad.
      EXPORT_RATE_LIMIT_MAX: '500',
      // El login tiene tope de 20 por IP en 5 minutos, y en los tests todas las
      // peticiones salen de la misma. La suite de sesiones sola gasta casi veinte, así
      // que estaba a un test de romperse por agotar la cuota — y se rompió al añadirlo.
      // El limitador de verdad se prueba en security.test.ts, que levanta su PROPIA app
      // con `buildApp({ loginRateLimitMax: 20 })` y comprueba el valor real.
      LOGIN_RATE_LIMIT_MAX: '500',
      /*
        Las fotos de producto van a un temporal, no a `apps/api/media`.

        Sin esto, cada corrida de la suite dejaba archivos dentro del repositorio —y el
        `.gitignore` no los tenía—, así que antes o después uno acababa commiteado. La ruta
        se resuelve al IMPORTAR `lib/almacen.ts`, o sea que tiene que estar puesta antes de
        que arranque cualquier test: aquí, y no en un `beforeAll`.
      */
      MEDIA_DIR: join(tmpdir(), `ventafacil-test-media${process.env.TEST_DB_SUFFIX ?? ''}`),
    },
    /**
     * Umbrales de cobertura: un trinquete, no una nota.
     *
     * Están un par de puntos por debajo de lo que hay hoy (87,3 % de sentencias, 75,2 %
     * de ramas) a propósito. No sirven para presumir de porcentaje: sirven para que un
     * módulo nuevo no entre SIN NINGÚN test y nadie se entere.
     *
     * Que esto importa lo demostró la propia revisión: los tres módulos peor cubiertos
     * del API —`inventory.ts` con 28 %, `sales.ts` con 77 %, `products.ts` con 81 %— son
     * exactamente de donde salieron el hallazgo crítico y dos de los altos. La cobertura
     * no dice que el código esté bien; dice dónde nadie ha mirado.
     *
     * Subirlos cuando suba la cobertura de verdad. Bajarlos es una decisión, no un
     * arreglo: si un cambio los rompe, lo que falta son tests.
     */
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: {
        statements: 85,
        branches: 72,
        functions: 90,
        lines: 85,
      },
    },
    // Las suites comparten la misma BD: en serie para que no se pisen.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
