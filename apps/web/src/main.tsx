import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from '@/App';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { PlatformAuthProvider } from '@/features/platform/PlatformAuthProvider';
import { SubscriptionProvider } from '@/features/subscription/SubscriptionProvider';
import { manejarErrorDeConsulta } from '@/lib/errores';
import { ModoProvider } from '@/theme/ModoProvider';
import { aplicarModo, leerModo } from '@/theme/modo';
import './index.css';

// El modo se aplica ANTES de montar React: si esperara al primer render, una app
// abierta en oscuro daría un fogonazo blanco en cada arranque. En una caja a las once
// de la noche, eso deslumbra de verdad.
aplicarModo(leerModo());

// TanStack Query: cache + reintentos, clave para conexiones malas (offline-first).
//
// El `queryCache.onError` es el único punto por el que pasan los fallos de las 17
// pantallas. Sin él, una consulta que falla deja `data` vacío y la pantalla dibuja
// "Sin resultados": un servidor caído se veía igual que un negocio sin datos.
const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, refetchOnWindowFocus: false },
  },
  queryCache: new QueryCache({
    onError: (error) => manejarErrorDeConsulta(error, queryClient),
  }),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/*
        Las dos banderas de v7 van activadas a propósito.
        - Silencian los dos avisos de consola que salían en cada arranque, y un aviso
          que sale siempre es un aviso que nadie lee.
        - Adelantan el comportamiento de React Router 7, que es donde vive el parche de
          las dos redirecciones abiertas de la 6.30.4. Hoy no son alcanzables aquí
          —ningún `navigate()` recibe datos de fuera, todas las rutas son literales, y
          no hay SSR—, así que la migración no urge; pero cuando toque, con esto ya
          está medio hecha.
      */}
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        {/* El modo va por encima de la sesión: el login y la recuperación de
            contraseña también se miran de noche. */}
        <ModoProvider>
          {/* Dos sesiones sin relación: la del negocio y la del panel de plataforma.
              Sólo consulta el API si hay un token guardado de cada una. */}
          <AuthProvider>
            <SubscriptionProvider>
              <PlatformAuthProvider>
                <App />
              </PlatformAuthProvider>
            </SubscriptionProvider>
          </AuthProvider>
        </ModoProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
