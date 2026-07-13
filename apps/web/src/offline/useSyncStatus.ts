import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from './db';

export function useSyncStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const pending = useLiveQuery(() => db.pendingSales.count(), [], 0);

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

  return { online, pending: pending ?? 0 };
}
