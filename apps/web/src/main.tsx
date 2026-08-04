import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from '@/App';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { PlatformAuthProvider } from '@/features/platform/PlatformAuthProvider';
import { SubscriptionProvider } from '@/features/subscription/SubscriptionProvider';
import './index.css';

// TanStack Query: cache + reintentos, clave para conexiones malas (offline-first).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, refetchOnWindowFocus: false },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* Dos sesiones sin relación: la del negocio y la del panel de plataforma.
            Sólo consulta el API si hay un token guardado de cada una. */}
        <AuthProvider>
          <SubscriptionProvider>
            <PlatformAuthProvider>
              <App />
            </PlatformAuthProvider>
          </SubscriptionProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
