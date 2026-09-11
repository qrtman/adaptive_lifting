import { useMemo, useState } from 'react';
import { apiService } from '../services/api';
import type { WorkoutData } from '../types';
import { CenteredDialog } from './CenteredDialog';

function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

export function NewSessionDialog({
  date,
  sessions,
  athleteId,
  allowDateEdit = false,
  onClose,
  onCreated,
}: {
  date: string;
  sessions: Array<{ workout: WorkoutData; microId: string }>;
  athleteId?: string | null;
  allowDateEdit?: boolean;
  onClose: () => void;
  onCreated: (workout: { id: string; microcycleId?: string }) => void | Promise<void>;
}) {
  const [targetDate, setTargetDate] = useState(date);
  const [title, setTitle] = useState('Session');
  const [blockLabel, setBlockLabel] = useState('');
  const [weekLabel, setWeekLabel] = useState('');
  const [mode, setMode] = useState<'blank' | 'copy'>('blank');
  const [sourceId, setSourceId] = useState(sessions[0]?.workout.id ?? '');
  const [includeLogs, setIncludeLogs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sources = useMemo(
    () => [...sessions].sort((a, b) => a.workout.date.localeCompare(b.workout.date)),
    [sessions]
  );

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const name = title.trim() || 'Session';
    const block = blockLabel.trim() || null;
    const week = weekLabel.trim() || null;
    try {
      if (mode === 'copy') {
        const source = sources.find((item) => item.workout.id === sourceId);
        if (!source) {
          setError('Pick a session to copy.');
          setBusy(false);
          return;
        }
        const offset = daysBetween(source.workout.date, targetDate);
        const copied = await apiService.copyWeek({
          sessionIds: [source.workout.id],
          athleteId: athleteId || undefined,
          dateOffsetDays: offset,
          targetBlockLabel: block ?? source.workout.blockLabel ?? null,
          targetWeekLabel: week ?? source.workout.weekLabel ?? null,
          includeLogs,
        });
        const created = copied.copied[0];
        if (!created) throw new Error('Copy failed');
        if (name !== source.workout.title) {
          await apiService.updateSession(created.id, { title: name });
        }
        await onCreated({ id: created.id, microcycleId: source.microId });
      } else {
        const created = await apiService.createSession({
          date: targetDate,
          title: name,
          blockLabel: block,
          weekLabel: week,
          athleteId: athleteId || undefined,
        });
        await onCreated(created);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
      setBusy(false);
    }
  };

  return (
    <CenteredDialog
      title={`New session${allowDateEdit ? '' : ` · ${targetDate}`}`}
      onClose={onClose}
      testId="new-session-dialog"
      footer={(
        <>
          <button
            type="button"
            data-testid="new-session-cancel"
            onClick={onClose}
            className="h-8 px-3 text-xs text-[#AEAEB2] hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="new-session-create"
            disabled={busy || (mode === 'copy' && sources.length === 0)}
            onClick={() => void create()}
            className="h-8 px-3 text-xs text-white bg-[#007AFF] rounded disabled:opacity-40"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        {allowDateEdit && (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-[#636366]">Date</span>
            <input
              type="date"
              data-testid="new-session-date"
              value={targetDate}
              onChange={(event) => setTargetDate(event.target.value)}
              className="h-8 px-2 rounded bg-[#0A0A0A] border border-white/10 text-xs text-white"
            />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-[#636366]">Name</span>
          <input
            data-testid="new-session-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="h-8 px-2 rounded bg-[#0A0A0A] border border-white/10 text-xs text-white"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-[#636366]">Block (optional)</span>
            <input
              data-testid="new-session-block"
              value={blockLabel}
              onChange={(event) => setBlockLabel(event.target.value)}
              className="h-8 px-2 rounded bg-[#0A0A0A] border border-white/10 text-xs text-white"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-[#636366]">Week (optional)</span>
            <input
              data-testid="new-session-week"
              value={weekLabel}
              onChange={(event) => setWeekLabel(event.target.value)}
              className="h-8 px-2 rounded bg-[#0A0A0A] border border-white/10 text-xs text-white"
            />
          </label>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="new-session-mode-blank"
            onClick={() => setMode('blank')}
            className={`h-8 px-3 text-xs rounded ${mode === 'blank' ? 'bg-white/15 text-white' : 'text-[#AEAEB2]'}`}
          >
            Blank
          </button>
          <button
            type="button"
            data-testid="new-session-mode-copy"
            onClick={() => setMode('copy')}
            className={`h-8 px-3 text-xs rounded ${mode === 'copy' ? 'bg-white/15 text-white' : 'text-[#AEAEB2]'}`}
          >
            Copy from another day
          </button>
        </div>
        {mode === 'copy' && (
          <div className="flex flex-col gap-2">
            {sources.length === 0 ? (
              <p className="text-xs text-[#AEAEB2]">No other sessions to copy yet.</p>
            ) : (
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-[#636366]">Copy from</span>
                <select
                  data-testid="new-session-source"
                  value={sourceId}
                  onChange={(event) => setSourceId(event.target.value)}
                  className="h-8 px-2 rounded bg-[#0A0A0A] border border-white/10 text-xs text-white"
                >
                  {sources.map(({ workout }) => (
                    <option key={workout.id} value={workout.id}>
                      {workout.date} · {workout.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="new-session-copy-lifts"
                onClick={() => setIncludeLogs(false)}
                className={`h-8 px-3 text-xs rounded ${!includeLogs ? 'bg-white/15 text-white' : 'text-[#AEAEB2]'}`}
              >
                Lifts only
              </button>
              <button
                type="button"
                data-testid="new-session-copy-logs"
                onClick={() => setIncludeLogs(true)}
                className={`h-8 px-3 text-xs rounded ${includeLogs ? 'bg-white/15 text-white' : 'text-[#AEAEB2]'}`}
              >
                With logs
              </button>
            </div>
          </div>
        )}
        {error && <p className="text-xs text-[#FF453A]">{error}</p>}
      </div>
    </CenteredDialog>
  );
}
