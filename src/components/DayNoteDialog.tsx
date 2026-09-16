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
              className="h-8 px-3 mr-auto text-xs text-[#AEAEB2] hover:text-white disabled:opacity-40"
            >
              Clear
            </button>
          ) : null}
          <button
            type="button"
            data-testid="day-note-cancel"
            onClick={onClose}
            className="h-8 px-3 text-xs text-[#AEAEB2] hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            data-testid="day-note-save"
            disabled={busy || needsAthlete || loading || !isOnline}
            className="h-8 px-3 text-xs text-white bg-[#007AFF] rounded disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    >
      <div className="flex flex-col gap-2">
        {needsAthlete && (
          <p data-testid="day-note-need-athlete" className="text-xs text-[#AEAEB2]">
            Select an athlete in the sidebar, then add a note on that plan.
          </p>
        )}
        {loading && (
          <p data-testid="day-note-loading" className="text-xs text-[#AEAEB2]">Loading notes…</p>
        )}
        {!isOnline && (
          <p data-testid="day-note-offline" className="text-xs text-[#F5A623]">Connect to save notes.</p>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-[#636366]">Note</span>
          <textarea
            data-testid="day-note-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={5}
            maxLength={2000}
            placeholder="Rest, travel, meet week…"
            className="min-h-[96px] px-2 py-1.5 rounded bg-[#0A0A0A] border border-white/10 text-xs text-white resize-y"
          />
        </label>
        {error && <p data-testid="day-note-error" className="text-xs text-[#FF453A]">{error}</p>}
      </div>
    </CenteredDialog>
  );
}
