import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { usePlatformAuth } from '@/features/platform/PlatformAuthProvider';
import { platformApi } from '@/lib/api';

/**
 * La cuenta del propio operador: nombre, correo (que ES el usuario con el que entra) y
 * contraseña.
 *
 * El cambio de contraseña pide la actual aunque la sesión ya esté abierta. No es un
 * trámite: es lo único que separa "me dejé el panel abierto" de "me quitaron la cuenta".
 */
export function MiCuentaModal({ onClose }: { onClose: () => void }) {
  const { admin, logout, refrescar } = usePlatformAuth();
  const [nombre, setNombre] = useState(admin?.name ?? '');
  const [correo, setCorreo] = useState(admin?.email ?? '');
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  /**
   * Se está saliendo por haber cambiado el correo.
   *
   * Mientras dure, el modal no se puede cerrar. El correo viaja dentro del token, así que
   * al cambiarlo el que hay en la mano queda viejo y la salida es obligatoria: cancelar el
   * temporizador dejaría al operador con un token muerto y un 401 sin explicación en la
   * siguiente petición. Lo que sí se arregla es lo otro — que cerrando el modal en ese
   * segundo y medio te echaba sin que hubieras llegado a leer por qué.
   */
  const [saliendo, setSaliendo] = useState(false);

  const guardarPerfil = useMutation({
    mutationFn: (body: { name?: string; email?: string }) =>
      platformApi.patch<{ reloguear: boolean }>('/platform/me', body),
    onSuccess: (res) => {
      setError(null);
      refrescar();
      // El correo viaja dentro del token: si cambió, el que hay en la mano quedó viejo
      // y la próxima petición sería un 401 sin explicación. Mejor salir a propósito.
      if (res.reloguear) {
        setAviso('Correo cambiado. Vuelve a entrar con el nuevo.');
        setSaliendo(true);
        setTimeout(logout, 1500);
      } else {
        setAviso('Guardado.');
      }
    },
    onError: (e: Error) => {
      setAviso(null);
      setError(e.message);
    },
  });

  const cambiarPassword = useMutation({
    mutationFn: () => platformApi.patch('/platform/me/password', { actual, nueva }),
    onSuccess: () => {
      setError(null);
      setActual('');
      setNueva('');
      setAviso('Contraseña cambiada.');
    },
    onError: (e: Error) => {
      setAviso(null);
      setError(e.message);
    },
  });

  return (
    <Modal open onClose={saliendo ? () => undefined : onClose} title="Mi cuenta">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor="mi-cuenta-nombre" className="mb-1 block text-[13px] font-semibold">
              Nombre
            </label>
            <Input
              id="mi-cuenta-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="mi-cuenta-correo" className="mb-1 block text-[13px] font-semibold">
              Correo
            </label>
            <Input
              id="mi-cuenta-correo"
              type="email"
              autoCapitalize="none"
              autoCorrect="off"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
            />
            <p className="mt-1 text-[12px] text-muted">
              Es el usuario con el que entras al panel. Si lo cambias, tendrás que volver a entrar.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={guardarPerfil.isPending}
            onClick={() => {
              const body: { name?: string; email?: string } = {};
              if (nombre !== admin?.name) body.name = nombre;
              if (correo !== admin?.email) body.email = correo;
              if (!Object.keys(body).length) return setAviso('No cambiaste nada.');
              guardarPerfil.mutate(body);
            }}
          >
            {guardarPerfil.isPending ? 'Guardando…' : 'Guardar datos'}
          </Button>
        </div>

        <div className="border-t border-border pt-4">
          <div className="mb-2 text-[13px] font-semibold">Cambiar contraseña</div>
          <div className="flex flex-col gap-3">
            <Input
              type="password"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              placeholder="Contraseña actual"
              autoComplete="current-password"
            />
            <Input
              type="password"
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
              placeholder="Contraseña nueva (mínimo 12)"
              autoComplete="new-password"
            />
            <Button
              variant="outline"
              disabled={cambiarPassword.isPending || !actual || nueva.length < 12}
              onClick={() => cambiarPassword.mutate()}
            >
              {cambiarPassword.isPending ? 'Cambiando…' : 'Cambiar contraseña'}
            </Button>
          </div>
        </div>

        {error && <p className="text-[13px] text-danger">{error}</p>}
        {aviso && <p className="text-[13px] text-success">{aviso}</p>}

        <Button onClick={onClose}>Cerrar</Button>
      </div>
    </Modal>
  );
}
