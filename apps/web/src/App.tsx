import type { PlanFeature } from '@ventafacil/shared';
import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { AdminPage } from '@/features/admin/AdminPage';
import { AuditPage } from '@/features/audit/AuditPage';
import { useAuth } from '@/features/auth/AuthProvider';
import { CashZPage } from '@/features/cash/CashZPage';
import { InventoryPage } from '@/features/inventory/InventoryPage';
import { LoginPage } from '@/features/auth/LoginPage';

// Dashboard usa Recharts (pesado): se carga sólo al abrirlo, no penaliza el POS del vendedor.
const DashboardPage = lazy(() =>
  import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
import { LocationsPage } from '@/features/locations/LocationsPage';
import { PosPage } from '@/features/pos/PosPage';
import { ProductsPage } from '@/features/products/ProductsPage';
import { ProfilePage } from '@/features/profile/ProfilePage';
// Reportes usa Recharts (pesado): se carga sólo al abrirlo, no penaliza el POS del vendedor.
const ReportsPage = lazy(() =>
  import('@/features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
import { SalesPage } from '@/features/sales/SalesPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { SubscriptionBlocked } from '@/features/subscription/SubscriptionBlocked';
import { SubscriptionPage } from '@/features/subscription/SubscriptionPage';
import { useSubscription } from '@/features/subscription/SubscriptionProvider';
import { UsersPage } from '@/features/users/UsersPage';
import { ThemeProvider } from '@/theme/ThemeProvider';

function Protected({
  children,
  adminOnly,
  feature,
}: {
  children: ReactNode;
  adminOnly?: boolean;
  /** Pantalla incluida sólo en ciertos planes. El API la cierra igual (requireFeature). */
  feature?: PlanFeature;
}) {
  const { user, loading } = useAuth();
  const { sub, has } = useSubscription();
  if (loading) {
    return <div className="flex min-h-full items-center justify-center text-muted">Cargando…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  // El bloqueo por suscripción sustituye a la app entera: con el POS a medias, quien
  // está en caja no entendería por qué dejó de poder cobrar.
  if (sub?.blocked && sub.status) return <SubscriptionBlocked status={sub.status} />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />;
  if (feature && !has(feature)) return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

export function App() {
  return (
    <ThemeProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Protected><PosPage /></Protected>} />
        <Route path="/ventas" element={<Protected><SalesPage /></Protected>} />
        <Route path="/productos" element={<Protected><ProductsPage /></Protected>} />
        <Route path="/inventario" element={<Protected><InventoryPage /></Protected>} />
        <Route path="/perfil" element={<Protected><ProfilePage /></Protected>} />
        <Route
          path="/panel"
          element={
            <Protected adminOnly feature="reportes_avanzados">
              <Suspense fallback={<div className="p-6 text-muted">Cargando panel…</div>}>
                <DashboardPage />
              </Suspense>
            </Protected>
          }
        />
        <Route
          path="/reportes"
          element={
            <Protected adminOnly>
              <Suspense fallback={<div className="p-6 text-muted">Cargando reportes…</div>}>
                <ReportsPage />
              </Suspense>
            </Protected>
          }
        />
        <Route path="/caja" element={<Protected adminOnly><CashZPage /></Protected>} />
        <Route path="/administracion" element={<Protected adminOnly><AdminPage /></Protected>} />
        <Route path="/ubicaciones" element={<Protected adminOnly><LocationsPage /></Protected>} />
        <Route path="/usuarios" element={<Protected adminOnly><UsersPage /></Protected>} />
        <Route
          path="/actividad"
          element={
            <Protected adminOnly feature="auditoria">
              <AuditPage />
            </Protected>
          }
        />
        <Route path="/configuracion" element={<Protected adminOnly><SettingsPage /></Protected>} />
        <Route path="/suscripcion" element={<Protected adminOnly><SubscriptionPage /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ThemeProvider>
  );
}
