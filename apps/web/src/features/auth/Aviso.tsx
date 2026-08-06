import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AuthShell } from '@/components/AuthShell';
import { Button } from '@/components/ui/button';

/**
 * Tarjeta de "esto no salió" para las pantallas que se abren desde un enlace del
 * correo: enlace incompleto, caducado o ya usado. Siempre deja una salida a mano
 * en vez de dejar a la persona mirando un error.
 */
export function Aviso({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <AuthShell titulo={titulo} descripcion="Algo no salió como esperábamos">
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-warning-bg text-warning">
          <AlertTriangle size={26} />
        </div>
        <h2 className="text-[17px] font-bold tracking-[-0.01em]">{titulo}</h2>
        <p className="text-[13px] leading-relaxed text-muted">{children}</p>
        <div className="mt-1 flex w-full flex-col gap-2">
          <Link to="/login" className="w-full">
            <Button variant="outline" className="w-full">
              Ir a entrar
            </Button>
          </Link>
          {/* Un enlace caducado se arregla pidiendo otro, no volviendo al login a
              probar suerte. Que la salida esté aquí ahorra la llamada de soporte. */}
          <Link to="/olvide-contrasena" className="text-[13px] text-muted hover:text-fg">
            Pedir un enlace nuevo
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
