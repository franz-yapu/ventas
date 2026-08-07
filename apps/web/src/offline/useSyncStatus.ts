import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from './db';
import { sesionActual, ventasDeOtraSesion } from './sync';

export function useSyncStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const pending = useLiveQuery(() => db.pendingSales.count(), [], 0);
  // Ventas que agotaron los reintentos: ya no se suben solas, necesitan atención.
  const failed = useLiveQuery(
    () => db.pendingSales.where('status').equals('failed').count(),
    [],
    0,
  );
  /*
    Ventas que dejó otra persona sin subir en este dispositivo.

    Ni se suben (quedarían a nombre de quien esté ahora) ni se borran (son ventas ya
    cobradas). Lo único correcto es decirlo: alguien tiene que entrar con su cuenta.
  */
  const ajenas = useLiveQuery(
    async () => {
      const s = sesionActual();
      return s ? (await ventasDeOtraSesion(s)).length : 0;
    },
    [],
    0,
  );

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  return { online, pending: pending ?? 0, failed: failed ?? 0, ajenas: ajenas ?? 0 };
}
