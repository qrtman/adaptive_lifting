import { useMemo, useState } from 'react';
import { apiService } from '../services/api';
import type { WorkoutData } from '../types';
import { CenteredDialog } from './CenteredDialog';

function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function shiftDate(iso: string, days: number): string {
  const next = new Date(`${iso}T00:00:00`);
  next.setDate(next.getDate() + days);
  const y = next.getFullYear();
  const m = String(next.getMonth() + 1).padStart(2, '0');
  const d = String(next.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function CopyToDialog({
  source,
  athleteId,
  onClose,
  onCopied,
}: {
  source: WorkoutData;
  athleteId?: string | null;
  onClose: () => void;
  onCopied: (created: { id: string }) => void | Promise<void>;
}) {
  const [targetDate, setTargetDate] = useState(() => shiftDate(source.date, 7));
  const [includeLogs, setIncludeLogs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offset = useMemo(() => daysBetween(source.date, targetDate), [source.date, targetDate]);

  const copy = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const copied = await apiService.copyWeek({
        sessionIds: [source.id],
        athleteId: athleteId || undefined,
        dateOffsetDays: offset,
        targetBlockLabel: source.blockLabel ?? null,
        targetWeekLabel: source.weekLabel ?? null,
        includeLogs,
      });
      const created = copied.copied[0];
      if (!created) throw new Error('Copy failed');
      await onCopied({ id: created.id });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to copy session');
      setBusy(false);
    }
  };

  return (
    <CenteredDialog
      title={`Copy to · ${source.title}`}
      onClose={onClose}
      testId="copy-to-dialog"
      footer={(
        <>
          <button
            type="button"
            data-testid="copy-to-cancel"
            onClick={onClose}
            className="h-8 px-3 text-xs text-[#AEAEB2] hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="copy-to-confirm"
            disabled={busy || !targetDate}
            onClick={() => void copy()}
            className="h-8 px-3 text-xs text-white bg-[#007AFF] rounded disabled:opacity-40"
          >
            {busy ? 'Copying…' : 'Copy'}
          </button>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-[#AEAEB2]">{source.date} → pick the day this session lands on.</p>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-[#636366]">Copy to date</span>
          <input
            type="date"
            data-testid="copy-to-date"
            value={targetDate}
            onChange={(event) => setTargetDate(event.target.value)}
            className="h-8 px-2 rounded bg-[#0A0A0A] border border-white/10 text-xs text-white"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="copy-to-lifts"
            onClick={() => setIncludeLogs(false)}
            className={`h-8 px-3 text-xs rounded ${!includeLogs ? 'bg-white/15 text-white' : 'text-[#AEAEB2]'}`}
          >
            Lifts only
          </button>
          <button
            type="button"
            data-testid="copy-to-logs"
            onClick={() => setIncludeLogs(true)}
            className={`h-8 px-3 text-xs rounded ${includeLogs ? 'bg-white/15 text-white' : 'text-[#AEAEB2]'}`}
          >
            With logs
          </button>
        </div>
        {error && <p className="text-xs text-[#FF453A]">{error}</p>}
      </div>
    </CenteredDialog>
  );
}
