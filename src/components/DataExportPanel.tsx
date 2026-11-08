import { useState } from 'react';
import { Download, RefreshCw, AlertTriangle, WifiOff } from 'lucide-react';
import { apiService } from '../services/api';
import { useSync } from '../contexts/SyncContext';

type ExportFormat = 'csv' | 'json';

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function exportFilename(format: ExportFormat, now: Date = new Date()): string {
  return `adaptive-lifting-export-${now.toISOString().slice(0, 10)}.${format}`;
}

/** Download my data: one-way CSV / JSON export of the signed-in account's training data. */
export const DataExportPanel = () => {
  const { isOnline } = useSync();
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = async (format: ExportFormat) => {
    if (!isOnline || busy) return;
    setBusy(format);
    setError(null);
    try {
      const blob = format === 'csv' ? await apiService.downloadExportCSV() : await apiService.downloadExportJSON();
      saveBlob(blob, exportFilename(format));
    } catch (e: unknown) {
      const message = e instanceof Error && e.message ? e.message : 'Export failed.';
      setError(`${message} Try again.`);
    } finally {
      setBusy(null);
    }
  };

  const buttonClass =
    'h-8 px-3 inline-flex items-center gap-1.5 rounded-[var(--cal-radius-md)] bg-[var(--cal-surface-soft)] border border-[var(--cal-hairline)] hover:bg-[var(--cal-surface-card)] text-xs font-medium text-[var(--cal-ink)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]';

  return (
    <section className="mb-6 cal-nested-card" data-testid="data-export-panel">
      <h2 className="text-sm font-medium text-[var(--cal-ink)]">Download my data</h2>
      <p className="mt-1 text-xs text-[var(--cal-muted)]">
        Export your sessions, lifts, and sets. CSV opens in a spreadsheet; JSON keeps the full structure.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {(['csv', 'json'] as const).map((format) => (
          <button
            key={format}
            type="button"
            data-testid={`export-${format}`}
            onClick={() => download(format)}
            disabled={!isOnline || busy !== null}
            aria-busy={busy === format}
            className={buttonClass}
          >
            {busy === format ? (
              <RefreshCw size={13} className="animate-spin text-[var(--cal-accent)]" />
            ) : (
              <Download size={13} className="text-[var(--cal-muted)]" />
            )}
            {busy === format ? 'Preparing…' : `Download ${format.toUpperCase()}`}
          </button>
        ))}
      </div>

      {!isOnline && (
        <p data-testid="export-offline" className="mt-2 text-xs text-[var(--cal-muted)] flex items-center gap-1.5">
          <WifiOff size={13} className="shrink-0" />
          You are offline. Export needs a connection; reconnect to download your data.
        </p>
      )}

      {error && (
        <p role="alert" data-testid="export-error" className="mt-2 text-xs text-[var(--cal-error)] flex items-center gap-1.5">
          <AlertTriangle size={13} className="shrink-0" />
          {error}
        </p>
      )}
    </section>
  );
};
