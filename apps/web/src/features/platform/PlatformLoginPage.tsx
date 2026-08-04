import { ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePlatformAuth } from '@/features/platform/PlatformAuthProvider';

/**
 * Entrada al panel de plataforma.
 *
 * A propósito NO se parece a la de los negocios ni lleva el tema del cliente: quien
 * llega aquí debe ver que está en otra puerta. El operador se crea por CLI en el
 * servidor (`pnpm --filter @ventafacil/db new-platform-admin`), así que aquí no hay
 * registro ni "¿olvidaste tu contraseña?".
 */
export function PlatformLoginPage() {
  const { login } = usePlatformAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo entrar');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-bg p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-theme border border-border bg-surface p-6"
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-fg text-bg">
            <ShieldCheck size={20} />
          </div>
          <div>
            <div className="text-[15px] font-bold tracking-[-0.02em]">Plataforma</div>
            <div className="text-[13px] text-muted">Administración de VentaFácil</div>
          </div>
        </div>

        <label className="mb-1 block text-[13px] font-semibold" htmlFor="pf-email">
          Correo
        </label>
        <Input
          id="pf-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <label className="mb-1 mt-3 block text-[13px] font-semibold" htmlFor="pf-pass">
          Contraseña
        </label>
        <Input
          id="pf-pass"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}

        <Button type="submit" className="mt-5 w-full" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
    </div>
  );
}
