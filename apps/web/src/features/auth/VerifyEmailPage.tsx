import { Check, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6 text-center">
          {estado === 'cargando' ? (
            <>
              <Loader2 size={24} className="mx-auto animate-spin text-muted" />
              <p className="mt-3 text-sm text-muted">Confirmando tu correo…</p>
            </>
          ) : (
            <>
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success-bg text-success">
                <Check size={24} />
              </div>
              <h1 className="text-lg font-bold">Correo confirmado</h1>
              <p className="mt-2 text-sm text-muted">
                Si algún día olvidas la contraseña, podrás recuperarla tú mismo.
              </p>
              <Link to="/">
                <Button className="mt-4 w-full" size="lg">
                  Ir al punto de venta
                </Button>
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
