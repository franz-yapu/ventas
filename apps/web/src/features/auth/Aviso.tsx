import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Tarjeta de "esto no salió" para las pantallas que se abren desde un enlace del
 * correo: enlace incompleto, caducado o ya usado. Siempre deja una salida a mano
 * en vez de dejar a la persona mirando un error.
 */
export function Aviso({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6 text-center">
          <h1 className="text-lg font-bold">{titulo}</h1>
          <p className="mt-2 text-sm text-muted">{children}</p>
          <Link to="/login">
            <Button variant="outline" className="mt-4 w-full">
              Ir a entrar
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
