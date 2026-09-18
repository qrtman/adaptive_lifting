import { useEffect, useState } from 'react';
import { apiService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { UI_KEYS, getUiPref } from '../storage/uiPrefs';
import { CenteredDialog } from './CenteredDialog';

export function DayNoteDialog({
  date,
  athleteId,
  initialBody,
  loading,
  isOnline,
  onClose,
  onSaved,
}: {
  date: string;
  athleteId?: string | null;
  initialBody: string;
  loading?: boolean;
  isOnline: boolean;
  onClose: () => void;
  onSaved: (body: string) => void | Promise<void>;
}) {
  const { user } = useAuth();
  const isCoach = String(user?.role || getUiPref(UI_KEYS.role) || '').toUpperCase() === 'COACH';
  const coachUserId = user?.id ? String(user.id) : '';
  const linkedAthleteId = athleteId && athleteId !== coachUserId ? athleteId : null;
  const needsAthlete = isCoach && !linkedAthleteId;
  const [body, setBody] = useState(initialBody);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBody(initialBody);
  }, [initialBody]);

  const persist = async (next: string) => {
    if (busy) return;
    if (needsAthlete) {
      setError('Select an athlete');
      return;
    }
    if (!isOnline) {
      setError('Connect to save notes.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await apiService.upsertDayNote({
        date,
        body: next,
        athleteId: isCoach ? linkedAthleteId : undefined,
      });
      await onSaved(saved.body || '');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save note');
      setBusy(false);
    }
  };

  return (
    <CenteredDialog
      title={`Notes · ${date}`}
      onClose={onClose}
      onSubmit={() => void persist(body)}
      testId="day-note-dialog"
      footer={(
        <>
          {initialBody.trim() ? (
            <button
              type="button"
              data-testid="day-note-clear"
              disabled={busy || needsAthlete || !isOnline}
              onClick={() => void persist('')}
              className="h-10 px-4 mr-auto text-sm text-[var(--cal-muted)] hover:text-[var(--cal-ink)] hover:bg-[var(--cal-surface-soft)] rounded-[var(--cal-radius-md)] disabled:opacity-40"
            >
              Clear
            </button>
          ) : null}
          <button
            type="button"
            data-testid="day-note-cancel"
            onClick={onClose}
            className="h-10 px-4 text-sm text-[var(--cal-ink)] hover:bg-[var(--cal-surface-soft)] rounded-[var(--cal-radius-md)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            data-testid="day-note-save"
            disabled={busy || needsAthlete || loading || !isOnline}
            className="h-10 px-4 text-sm font-medium text-[var(--cal-on-primary)] bg-[var(--cal-primary)] rounded-[var(--cal-radius-md)] hover:bg-[var(--cal-primary-active)] disabled:opacity-40 disabled:hover:bg-[var(--cal-primary)]"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    >
      <div className="flex flex-col gap-2">
        {needsAthlete && (
          <p data-testid="day-note-need-athlete" className="text-xs text-[var(--cal-muted)]">
            Select an athlete in the sidebar, then add a note on that plan.
          </p>
        )}
        {loading && (
          <p data-testid="day-note-loading" className="text-xs text-[var(--cal-muted)]">Loading notes…</p>
        )}
        {!isOnline && (
          <p data-testid="day-note-offline" className="text-xs text-[var(--cal-warning)]">Connect to save notes.</p>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-[var(--cal-muted)]">Note</span>
          <textarea
            data-testid="day-note-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={5}
            maxLength={2000}
            placeholder="Rest, travel, meet week…"
            className="min-h-[96px] px-3 py-2 rounded-[var(--cal-radius-md)] bg-[var(--cal-canvas)] border border-[var(--cal-hairline)] text-sm text-[var(--cal-ink)] placeholder:text-[var(--cal-muted)] resize-y focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]"
          />
        </label>
        {error && <p data-testid="day-note-error" className="text-xs text-[var(--cal-error)]">{error}</p>}
      </div>
    </CenteredDialog>
  );
}
