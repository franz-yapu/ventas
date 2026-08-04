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
    },
    // Las suites comparten la misma BD: en serie para que no se pisen.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
