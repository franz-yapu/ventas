import { MENSAJE_SLUG, slugDesdeNombre, TRIAL_DAYS, validarSlug } from '@ventafacil/shared';
import { Check, Eye, EyeOff, Loader2, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';

interface Disponibilidad {
  slug: string;
  disponible: boolean;
  motivo: string | null;
}

interface AltaCreada {
  slug: string;
  url: string;
  username: string;
  trialDays: number;
}

const DOMINIO = import.meta.env.VITE_APP_DOMAIN ?? 'localhost';

/**
 * Alta de un negocio nuevo, sin que nadie tenga que intervenir.
 *
 * Vive en el dominio base (no en el subdominio de ningún negocio), porque quien llega
 * aquí todavía no tiene el suyo. Al terminar se le manda a su dirección: la app de
 * cada negocio vive en otro origen y la sesión no se comparte entre orígenes, así que
 * no tiene sentido devolverle un token desde aquí.
 */
export function RegisterPage() {
  const [businessName, setBusinessName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTocado, setSlugTocado] = useState(false);
  const [adminName, setAdminName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);

  const [disp, setDisp] = useState<Disponibilidad | null>(null);
  const [comprobando, setComprobando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [creado, setCreado] = useState<AltaCreada | null>(null);

  // Mientras no toquen el campo, la dirección se propone desde el nombre. En cuanto la
  // editan a mano, deja de moverse sola: nada más molesto que un campo que se reescribe.
  useEffect(() => {
    if (!slugTocado) setSlug(slugDesdeNombre(businessName));
  }, [businessName, slugTocado]);

  // Comprobación con espera: se pregunta al servidor cuando dejan de teclear.
  useEffect(() => {
    setDisp(null);
    if (!slug) return;
    const problema = validarSlug(slug);
    if (problema) {
      setDisp({ slug, disponible: false, motivo: MENSAJE_SLUG[problema] });
      return;
    }
    setComprobando(true);
    const t = setTimeout(() => {
      api
        .get<Disponibilidad>(`/register/slug?slug=${encodeURIComponent(slug)}`)
        .then(setDisp)
        .catch(() => setDisp(null))
        .finally(() => setComprobando(false));
    }, 400);
    return () => {
      clearTimeout(t);
      setComprobando(false);
    };
  }, [slug]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const res = await api.post<AltaCreada>('/register', {
        businessName: businessName.trim(),
        slug,
        adminName: adminName.trim(),
        email: email.trim(),
        username: username.trim(),
        password,
      });
      setCreado(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear la cuenta');
    } finally {
      setEnviando(false);
    }
  }

  if (creado) {
    return (
      <div className="flex min-h-full items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success-bg text-success">
              <Check size={24} />
            </div>
            <h1 className="text-xl font-bold">Tu negocio ya está listo</h1>
            <p className="mt-2 text-sm text-muted">
              Tienes {creado.trialDays} días de prueba gratis. No hace falta tarjeta.
            </p>
            <div className="mt-4 rounded-theme border border-border p-3 text-left text-[13px]">
              <div className="text-muted">Tu dirección</div>
              <div className="font-semibold break-all">{creado.url}</div>
              <div className="mt-2 text-muted">Tu usuario</div>
              <div className="font-semibold">{creado.username}</div>
            </div>
            <p className="mt-3 text-[13px] text-muted">
              Te enviamos un correo para confirmar tu dirección. Confírmala cuando puedas:
              es lo que te permitirá recuperar la contraseña si algún día la olvidas.
            </p>
            <a href={creado.url}>
              <Button className="mt-4 w-full" size="lg">
                Entrar a mi negocio
              </Button>
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  const slugOk = disp?.disponible === true;
  const puedeEnviar =
    slugOk && businessName.trim() && adminName.trim() && email.trim() && username.trim().length >= 3 && password.length >= 8;

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="text-center">
            <h1 className="text-xl font-bold tracking-[-0.02em]">Crea tu punto de venta</h1>
            <p className="mt-1 text-sm text-muted">
              {TRIAL_DAYS} días gratis. Sin tarjeta.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-[13px] font-semibold" htmlFor="rg-negocio">
                Nombre del negocio
              </label>
              <Input
                id="rg-negocio"
                autoFocus
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Llantas El Rápido"
              />
            </div>

            <div>
              <label className="mb-1 block text-[13px] font-semibold" htmlFor="rg-slug">
                Tu dirección
              </label>
              <div className="flex items-center gap-1.5">
                <Input
                  id="rg-slug"
                  className="flex-1"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={slug}
                  onChange={(e) => {
                    setSlugTocado(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                  placeholder="mi-negocio"
                />
                <span className="shrink-0 text-[13px] text-muted">.{DOMINIO}</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[13px]">
                {comprobando && (
                  <>
                    <Loader2 size={14} className="animate-spin text-muted" />
                    <span className="text-muted">Comprobando…</span>
                  </>
                )}
                {!comprobando && disp?.disponible && (
                  <>
                    <Check size={14} className="text-success" />
                    <span className="text-success">Disponible</span>
                  </>
                )}
                {!comprobando && disp && !disp.disponible && (
                  <>
                    <X size={14} className="text-danger" />
                    <span className="text-danger">{disp.motivo}</span>
                  </>
                )}
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <label className="mb-1 block text-[13px] font-semibold" htmlFor="rg-nombre">
                Tu nombre
              </label>
              <Input
                id="rg-nombre"
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                placeholder="Ana Quispe"
              />
            </div>

            <div>
              <label className="mb-1 block text-[13px] font-semibold" htmlFor="rg-email">
                Tu correo
              </label>
              <Input
                id="rg-email"
                type="email"
                autoCapitalize="none"
                autoCorrect="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ana@minegocio.com"
              />
              <p className="mt-1 text-[12px] text-muted">
                Es lo único que te permitirá recuperar la contraseña.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-[13px] font-semibold" htmlFor="rg-usuario">
                Usuario para entrar
              </label>
              <Input
                id="rg-usuario"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                placeholder="ana"
              />
            </div>

            <div>
              <label className="mb-1 block text-[13px] font-semibold" htmlFor="rg-clave">
                Contraseña
              </label>
              <div className="relative">
                <Input
                  id="rg-clave"
                  type={verPassword ? 'text' : 'password'}
                  className="pr-11"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                />
                <button
                  type="button"
                  onClick={() => setVerPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted hover:text-fg"
                  aria-label={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {verPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && <p className="text-[13px] text-danger">{error}</p>}

            <Button type="submit" size="lg" disabled={!puedeEnviar || enviando} className="mt-1">
              {enviando ? 'Creando…' : 'Crear mi negocio'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
