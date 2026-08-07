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
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
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
  build: {
    rollupOptions: {
      output: {
        /**
         * Partir el paquete de entrada, que pesaba 1.021 kB.
         *
         * Importa aquí más que en otros sitios: esto arranca en tabletas baratas y por la
         * conexión de una tienda, y lo primero que hace alguien al abrir la caja por la
         * mañana es esperar. El escáner y los widgets del panel ya se cargaban aparte
         * (`lazy`), pero todo lo demás iba junto — React, el enrutador, react-query,
         * Dexie y las veinte pantallas en un solo archivo.
         *
         * Se separa por VIDA ÚTIL, no por tamaño: estas tres piezas cambian de versión
         * dos veces al año, mientras que las pantallas cambian cada semana. Con ellas
         * fuera, publicar un arreglo de una pantalla ya no obliga a volver a bajar React
         * entero — el navegador y el service worker conservan lo que no cambió.
         */
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          datos: ['@tanstack/react-query', 'dexie', 'dexie-react-hooks'],
          iconos: ['lucide-react'],
        },
      },
    },
  },
});
