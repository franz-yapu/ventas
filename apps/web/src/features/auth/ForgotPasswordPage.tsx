import { MailCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { slugDesdeHostname } from '@/features/auth/AuthProvider';
import { api } from '@/lib/api';

/**
 * "Olvidé mi contraseña".
 *
 * Siempre muestra el mismo mensaje, haya cuenta con ese correo o no: si dijera "ese
 * correo no está registrado", cualquiera podría averiguar quién tiene cuenta en el
 * negocio probando direcciones.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    const business =
      slugDesdeHostname(window.location.hostname, import.meta.env.VITE_APP_DOMAIN) ||
      import.meta.env.VITE_BUSINESS_SLUG ||
      undefined;
    try {
      await api.post('/auth/forgot-password', { email: email.trim(), business });
    } catch {
      // Ni siquiera un fallo de red cambia lo que se muestra: la respuesta es la misma
      // pase lo que pase, para no filtrar nada por el camino.
    } finally {
      setEnviado(true);
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <div className="flex min-h-full items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="p-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <MailCheck size={24} />
            </div>
            <h1 className="text-lg font-bold">Revisa tu correo</h1>
            <p className="mt-2 text-sm text-muted">
              Si {email.trim()} tiene una cuenta, te enviamos un enlace para poner una
              contraseña nueva. Vale una hora.
            </p>
            <Link to="/login">
              <Button variant="outline" className="mt-4 w-full">
                Volver a entrar
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
          <h1 className="text-lg font-bold">¿Olvidaste tu contraseña?</h1>
          <p className="mt-1 text-sm text-muted">
            Escribe tu correo y te enviamos un enlace para cambiarla.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <Input
              type="email"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              required
            />
            <Button type="submit" size="lg" disabled={enviando}>
              {enviando ? 'Enviando…' : 'Enviar enlace'}
            </Button>
            <Link to="/login" className="text-center text-[13px] text-muted hover:text-fg">
              Volver a entrar
            </Link>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
