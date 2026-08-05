import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Las variables VITE_* viven en el .env de la RAÍZ del monorepo, junto a las del API
  // (así lo documentan README y .env.example). Sin esto Vite sólo miraría apps/web y
  // VITE_APP_DOMAIN quedaba sin definir: el login no deducía el negocio del subdominio.
  envDir: fileURLToPath(new URL('../../', import.meta.url)),
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Precachea la app completa -> carga instantánea incluso sin señal.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
      },
      manifest: {
        name: 'VentaFácil',
        short_name: 'VentaFácil',
        description: 'Punto de venta multi-sucursal',
        theme_color: '#2f68d8',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
});
