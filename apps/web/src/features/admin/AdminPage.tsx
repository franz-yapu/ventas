import { History, MapPin, Settings, Users, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';

const SECTIONS: Array<{ to: string; label: string; desc: string; icon: LucideIcon }> = [
  { to: '/ubicaciones', label: 'Ubicaciones', desc: 'Sucursales y oficina central', icon: MapPin },
  { to: '/usuarios', label: 'Usuarios', desc: 'Cuentas y roles del equipo', icon: Users },
  { to: '/actividad', label: 'Actividad', desc: 'Registro de auditoría', icon: History },
  { to: '/configuracion', label: 'Configuración', desc: 'Datos del negocio y tema', icon: Settings },
];

export function AdminPage() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">Administración</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((s) => (
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
    </div>
  );
}
