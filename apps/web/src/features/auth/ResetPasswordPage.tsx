import { Check, Eye, EyeOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Aviso } from '@/features/auth/Aviso';
import { api, ApiError } from '@/lib/api';

/** Pantalla a la que lleva el enlace del correo: poner una contraseña nueva. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [repetir, setRepetir] = useState('');
  const [ver, setVer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres');
    if (password !== repetir) return setError('Las contraseñas no coinciden');

    setEnviando(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setListo(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cambiar la contraseña');
    } finally {
      setEnviando(false);
    }
  }

  if (!token) {
    return (
      <Aviso titulo="Enlace incompleto">
        Abre el enlace tal como llegó al correo, sin recortarlo.
      </Aviso>
    );
  }

  if (listo) {
    return (
      <div className="flex min-h-full items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="p-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success-bg text-success">
              <Check size={24} />
            </div>
            <h1 className="text-lg font-bold">Contraseña cambiada</h1>
            <p className="mt-2 text-sm text-muted">Ya puedes entrar con la nueva.</p>
            <Link to="/login">
              <Button className="mt-4 w-full" size="lg">
                Entrar
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <h1 className="text-lg font-bold">Nueva contraseña</h1>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div className="relative">
              <Input
                type={ver ? 'text' : 'password'}
                className="pr-11"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
              />
              <button
                type="button"
                onClick={() => setVer((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted hover:text-fg"
                aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {ver ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <Input
              type={ver ? 'text' : 'password'}
              value={repetir}
              onChange={(e) => setRepetir(e.target.value)}
              placeholder="Repite la contraseña"
            />
            {error && <p className="text-[13px] text-danger">{error}</p>}
            <Button type="submit" size="lg" disabled={enviando}>
              {enviando ? 'Guardando…' : 'Cambiar contraseña'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

