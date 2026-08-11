import { AlertTriangle, Ban, Check, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ApiError } from '@/lib/api';
import type { RespuestaBorrado } from '@/lib/types';

/**
 * Eliminar una sucursal o un usuario, con los TRES desenlaces que tiene de verdad.
 *
 * El API lleva tiempo implementando una política que la interfaz no contaba: **borrar o
 * desactivar**. Si no cuelga nada se borra físicamente —un error de tecleo al dar de alta
 * no tiene por qué quedarse para siempre—; si cuelga historial se desactiva y se explica
 * QUÉ colgaba y CUÁNTO. Y hay cuatro casos en los que directamente no se puede.
 *
 * Este componente existe porque esos tres desenlaces **no se distinguen solos**:
 *
 * 1. **Eliminado** — 200 con `eliminado: true`.
 * 2. **Desactivado en su lugar** — 200 con `eliminado: false`. Es el que se pierde si uno
 *    trata la respuesta como un simple "ok": el usuario pulsa Eliminar, no ve nada raro,
 *    y se queda creyendo que borró algo que sigue ahí desactivado.
 * 3. **Bloqueado** — 409, o sea `ApiError`.
 *
 * ## Por qué el mensaje del servidor se enseña TAL CUAL
 *
 * El API contesta cosas como _«No se eliminó porque la sucursal tiene 340 ventas y 12
 * turnos de caja. Se desactivó en su lugar»_. Ese detalle es justamente lo que evita que
 * alguien se ponga a borrar ventas para "destrabar" el borrado de la sucursal. Un
 * "no se pudo eliminar" genérico invita a pelearse con el sistema; decir qué cuelga
 * cierra la discusión.
 *
 * Lo mismo con los cuatro 409, que tienen mensaje propio y merecen leerse: es la
 * principal, es la única activa, es el último administrador, es tu propia cuenta. Los
 * cuatro dicen además qué hacer antes.
 */

interface Props {
  /** Qué se está eliminando, en palabras: `la sucursal «Norte»`, `a Marta Quispe`. */
  que: string;
  /** Lo que se pierde si sale bien. Sale en la pregunta, antes de confirmar. */
  advertencia?: string;
  /** Llama al API. Cada pantalla normaliza `eliminada`/`eliminado` a `RespuestaBorrado`. */
  onEliminar: () => Promise<RespuestaBorrado>;
  /** Se llama al cerrar cuando algo cambió, para refrescar la lista. */
  onCambio: () => void;
  onCerrar: () => void;
}

type Estado =
  | { paso: 'confirmar' }
  | { paso: 'enviando' }
  | { paso: 'hecho'; res: RespuestaBorrado }
  | { paso: 'bloqueado'; mensaje: string };

export function EliminarModal({ que, advertencia, onEliminar, onCambio, onCerrar }: Props) {
  const [estado, setEstado] = useState<Estado>({ paso: 'confirmar' });

  /*
    `cambio` recuerda si hubo que refrescar la lista, y se avisa AL CERRAR y no al recibir
    la respuesta. Si se invalidara la consulta en el acto, la fila de debajo se redibuja
    mientras el modal enseña el resultado — y en el caso de "desactivado" el resultado es
    justo lo que hay que leer antes de que la pantalla se mueva.
  */
  const [cambio, setCambio] = useState(false);

  function cerrar() {
    if (cambio) onCambio();
    onCerrar();
  }

  async function eliminar() {
    setEstado({ paso: 'enviando' });
    try {
      const res = await onEliminar();
      setCambio(true);
      setEstado({ paso: 'hecho', res });
    } catch (e) {
      // Un 409 no es un fallo: es la política diciendo que no, y con un motivo concreto.
      // Cualquier otra cosa (red, 500) se enseña igual, pero sin prometer un porqué.
      setEstado({
        paso: 'bloqueado',
        mensaje: e instanceof ApiError ? e.message : 'No se pudo eliminar. Inténtalo de nuevo.',
      });
    }
  }

  const titulo =
    estado.paso === 'hecho'
      ? estado.res.eliminado
        ? 'Eliminado'
        : 'Se desactivó en su lugar'
      : estado.paso === 'bloqueado'
        ? 'No se puede eliminar'
        : `¿Eliminar ${que}?`;

  return (
    <Modal open onClose={cerrar} title={titulo}>
      <div className="flex flex-col gap-4">
        {(estado.paso === 'confirmar' || estado.paso === 'enviando') && (
          <>
            <div className="flex gap-3 rounded-theme bg-danger-bg p-3">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />
              <p className="text-[13px] leading-[1.5] text-danger">
                {advertencia ??
                  'Si no tiene historial, se elimina y no se puede deshacer. Si lo tiene, se desactivará en su lugar y te lo diremos.'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={cerrar}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                disabled={estado.paso === 'enviando'}
                onClick={() => void eliminar()}
              >
                <Trash2 size={16} />
                {estado.paso === 'enviando' ? 'Eliminando…' : 'Eliminar'}
              </Button>
            </div>
          </>
        )}

        {estado.paso === 'hecho' && (
          <>
            {/* `bg-success-bg` / `bg-warning-bg`, no `bg-success/10`: estos colores son
                `var()`, y Tailwind descarta la utilidad con opacidad EN SILENCIO — queda
                un recuadro sin fondo y nadie se entera. Además los tokens `-bg` tienen su
                propia versión en modo oscuro. */}
            <div
              className={
                estado.res.eliminado
                  ? 'flex gap-3 rounded-theme bg-success-bg p-3'
                  : 'flex gap-3 rounded-theme bg-warning-bg p-3'
              }
            >
              {estado.res.eliminado ? (
                <Check size={18} className="mt-0.5 shrink-0 text-success" />
              ) : (
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
              )}
              <p className="text-[13px] leading-[1.5]">{estado.res.mensaje}</p>
            </div>

            {/* La lista repetida en vertical: en el mensaje va en prosa y con tres o
                cuatro cosas se lee mal justo cuando más importa entenderla. */}
            {!estado.res.eliminado && !!estado.res.colgando?.length && (
              <ul className="flex flex-col gap-1 pl-1">
                {estado.res.colgando.map((c) => (
                  <li key={c} className="text-[13px] text-muted">
                    · {c}
                  </li>
                ))}
              </ul>
            )}

            <Button onClick={cerrar}>Entendido</Button>
          </>
        )}

        {estado.paso === 'bloqueado' && (
          <>
            <div className="flex gap-3 rounded-theme bg-danger-bg p-3">
              <Ban size={18} className="mt-0.5 shrink-0 text-danger" />
              <p className="text-[13px] leading-[1.5] text-danger">{estado.mensaje}</p>
            </div>
            <Button variant="outline" onClick={cerrar}>
              Cerrar
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
