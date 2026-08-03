import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from './db';

export function useSyncStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const pending = useLiveQuery(() => db.pendingSales.count(), [], 0);
  // Ventas que agotaron los reintentos: ya no se suben solas, necesitan atención.
  const failed = useLiveQuery(() => db.pendingSales.where('status').equals('failed').count(), [], 0);

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

  return { online, pending: pending ?? 0, failed: failed ?? 0 };
}
