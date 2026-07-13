import {
  BarChart3,
  Boxes,
  Coins,
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
import { SyncIndicator } from '@/components/SyncIndicator';
import { useAuth } from '@/features/auth/AuthProvider';
import { startSyncWorker } from '@/offline/sync';
import { useBusiness } from '@/theme/ThemeProvider';
import { cn } from '@/lib/utils';

// Menú operativo (lo ve todo el mundo). Es también la barra inferior en móvil.
const TOP_NAV = [
  { to: '/', label: 'Vender', icon: ShoppingCart, adminOnly: false, end: true },
  { to: '/ventas', label: 'Ventas', icon: Receipt, adminOnly: false },
  { to: '/productos', label: 'Productos', icon: Package, adminOnly: false },
  { to: '/inventario', label: 'Inventario', icon: Boxes, adminOnly: false },
];

// Grupo "Análisis" (sólo admin).
const ANALYTICS_NAV = [
  { to: '/panel', label: 'Panel', icon: LayoutDashboard },
  { to: '/reportes', label: 'Reportes', icon: BarChart3 },
  { to: '/caja', label: 'Caja', icon: Coins },
];

// Submenú de "Administración" (sólo admin).
const ADMIN_CHILDREN = [
  { to: '/ubicaciones', label: 'Ubicaciones', icon: MapPin },
  { to: '/usuarios', label: 'Usuarios', icon: Users },
  { to: '/actividad', label: 'Actividad', icon: History },
  { to: '/configuracion', label: 'Config', icon: Settings },
];

const SECTION_LABEL = 'px-3 pb-2 pt-4 text-[10px] font-bold uppercase tracking-[0.09em] text-muted/70';

const itemClass = (isActive: boolean) =>
  cn(
    'flex w-16 shrink-0 flex-col items-center gap-1 p-2 text-[10px] md:w-full md:flex-row md:gap-3 md:p-3 md:text-sm rounded-theme',
    isActive ? 'bg-primary text-primary-fg' : 'text-muted hover:bg-muted/10',
  );

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const business = useBusiness();
  const routerLoc = useLocation();
  const isAdmin = user?.role === 'admin';
  const items = TOP_NAV.filter((n) => !n.adminOnly || isAdmin);
  const roleLabel = isAdmin ? 'Administrador' : 'Vendedor';
  const userInitial = (user?.name ?? 'U').charAt(0).toUpperCase();
  const adminActive = ADMIN_CHILDREN.some((c) => routerLoc.pathname.startsWith(c.to));

  // El worker de sync solo corre con sesión activa (Layout solo se monta autenticado).
  useEffect(() => {
    startSyncWorker();
  }, []);

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      {/* Nav lateral en desktop; barra inferior FIJA en móvil (mobile-first). */}
      <aside className="no-print fixed inset-x-0 bottom-0 z-30 order-2 border-t border-border bg-surface md:static md:order-1 md:w-56 md:border-r md:border-t-0">
        <div className="hidden items-center gap-2 p-4 md:flex">
          <div className="flex h-8 w-8 items-center justify-center rounded-theme bg-primary text-primary-fg font-bold">
            {(business?.name ?? 'V')[0]}
          </div>
          <span className="truncate font-semibold">{business?.name ?? 'VentaFácil'}</span>
        </div>
        <nav className="flex overflow-x-auto md:flex-col md:justify-start md:gap-1 md:overflow-visible md:p-2">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => itemClass(isActive)}>
              <n.icon size={20} className="shrink-0" />
              <span className="w-full truncate text-center md:text-left">{n.label}</span>
            </NavLink>
          ))}

          {isAdmin && (
            <>
              {/* Móvil: una sola entrada que lleva al índice de administración. */}
              <NavLink to="/administracion" className={({ isActive }) => cn(itemClass(isActive || adminActive), 'md:hidden')}>
                <Shield size={20} className="shrink-0" />
                <span className="w-full truncate text-center">Admin</span>
              </NavLink>

              {/* Desktop: grupo "Análisis". */}
              <div className="hidden md:block">
                <div className={SECTION_LABEL}>Análisis</div>
                {ANALYTICS_NAV.map((n) => (
                  <NavLink key={n.to} to={n.to} className={({ isActive }) => itemClass(isActive)}>
                    <n.icon size={20} className="shrink-0" />
                    <span className="w-full truncate text-left">{n.label}</span>
                  </NavLink>
                ))}
              </div>

              {/* Desktop: grupo "Administración" (lista plana, como el diseño). */}
              <div className="hidden md:block">
                <div className={SECTION_LABEL}>Administración</div>
                {ADMIN_CHILDREN.map((c) => (
                  <NavLink key={c.to} to={c.to} className={({ isActive }) => itemClass(isActive)}>
                    <c.icon size={20} className="shrink-0" />
                    <span className="w-full truncate text-left">{c.label}</span>
                  </NavLink>
                ))}
              </div>
            </>
          )}
        </nav>
        {/* Bloque de usuario + salir (pie del sidebar en desktop). */}
        <div className="hidden border-t border-border p-3 md:block">
          <div className="flex items-center gap-2.5 px-2 pb-2.5 pt-1.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted/15 text-sm font-bold text-muted">
              {userInitial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{user?.name ?? 'Usuario'}</div>
              <div className="text-[11px] text-muted">{roleLabel}</div>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex w-full items-center justify-center gap-2 rounded-theme border border-border p-2.5 text-[13px] font-semibold text-muted hover:bg-muted/10"
          >
            <LogOut size={16} /> Salir
          </button>
        </div>
      </aside>
      <main className="order-1 flex-1 pb-20 md:order-2 md:pb-0">
        <div className="no-print sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-surface px-4">
          <span className="font-medium md:hidden">{business?.name ?? 'VentaFácil'}</span>
          <span className="hidden md:block" />
          <SyncIndicator />
        </div>
        {children}
      </main>
    </div>
  );
}
