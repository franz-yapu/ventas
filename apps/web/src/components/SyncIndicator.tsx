import { Check, CloudOff, RefreshCw } from 'lucide-react';
import { syncPending } from '@/offline/sync';
import { useSyncStatus } from '@/offline/useSyncStatus';
import { cn } from '@/lib/utils';

/** Badge siempre visible: el vendedor sabe si sus ventas están a salvo. */
export function SyncIndicator() {
  const { online, pending, ajenas } = useSyncStatus();

  let label: string;
  let tone: string;
  let Icon = Check;
  if (ajenas > 0) {
    /*
      Va primero, por delante incluso de "sin conexión": son ventas cobradas que este
      dispositivo NO puede subir por su cuenta, y sólo se arreglan si alguien entra con
      la cuenta que las cobró. Callarlo las deja ahí para siempre.
    */
    label = `${ajenas} venta${ajenas > 1 ? 's' : ''} de otra sesión sin subir`;
    tone = 'bg-warning-bg text-warning';
    Icon = CloudOff;
  } else if (!online) {
    label = pending > 0 ? `Sin conexión · ${pending} por subir` : 'Sin conexión';
    tone = 'bg-warning-bg text-warning';
    Icon = CloudOff;
  } else if (pending > 0) {
    label = `${pending} venta${pending > 1 ? 's' : ''} pendiente${pending > 1 ? 's' : ''}`;
    tone = 'bg-info-bg text-info';
    Icon = RefreshCw;
  } else {
    label = 'Sincronizado';
    tone = 'bg-success-bg text-success';
    Icon = Check;
  }

  return (
    <button
      onClick={() => void syncPending()}
      title="Sincronizar ahora"
      className={cn('flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium', tone)}
    >
      <Icon size={14} className={online && pending > 0 && ajenas === 0 ? 'animate-spin' : ''} />
      <span className="hidden sm:inline">{label}</span>
      {!online || pending > 0 ? <span className="sm:hidden">{pending || '⚠'}</span> : null}
    </button>
  );
}
