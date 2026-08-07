import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Config propia de tests: sin el plugin de PWA, que no hace falta y alenta la corrida.
 *
 * El de React sí está, porque ahora hay tests que MONTAN componentes. El entorno por
 * defecto sigue siendo `node` —la mayoría prueba lógica pura y arranca en milisegundos—;
 * los que necesitan DOM lo piden por archivo con `@vitest-environment jsdom`, y así no se
 * paga jsdom en toda la suite para usarlo en cuatro archivos.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    /**
     * Umbrales POR CARPETA, no globales.
     *
     * Un umbral global aquí no diría nada: las 70 pantallas suman 10.000 líneas sin
     * montar y arrastran la media al 5 %, así que cualquier número que se pusiera sería o
     * imposible o inútil. Lo que sí tiene sentido es proteger lo que YA está probado —la
     * cola offline, el modo, el color, el cliente HTTP— para que no se erosione mientras
     * la cobertura de las pantallas sube poco a poco.
     *
     * Cuando haya tests de una pantalla entera, se le añade aquí su carpeta. La lista es
     * la lista de lo que hay red debajo.
     */
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: {
        'src/offline/**': { statements: 55, branches: 80, functions: 60, lines: 55 },
        'src/theme/**': { statements: 20, branches: 65, functions: 55, lines: 20 },
        'src/lib/color.ts': { statements: 80, branches: 85, functions: 85, lines: 80 },
      },
    },
  },
});
