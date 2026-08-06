import { ArrowLeft, MailCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AuthShell } from '@/components/AuthShell';
import { Button } from '@/components/ui/button';
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

  const volver = (
    <Link
      to="/login"
      className="inline-flex items-center gap-1.5 font-semibold text-fg hover:underline"
    >
      <ArrowLeft size={14} /> Volver a entrar
    </Link>
  );

  if (enviado) {
    return (
      <AuthShell titulo="Revisa tu correo" descripcion="Te enviamos un enlace" pie={volver}>
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success-bg text-success">
            <MailCheck size={26} />
          </div>
          <h2 className="text-[17px] font-bold tracking-[-0.01em]">Revisa tu correo</h2>
          <p className="text-[13px] leading-relaxed text-muted">
            Si <span className="font-semibold text-fg">{email.trim()}</span> tiene una cuenta, te
            enviamos un enlace para poner una contraseña nueva.
          </p>
          <p className="rounded-theme bg-muted/10 px-3 py-1.5 text-[12px] text-muted">
            El enlace vale una hora
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      titulo="Recuperar contraseña"
      descripcion="Recupera el acceso a tu cuenta"
      pie={volver}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="correo" className="mb-1.5 block text-[13px] font-semibold">
            Tu correo
          </label>
          <Input
            id="correo"
            type="email"
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@correo.com"
            required
          />
          <p className="mt-1.5 text-[12px] text-muted">
            Te enviamos un enlace para cambiarla. Si no tienes correo registrado, pídele a un
            administrador de tu negocio que te dé una contraseña nueva.
          </p>
        </div>
        <Button type="submit" size="lg" disabled={enviando}>
          {enviando ? 'Enviando…' : 'Enviar enlace'}
        </Button>
      </form>
    </AuthShell>
  );
}
