/** Imprime sólo el recibo térmico (activa el modo aislado por CSS). */
export function printReceipt() {
  document.body.classList.add('print-receipt');
  const cleanup = () => {
    document.body.classList.remove('print-receipt');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  // Respaldo por si afterprint no dispara.
  setTimeout(cleanup, 1000);
}

/** Imprime la página actual como PDF (para reportes/dashboard). El nav va marcado no-print. */
export function printPage() {
  window.print();
}

/** Descarga datos como CSV (Excel lo abre nativamente). */
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
  // BOM para que Excel respete acentos.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
