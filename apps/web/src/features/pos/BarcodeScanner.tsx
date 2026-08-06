import { Html5Qrcode } from 'html5-qrcode';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/modal';

const READER_ID = 'barcode-reader';

/** Escáner de código de barras con la cámara del dispositivo (html5-qrcode). */
export function BarcodeScanner({ onScan, onClose }: { onScan: (code: string) => void; onClose: () => void }) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const scanner = new Html5Qrcode(READER_ID, { verbose: false });
    scannerRef.current = scanner;
    let stopped = false;

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 150 } },
        (decodedText) => {
          if (stopped) return;
          stopped = true;
          onScan(decodedText);
        },
        undefined,
      )
      .catch(() => setError('No se pudo acceder a la cámara. Revisa los permisos.'));

    return () => {
      const s = scannerRef.current;
      if (s && s.isScanning) {
        s.stop()
          .then(() => s.clear())
          .catch(() => {});
      }
    };
  }, [onScan]);

  return (
    <Modal open onClose={onClose} title="Escanear código de barras">
      <div className="flex flex-col gap-2">
        <div id={READER_ID} className="w-full overflow-hidden rounded-theme" />
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : (
          <p className="text-center text-sm text-muted">Apunta la cámara al código de barras del producto.</p>
        )}
      </div>
    </Modal>
  );
}
