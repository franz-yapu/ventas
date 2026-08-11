import type { PlanFeature } from '@ventafacil/shared';
import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { AdminPage } from '@/features/admin/AdminPage';
import { AuditPage } from '@/features/audit/AuditPage';
import { esSubdominioPlataforma, slugDesdeHostname, useAuth } from '@/features/auth/AuthProvider';
import { CashPage } from '@/features/cash/CashPage';
import { CashZPage } from '@/features/cash/CashZPage';
import { InventoryPage } from '@/features/inventory/InventoryPage';
import { LegalPage } from '@/features/legal/LegalPage';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { VerifyEmailPage } from '@/features/auth/VerifyEmailPage';

// Dashboard usa Recharts (pesado): se carga sólo al abrirlo, no penaliza el POS del vendedor.
const DashboardPage = lazy(() =>
  import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
import { CustomersPage } from '@/features/customers/CustomersPage';
import { LocationsPage } from '@/features/locations/LocationsPage';
import { usePlatformAuth } from '@/features/platform/PlatformAuthProvider';
import { PlatformLoginPage } from '@/features/platform/PlatformLoginPage';
import { PlatformPage } from '@/features/platform/PlatformPage';
import { PosPage } from '@/features/pos/PosPage';
import { RegisterPage } from '@/features/register/RegisterPage';
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
  centralOnly,
  feature,
}: {
  children: ReactNode;
  adminOnly?: boolean;
  /**
   * Además de admin, tiene que ser de la sucursal CENTRAL. Son las pantallas que
   * cambian el negocio entero (configuración, sucursales), no una sucursal. El API
   * responde 403 igualmente: esto sólo evita enseñar una puerta que no abre.
   */
  centralOnly?: boolean;
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
  if (centralOnly && !user.isCentral) return <Navigate to="/" replace />;
  if (feature && !has(feature)) return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

/**
 * El panel de plataforma vive fuera del mundo de los negocios: sin Layout, sin tema
 * del cliente y sin `Protected` (ése mira la sesión de un negocio, que aquí no existe).
 */
function PlatformArea() {
  const { admin, loading } = usePlatformAuth();
  if (loading) {
    return <div className="flex min-h-full items-center justify-center text-muted">Cargando…</div>;
  }
  return admin ? <PlatformPage /> : <PlatformLoginPage />;
}

export function App() {
  // Quien entra por `admin.midominio.com` va al panel, no al POS de ningún negocio.
  const enPlataforma = esSubdominioPlataforma(
    window.location.hostname,
    import.meta.env.VITE_APP_DOMAIN,
  );
  // Dominio base (sin subdominio de negocio) y sin un negocio fijado por build: es la
  // puerta pública, donde vive el registro.
  const enDominioBase =
    !enPlataforma &&
    !slugDesdeHostname(window.location.hostname, import.meta.env.VITE_APP_DOMAIN) &&
    !import.meta.env.VITE_BUSINESS_SLUG;

  return (
    <ThemeProvider>
      <Routes>
        <Route path="/plataforma" element={<PlatformArea />} />
        {/* Rutas sin sesión. `/registro` es del dominio base (quien llega no tiene aún
            subdominio); las otras tres se abren desde un enlace del correo, ya en el
            subdominio del negocio. */}
        <Route path="/registro" element={<RegisterPage />} />
        {/* Públicas: se leen antes de tener cuenta, y desde cualquier subdominio. */}
        <Route path="/terminos" element={<LegalPage tipo="terminos" />} />
        <Route path="/privacidad" element={<LegalPage tipo="privacidad" />} />
        <Route path="/olvide-contrasena" element={<ForgotPasswordPage />} />
        <Route path="/restablecer" element={<ResetPasswordPage />} />
        <Route path="/verificar" element={<VerifyEmailPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            enPlataforma ? (
              <Navigate to="/plataforma" replace />
            ) : enDominioBase ? (
              // Nadie entra al POS desde el dominio base: no hay negocio que abrir.
              <Navigate to="/registro" replace />
            ) : (
              <Protected>
                <PosPage />
              </Protected>
            )
          }
        />
        <Route
          path="/ventas"
          element={
            <Protected>
              <SalesPage />
            </Protected>
          }
        />
        <Route
          path="/productos"
          element={
            <Protected>
              <ProductsPage />
            </Protected>
          }
        />
        <Route
          path="/inventario"
          element={
            <Protected>
              <InventoryPage />
            </Protected>
          }
        />
        <Route
          path="/perfil"
          element={
            <Protected>
              <ProfilePage />
            </Protected>
          }
        />
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
        <Route
          path="/caja"
          element={
            <Protected>
              <CashPage />
            </Protected>
          }
        />
        <Route
          path="/caja/z"
          element={
            <Protected adminOnly>
              <CashZPage />
            </Protected>
          }
        />
        <Route
          path="/administracion"
          element={
            <Protected adminOnly>
              <AdminPage />
            </Protected>
          }
        />
        <Route
          path="/ubicaciones"
          element={
            <Protected adminOnly centralOnly>
              <LocationsPage />
            </Protected>
          }
        />
        <Route
          path="/usuarios"
          element={
            <Protected adminOnly>
              <UsersPage />
            </Protected>
          }
        />
        {/* Sin `centralOnly`: un comprador es del negocio, no de una sucursal —la tabla
            no tiene ubicación—, así que el encargado de un local administra la misma
            lista que la central. */}
        <Route
          path="/clientes"
          element={
            <Protected adminOnly>
              <CustomersPage />
            </Protected>
          }
        />
        <Route
          path="/actividad"
          element={
            <Protected adminOnly feature="auditoria">
              <AuditPage />
            </Protected>
          }
        />
        <Route
          path="/configuracion"
          element={
            <Protected adminOnly centralOnly>
              <SettingsPage />
            </Protected>
          }
        />
        <Route
          path="/suscripcion"
          element={
            <Protected adminOnly>
              <SubscriptionPage />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ThemeProvider>
  );
}
