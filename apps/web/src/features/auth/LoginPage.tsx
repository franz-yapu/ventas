import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Marca, NombreDeMarca } from '@/components/Marca';
import { Input } from '@/components/ui/input';
import { slugDesdeHostname, useAuth } from '@/features/auth/AuthProvider';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

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
    /**
     * Dos composiciones, no una encogida.
     *
     * En ESCRITORIO la marca ocupa una banda del 42% con el color primario: es la
     * primera pantalla que ve el cliente y es donde el white-label se nota. En MÓVIL esa
     * banda desaparece y el formulario sube arriba del todo, porque el teclado se come
     * media pantalla y una banda decorativa empujaría los campos fuera de la vista.
     */
    <div className="flex min-h-full flex-col md:flex-row">
      {/* ── Banda de marca (sólo escritorio) ──
          A pantalla completa, no una tarjeta flotando: es la primera impresión del
          negocio y su color tiene que llegar al borde. */}
      <div className="hidden w-[42%] max-w-[560px] shrink-0 flex-col bg-primary p-10 text-primary-fg md:flex xl:p-14">
        <div className="flex items-center gap-3">
          <Marca size="md" inverso />
          <NombreDeMarca className="text-[17px] font-semibold" />
        </div>
        <div className="mt-auto">
          <p className="text-[32px] font-bold leading-[1.15] tracking-[-0.035em]">
            Cobra rápido,
            <br />
            con o sin internet.
          </p>
          {/* Filete del color de acento: el mismo gesto que lleva el recibo. */}
          <div className="my-[18px] h-[3px] w-16 rounded-sm bg-secondary" />
          <p className="max-w-[300px] text-sm leading-relaxed opacity-[.88]">
            Tus ventas se guardan en el equipo y se sincronizan solas cuando vuelve la conexión.
          </p>
        </div>
      </div>

      {/* ── Formulario ──
          Centrado en el espacio que queda y con ancho de lectura propio: antes se
          pegaba al borde de la banda y dejaba una franja muerta a la derecha. */}
      <div className="flex flex-1 flex-col px-5 pb-5 pt-8 md:items-center md:justify-center md:bg-surface md:p-10">
        <div className="flex w-full flex-1 flex-col md:max-w-[440px] md:flex-none">
          {/* En móvil la marca va aquí arriba, centrada, en lugar de la banda. */}
          <div className="mb-7 flex flex-col items-center gap-2.5 md:hidden">
            <Marca size="xl" />
            <NombreDeMarca className="text-[17px] font-semibold" />
            <div className="h-[3px] w-11 rounded-sm bg-secondary" />
          </div>

          <div className="hidden md:block">
            <h1 className="text-[26px] font-bold tracking-[-0.03em]">Entrar</h1>
            <p className="mb-6 mt-1.5 text-sm text-muted">
              Usa el usuario que te dio tu administrador.
            </p>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col">
            <label htmlFor="usuario" className="mb-[7px] text-[13px] font-semibold">
              Usuario
            </label>
            <Input
              id="usuario"
              className="h-[52px] text-base md:h-12 md:text-[15px]"
              placeholder="tu usuario"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />

            <div className="mb-[7px] mt-4 flex items-baseline justify-between">
              <label htmlFor="clave" className="text-[13px] font-semibold">
                Contraseña
              </label>
              {/* Junto al campo, no perdido al final: se busca en el momento en que la
                  contraseña no entra, no después de darle a "Entrar". En móvil el enlace
                  va debajo del botón, donde cae el pulgar. */}
              <Link
                to="/olvide-contrasena"
                className="hidden text-[13px] font-semibold text-primary hover:underline md:block"
              >
                ¿La olvidaste?
              </Link>
            </div>
            <div className="relative">
              <Input
                id="clave"
                type={showPassword ? 'text' : 'password'}
                // Monoespaciada y espaciada mientras está oculta: los puntos se cuentan
                // de un vistazo, que es lo que se hace cuando la contraseña no entra.
                className={cn(
                  'h-[52px] pr-16 text-base md:h-12 md:text-[15px]',
                  !showPassword && 'font-mono tracking-[0.18em]',
                )}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-primary hover:underline"
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? 'Ocultar' : 'Ver'}
              </button>
            </div>

            {needsBusiness && (
              <div className="mt-4">
                <label htmlFor="negocio" className="mb-[7px] block text-[13px] font-semibold">
                  Código del negocio
                </label>
                <Input
                  id="negocio"
                  className="h-[52px] text-base md:h-12 md:text-[15px]"
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
                className="mt-4 rounded-theme bg-danger-bg px-3 py-2 text-[13px] font-medium text-danger"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-5 h-14 rounded-theme bg-primary text-[16.5px] font-bold text-primary-fg transition-[transform,opacity] active:scale-[.98] disabled:opacity-50 md:h-[52px] md:rounded-theme-sm md:text-base"
            >
              {busy ? 'Entrando…' : 'Entrar'}
            </button>

            <Link
              to="/olvide-contrasena"
              className="mt-4 text-center text-sm font-semibold text-primary hover:underline md:hidden"
            >
              ¿Olvidaste tu contraseña?
            </Link>
          </form>

          {/* Los términos, al pie. En móvil empujados abajo del todo. */}
          <p className="mt-auto pt-6 text-center text-[12.5px] leading-relaxed text-muted md:mt-[18px] md:pt-0 md:text-left">
            Al entrar aceptas los{' '}
            <Link
              to="/terminos"
              className="font-semibold text-fg underline-offset-2 hover:underline"
            >
              términos
            </Link>{' '}
            y la{' '}
            <Link
              to="/privacidad"
              className="font-semibold text-fg underline-offset-2 hover:underline"
            >
              privacidad
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
