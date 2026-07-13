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

const SECTION_LABEL = 'px-3 pb-[7px] pt-4 text-[10px] font-bold uppercase tracking-[0.09em] text-muted/60';

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
  const business = useBusiness();
  const routerLoc = useLocation();
  const isAdmin = user?.role === 'admin';
  const items = TOP_NAV.filter((n) => !n.adminOnly || isAdmin);
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
          <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-primary font-bold text-primary-fg">
            {(business?.name ?? 'V')[0]}
          </div>
          <span className="truncate text-[15px] font-bold tracking-[-0.02em]">{business?.name ?? 'VentaFácil'}</span>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-auto px-3 py-1">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => sideItem(isActive)}>
              <n.icon size={19} className="shrink-0" />
              <span className="truncate">{n.label}</span>
            </NavLink>
          ))}

          {isAdmin && (
            <>
              <div className={SECTION_LABEL}>Análisis</div>
              {ANALYTICS_NAV.map((n) => (
                <NavLink key={n.to} to={n.to} className={({ isActive }) => sideItem(isActive)}>
                  <n.icon size={19} className="shrink-0" />
                  <span className="truncate">{n.label}</span>
                </NavLink>
              ))}
              <div className={SECTION_LABEL}>Administración</div>
              {ADMIN_CHILDREN.map((c) => (
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
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => bottomItem(isActive)}>
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
          <span className="font-medium md:hidden">{business?.name ?? 'VentaFácil'}</span>
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
        {children}
      </main>
    </div>
  );
}
