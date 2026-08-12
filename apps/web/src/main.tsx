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
        Sin banderas `future`: esto YA es React Router 7 (12 de agosto de 2026).

        Estaban puestas para adelantar el comportamiento de la 7 y silenciar sus dos
        avisos de consola. En la 7 ese comportamiento es el único que hay, así que la
        prop ni existe — pasarla no compila. Que la migración costara un solo error de
        tipos es justamente porque se habían activado antes.

        El motivo de subir: el aviso de redirección abierta de `<Link>` y `useNavigate`
        alcanza a TODA la línea 6 (>=6.0.0 <7.18.0), así que no se cerraba con ningún
        parche de la 6.x — la 6.30.4 que había era ya la última.
      */}
      <BrowserRouter>
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
