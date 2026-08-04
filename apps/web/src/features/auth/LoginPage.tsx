import { Eye, EyeOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { slugDesdeHostname, useAuth } from '@/features/auth/AuthProvider';
import { ApiError } from '@/lib/api';

/**
 * A dónde mandar a alguien que inició sesión desde el dominio base. Devuelve `null`
 * cuando ya se está en el subdominio correcto (el caso normal) y no hay que ir a
 * ninguna parte.
 */
function urlDelNegocio(slugEscrito: string): string | null {
  const dominio = import.meta.env.VITE_APP_DOMAIN;
  if (!dominio) return null;
  // Ya estamos en el subdominio de un negocio: nada que hacer.
  if (slugDesdeHostname(window.location.hostname, dominio)) return null;
  const slug = slugEscrito.trim().toLowerCase();
  if (!slug) return null;
  const { protocol, port } = window.location;
  return `${protocol}//${slug}.${dominio}${port ? `:${port}` : ''}/`;
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [business, setBusiness] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // El campo del negocio no se muestra de entrada: en una instalación con un solo
  // negocio sería ruido. Aparece cuando el API avisa de que hace falta.
  const [needsBusiness, setNeedsBusiness] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password, business);
      // Si se entró por el dominio base (sin subdominio de negocio), la sesión acaba de
      // quedar guardada en el origen EQUIVOCADO: la app del negocio vive en su
      // subdominio y el navegador no comparte almacenamiento entre orígenes. Antes esto
      // dejaba a la persona dando vueltas entre el registro y el login sin explicación.
      const destino = urlDelNegocio(business);
      if (destino) {
        window.location.href = destino;
        return;
      }
      navigate('/', { replace: true });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'No se pudo iniciar sesión';
      if (err instanceof ApiError && err.status === 400 && /negocio/i.test(msg)) {
        setNeedsBusiness(true);
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="flex flex-col items-center gap-1 text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-theme bg-primary text-primary-fg text-xl font-bold">
              V
            </div>
            <h1 className="text-xl font-semibold">VentaFácil</h1>
            <p className="text-sm text-muted">Ingresa a tu punto de venta</p>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <Input
              placeholder="Usuario"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder="Contraseña"
                className="pr-11"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted hover:text-fg"
                title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {needsBusiness && (
              <div className="flex flex-col gap-1">
                <Input
                  placeholder="Código del negocio"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={business}
                  onChange={(e) => setBusiness(e.target.value)}
                />
                <p className="text-xs text-muted">
                  Esta instalación atiende a varios negocios. Escribe el código del tuyo.
                </p>
              </div>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" size="lg" disabled={busy} className="mt-1">
              {busy ? 'Ingresando…' : 'Ingresar'}
            </Button>
            <Link
              to="/olvide-contrasena"
              className="text-center text-[13px] text-muted hover:text-fg"
            >
              ¿Olvidaste tu contraseña?
            </Link>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
