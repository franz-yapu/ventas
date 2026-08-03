import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// Config propia de tests: sin el plugin de PWA ni el de React, que no hacen falta
// para probar la lógica de sincronización y sólo alentan la corrida.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
  },
});
