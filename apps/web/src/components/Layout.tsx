import {
  BarChart3,
  Boxes,
  Coins,
  CreditCard,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  MapPin,
  Package,
  Receipt,
  Settings,
  Shield,
  ShoppingCart,
  Users,
} from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { AvisoDeError } from '@/components/AvisoDeError';
import { Marca, NombreDeMarca } from '@/components/Marca';
import { SyncIndicator } from '@/components/SyncIndicator';
import { useAuth } from '@/features/auth/AuthProvider';
import { EmailVerifyBanner } from '@/features/auth/EmailVerifyBanner';
import { SubscriptionBanner } from '@/features/subscription/SubscriptionBanner';
import { useSubscription } from '@/features/subscription/SubscriptionProvider';
import { startSyncWorker } from '@/offline/sync';
import { cn } from '@/lib/utils';

// Menú operativo (lo ve todo el mundo). Es también la barra inferior en móvil.
const TOP_NAV = [
  { to: '/', label: 'Vender', icon: ShoppingCart, adminOnly: false, end: true },
  { to: '/ventas', label: 'Ventas', icon: Receipt, adminOnly: false },
  { to: '/productos', label: 'Productos', icon: Package, adminOnly: false },
  { to: '/inventario', label: 'Inventario', icon: Boxes, adminOnly: false },
  // La caja es operativa, no analítica: la abre y la cierra quien está en el mostrador.
  // `end` para que estando en /caja/z (la lectura Z) no se marque también esta entrada.
  { to: '/caja', label: 'Caja', icon: Coins, adminOnly: false, end: true },
];

// Grupo "Análisis" (sólo admin). `feature` = entra sólo en los planes que la incluyen.
const ANALYTICS_NAV = [
  { to: '/panel', label: 'Panel', icon: LayoutDashboard, feature: 'reportes_avanzados' as const },
  { to: '/reportes', label: 'Reportes', icon: BarChart3 },
  { to: '/caja/z', label: 'Lectura Z', icon: FileText },
];

// Submenú de "Administración" (sólo admin). `central` = además, sólo la sucursal
// central: son las pantallas que cambian el negocio entero y el API las cierra a las
// sucursales. El encargado de una sucursal conserva Usuarios (los suyos) y Actividad.
const ADMIN_CHILDREN = [
  { to: '/ubicaciones', label: 'Ubicaciones', icon: MapPin, central: true },
  { to: '/usuarios', label: 'Usuarios', icon: Users },
  { to: '/actividad', label: 'Actividad', icon: History, feature: 'auditoria' as const },
  { to: '/configuracion', label: 'Config', icon: Settings, central: true },
  { to: '/suscripcion', label: 'Mi plan', icon: CreditCard, central: true },
];

const SECTION_LABEL =
  'px-3 pb-[7px] pt-4 text-[10px] font-bold uppercase tracking-[0.09em] text-muted/60';

// Item del sidebar de escritorio: tinte suave del primario cuando está activo
// (calcado de navStyle del prototipo), gris neutro cuando no.
const sideItem = (isActive: boolean) =>
  cn(
    'flex w-full items-center gap-3 rounded-[10px] px-[11px] py-2.5 text-sm font-semibold transition-colors',
    isActive ? 'ds-nav-tint' : 'text-[#66655f] hover:bg-black/[0.04]',
  );

// Item de la barra inferior móvil: reparto uniforme (flex-1), sin píldora;
// sólo el ícono y la etiqueta cambian de color (calcado del prototipo).
const bottomItem = (isActive: boolean) =>
  cn(
    'flex flex-1 flex-col items-center gap-1 py-1 text-[10px] font-semibold transition-colors',
    isActive ? 'text-primary' : 'text-muted',
  );

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { has } = useSubscription();
  const routerLoc = useLocation();
  const isAdmin = user?.role === 'admin';
  const items = TOP_NAV.filter((n) => !n.adminOnly || isAdmin);
  // Las entradas de un plan superior no se muestran. Es cortesía, no seguridad: quien
  // las cierra de verdad es el API.
  const analytics = ANALYTICS_NAV.filter((n) => !n.feature || has(n.feature));
  const adminChildren = ADMIN_CHILDREN.filter(
    (n) => (!n.feature || has(n.feature)) && (!n.central || user?.isCentral),
  );
  const roleLabel = isAdmin ? 'Administrador' : 'Vendedor';
  const userInitial = (user?.name ?? 'U').charAt(0).toUpperCase();
  // En móvil, cualquier pantalla de administración/análisis marca activa la entrada "Admin".
  const adminActive =
    routerLoc.pathname.startsWith('/administracion') ||
    [...ANALYTICS_NAV, ...ADMIN_CHILDREN].some((c) => routerLoc.pathname.startsWith(c.to));

  // El worker de sync solo corre con sesión activa (Layout solo se monta autenticado).
  useEffect(() => {
    startSyncWorker();
  }, []);

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      {/* ===== Sidebar (sólo escritorio) ===== */}
      <aside className="no-print hidden bg-surface md:sticky md:top-0 md:flex md:h-screen md:w-[230px] md:shrink-0 md:flex-col md:border-r md:border-border">
        <div className="flex items-center gap-3 px-[18px] pb-4 pt-5">
          <Marca size="sm" />
          <NombreDeMarca className="truncate text-[15px] font-bold tracking-[-0.02em]" />
        </div>
        <nav className="flex-1 space-y-0.5 overflow-auto px-3 py-1">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => sideItem(isActive)}
            >
              <n.icon size={19} className="shrink-0" />
              <span className="truncate">{n.label}</span>
            </NavLink>
          ))}

          {isAdmin && (
            <>
              <div className={SECTION_LABEL}>Análisis</div>
              {analytics.map((n) => (
                <NavLink key={n.to} to={n.to} className={({ isActive }) => sideItem(isActive)}>
                  <n.icon size={19} className="shrink-0" />
                  <span className="truncate">{n.label}</span>
                </NavLink>
              ))}
              <div className={SECTION_LABEL}>Administración</div>
              {adminChildren.map((c) => (
                <NavLink key={c.to} to={c.to} className={({ isActive }) => sideItem(isActive)}>
                  <c.icon size={19} className="shrink-0" />
                  <span className="truncate">{c.label}</span>
                </NavLink>
              ))}
            </>
          )}
        </nav>
        {/* Bloque de usuario (-> Mi perfil) + salir (pie del sidebar). */}
        <div className="border-t border-border p-3">
          <NavLink
            to="/perfil"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-[10px] px-2 py-2 transition-colors',
                isActive ? 'ds-nav-tint' : 'hover:bg-black/[0.04]',
              )
            }
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted/15 text-sm font-bold text-muted">
              {userInitial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{user?.name ?? 'Usuario'}</div>
              <div className="text-[11px] text-muted">{roleLabel}</div>
            </div>
          </NavLink>
          <button
            onClick={logout}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-theme border border-border p-2.5 text-[13px] font-semibold text-muted hover:bg-muted/10"
          >
            <LogOut size={16} /> Salir
          </button>
        </div>
      </aside>

      {/* ===== Barra inferior fija (sólo móvil) ===== */}
      <nav
        className="no-print fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface px-1 pt-2 md:hidden"
        style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
      >
        {items.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => bottomItem(isActive)}
          >
            <n.icon size={22} className="shrink-0" />
            <span>{n.label}</span>
          </NavLink>
        ))}
        {isAdmin && (
          <NavLink to="/administracion" className={cn(bottomItem(adminActive))}>
            <Shield size={22} className="shrink-0" />
            <span>Admin</span>
          </NavLink>
        )}
      </nav>

      {/* ===== Contenido ===== */}
      <main className="order-1 flex-1 pb-24 md:order-2 md:pb-0">
        <div className="no-print sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-surface px-4">
          {/* En móvil no hay barra lateral: la marca vive aquí. */}
          <div className="flex min-w-0 items-center gap-2 md:hidden">
            <Marca size="sm" className="h-7 w-7 rounded-[8px]" />
            <NombreDeMarca className="truncate font-semibold" />
          </div>
          <span className="hidden md:block" />
          <div className="flex items-center gap-3">
            <SyncIndicator />
            {/* Avatar (sólo móvil): acceso a Mi perfil, que incluye "Cerrar sesión". */}
            <NavLink
              to="/perfil"
              aria-label="Mi perfil"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-fg md:hidden"
            >
              {userInitial}
            </NavLink>
          </div>
        </div>
        <AvisoDeError />
        <SubscriptionBanner />
        <EmailVerifyBanner />
        {children}
      </main>
    </div>
  );
}
