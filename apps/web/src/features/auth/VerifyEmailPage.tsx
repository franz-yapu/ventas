import { Check, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AuthShell } from '@/components/AuthShell';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/AuthProvider';
import { Aviso } from '@/features/auth/Aviso';
import { api, ApiError } from '@/lib/api';

/** Pantalla del enlace de confirmación del correo. Confirma sola al abrirse. */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { user, refresh } = useAuth();
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'error'>('cargando');
  const [error, setError] = useState<string | null>(null);
  // React 18 en modo estricto monta dos veces en desarrollo; sin esto, el segundo
  // intento consumiría un token ya gastado y mostraría un error falso.
  const yaIntentado = useRef(false);

  useEffect(() => {
    if (!token || yaIntentado.current) return;
    yaIntentado.current = true;
    api
      .post('/auth/verify-email', { token })
      .then(async () => {
        setEstado('ok');
        // Si hay sesión abierta, se relee para que desaparezca el aviso al instante.
        if (user) await refresh().catch(() => undefined);
      })
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : 'No se pudo confirmar el correo');
        setEstado('error');
      });
  }, [token, user, refresh]);

  if (!token) {
    return (
      <Aviso titulo="Enlace incompleto">
        Abre el enlace tal como llegó al correo, sin recortarlo.
      </Aviso>
    );
  }

  if (estado === 'error') {
    return <Aviso titulo="No se pudo confirmar">{error}</Aviso>;
  }

  return (
    <AuthShell
      titulo="Confirmar correo"
      descripcion={estado === 'cargando' ? 'Un momento…' : 'Correo confirmado'}
    >
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        {estado === 'cargando' ? (
          <>
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted/10">
              <Loader2 size={24} className="animate-spin text-muted" />
            </div>
            <p className="text-[13px] text-muted">Confirmando tu correo…</p>
          </>
        ) : (
          <>
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success-bg text-success">
              <Check size={26} />
            </div>
            <h2 className="text-[17px] font-bold tracking-[-0.01em]">Correo confirmado</h2>
            <p className="text-[13px] leading-relaxed text-muted">
              Si algún día olvidas la contraseña, podrás recuperarla tú mismo.
            </p>
            <Link to="/" className="w-full">
              <Button className="mt-1 w-full" size="lg">
                Ir al punto de venta
              </Button>
            </Link>
          </>
        )}
      </div>
    </AuthShell>
  );
}
