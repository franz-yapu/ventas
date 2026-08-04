import { MailWarning } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthProvider';
import { api } from '@/lib/api';

/**
 * Aviso mientras el correo del usuario no esté confirmado.
 *
 * Verificar NO bloquea el uso del sistema: el negocio vende desde el primer minuto.
 * Pero sin correo confirmado no hay forma de recuperar la contraseña, y ése es el
 * motivo real por el que conviene hacerlo — así que es lo que dice el aviso, en vez
 * de un "confirma tu correo" sin explicación.
 *
 * Sólo lo ve el admin: a un vendedor cuya cuenta gestiona su jefe no le aporta nada.
 */
export function EmailVerifyBanner() {
  const { user } = useAuth();
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  // `emailVerified` llega de /auth/me; mientras carga es undefined y no se enseña nada
  // para no dar un aviso que quizá desaparezca medio segundo después.
  if (!user || user.role !== 'admin' || user.emailVerified !== false) return null;

  async function reenviar() {
    setEnviando(true);
    try {
      await api.post('/auth/resend-verification');
      setEnviado(true);
    } catch {
      setEnviado(true); // No merece un error a la vista: se puede reintentar.
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="no-print flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-warning-bg px-4 py-2 text-[13px] text-warning">
      <MailWarning size={15} className="shrink-0" />
      {user.email ? (
        <>
          <span>
            Confirma <strong>{user.email}</strong> para poder recuperar tu contraseña si la
            olvidas.
          </span>
          {enviado ? (
            <span className="font-semibold">Te enviamos el enlace.</span>
          ) : (
            <button
              onClick={reenviar}
              disabled={enviando}
              className="font-bold underline underline-offset-2 disabled:opacity-60"
            >
              {enviando ? 'Enviando…' : 'Reenviar correo'}
            </button>
          )}
        </>
      ) : (
        <>
          <span>No tienes un correo registrado: no podrías recuperar tu contraseña.</span>
          <Link to="/perfil" className="font-bold underline underline-offset-2">
            Añadir correo
          </Link>
        </>
      )}
    </div>
  );
}
