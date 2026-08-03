import { defineConfig } from 'vitest/config';

/**
 * Los tests corren contra una base de datos DESECHABLE (ventafacil_test), nunca contra
 * la de desarrollo ni la de producción: el global-setup la recrea desde cero en cada
 * corrida. DATABASE_URL se fija aquí porque @ventafacil/db la lee al importarse.
 */
const OWNER_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://ventafacil:cambia_esto_en_produccion@localhost:5434/ventafacil_test';

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
    },
    // Las suites comparten la misma BD: en serie para que no se pisen.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
