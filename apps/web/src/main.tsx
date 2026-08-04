import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from '@/App';
import { AuthProvider } from '@/features/auth/AuthProvider';
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
        <AuthProvider>
          <SubscriptionProvider>
            <App />
          </SubscriptionProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
