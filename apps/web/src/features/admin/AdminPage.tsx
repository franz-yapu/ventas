import type { PlanFeature } from '@ventafacil/shared';
import { CreditCard, History, MapPin, Settings, Users, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Page, PageHeader } from '@/components/ui/page';
import { useAuth } from '@/features/auth/AuthProvider';
import { ExportarDatos } from '@/features/legal/ExportarDatos';
import { useSubscription } from '@/features/subscription/SubscriptionProvider';

const SECTIONS: Array<{
  to: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  feature?: PlanFeature;
  /** Sólo para la sucursal central: cambia el negocio entero, no una sucursal. */
  central?: boolean;
}> = [
  {
    to: '/ubicaciones',
    label: 'Ubicaciones',
    desc: 'Sucursales y oficina central',
    icon: MapPin,
    central: true,
  },
  { to: '/usuarios', label: 'Usuarios', desc: 'Cuentas y roles del equipo', icon: Users },
  {
    to: '/actividad',
    label: 'Actividad',
    desc: 'Registro de auditoría',
    icon: History,
    feature: 'auditoria',
  },
  {
    to: '/configuracion',
    label: 'Configuración',
    desc: 'Datos del negocio y tema',
    icon: Settings,
  },
  { to: '/suscripcion', label: 'Mi plan', desc: 'Plan, estado y cupos usados', icon: CreditCard },
];

export function AdminPage() {
  const { has } = useSubscription();
  const { user } = useAuth();
  const secciones = SECTIONS.filter(
    (s) => (!s.feature || has(s.feature)) && (!s.central || user?.isCentral),
  );

  return (
    <Page>
      <PageHeader titulo="Administración" descripcion="Todo lo que sólo tú puedes tocar." />
      <div className="grid gap-3 sm:grid-cols-2">
        {secciones.map((s) => (
          <Link key={s.to} to={s.to}>
            <Card className="transition hover:border-primary">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-theme bg-primary/10 text-primary">
                  <s.icon size={22} />
                </div>
                <div>
                  <div className="font-medium">{s.label}</div>
                  <div className="text-sm text-muted">{s.desc}</div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <ExportarDatos />

      <p className="text-[13px] text-muted">
        <Link to="/terminos" className="underline underline-offset-2">
          Términos del servicio
        </Link>
        {' · '}
        <Link to="/privacidad" className="underline underline-offset-2">
          Política de privacidad
        </Link>
      </p>
    </Page>
  );
}
