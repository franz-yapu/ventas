import { Eye, EyeOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthShell } from '@/components/AuthShell';
import { Button } from '@/components/ui/button';
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
    <AuthShell titulo="Ingresar" descripcion="Ingresa a tu punto de venta">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="usuario" className="mb-1.5 block text-[13px] font-semibold">
            Usuario
          </label>
          <Input
            id="usuario"
            placeholder="tu usuario"
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor="clave" className="text-[13px] font-semibold">
              Contraseña
            </label>
            {/* Junto al campo, no perdido al final: se busca en el momento en que la
                contraseña no entra, no después de darle a "Ingresar". */}
            <Link
              to="/olvide-contrasena"
              className="text-[12px] font-semibold text-primary hover:underline"
            >
              ¿La olvidaste?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="clave"
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
              className="pr-11"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-[8px] p-1.5 text-muted transition-colors hover:bg-muted/10 hover:text-fg"
              title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {needsBusiness && (
          <div>
            <label htmlFor="negocio" className="mb-1.5 block text-[13px] font-semibold">
              Código del negocio
            </label>
            <Input
              id="negocio"
              placeholder="mi-negocio"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={business}
              onChange={(e) => setBusiness(e.target.value)}
            />
            <p className="mt-1 text-[12px] text-muted">
              Esta instalación atiende a varios negocios. Escribe el código del tuyo.
            </p>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-theme bg-danger-bg px-3 py-2 text-[13px] font-medium text-danger"
          >
            {error}
          </p>
        )}

        <Button type="submit" size="lg" disabled={busy} className="mt-1">
          {busy ? 'Ingresando…' : 'Ingresar'}
        </Button>
      </form>
    </AuthShell>
  );
}
