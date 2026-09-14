import { useState } from 'react';
import { apiService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { usePeriodization } from '../contexts/PeriodizationContext';
import { UI_KEYS, getUiPref } from '../storage/uiPrefs';
import { CenteredDialog } from './CenteredDialog';
import { LabelCombo, uniquePlanLabels } from './LabelCombo';
import type { WorkoutData } from '../types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function NewSessionDialog({
  date,
  athleteId,
  allowDateEdit = false,
  onClose,
  onCreated,
}: {
  date: string;
  athleteId?: string | null;
  allowDateEdit?: boolean;
  onClose: () => void;
  onCreated: (workout: WorkoutData & { microcycleId?: string }) => void | Promise<void>;
}) {
  const { user } = useAuth();
  const { microcycles } = usePeriodization();
  const isCoach = String(user?.role || getUiPref(UI_KEYS.role) || '').toUpperCase() === 'COACH';
  const coachUserId = user?.id ? String(user.id) : '';
  const linkedAthleteId = athleteId && athleteId !== coachUserId ? athleteId : null;
  const needsAthlete = isCoach && !linkedAthleteId;
  const blockOptions = uniquePlanLabels(microcycles, 'blockLabel');
  const weekOptions = uniquePlanLabels(microcycles, 'weekLabel');

  const [targetDate, setTargetDate] = useState(date);
  const [title, setTitle] = useState('Session');
  const [blockLabel, setBlockLabel] = useState('');
  const [weekLabel, setWeekLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (busy) return;
    if (needsAthlete) {
      setError('Select an athlete');
      return;
    }
    if (!ISO_DATE.test(targetDate)) {
      setError('Pick a date');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await apiService.createSession({
        date: targetDate,
        title: title.trim() || 'Session',
        blockLabel: blockLabel.trim() || null,
        weekLabel: weekLabel.trim() || null,
        athleteId: isCoach ? linkedAthleteId || undefined : undefined,
      });
      await onCreated(created);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
      setBusy(false);
    }
  };

  return (
    <CenteredDialog
      title={`New session${allowDateEdit ? '' : ` · ${targetDate}`}`}
      onClose={onClose}
      onSubmit={() => void create()}
      testId="new-session-dialog"
      footer={(
        <>
          <button
            type="button"
            data-testid="new-session-cancel"
            onClick={onClose}
            className="h-8 px-3 text-caption text-fg-muted hover:text-fg-strong"
          >
            Cancel
          </button>
          <button
            type="submit"
            data-testid="new-session-create"
            disabled={busy || needsAthlete || !ISO_DATE.test(targetDate)}
            className="h-8 px-3 text-caption text-fg-strong bg-accent rounded disabled:opacity-40"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        {needsAthlete && (
            <p data-testid="new-session-need-athlete" className="text-caption text-fg-muted">
            Select an athlete in the sidebar, then create a session on that plan.
          </p>
        )}
        {allowDateEdit && (
          <label className="flex flex-col gap-1">
            <span className="text-micro uppercase tracking-wider text-fg-subtle">Date</span>
            <input
              type="date"
              data-testid="new-session-date"
              value={targetDate}
              onChange={(event) => setTargetDate(event.target.value)}
              className="h-8 px-2 rounded bg-canvas border border-border text-caption text-fg-strong"
            />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-micro uppercase tracking-wider text-fg-subtle">Name</span>
          <input
            data-testid="new-session-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="h-8 px-2 rounded bg-canvas border border-border text-caption text-fg-strong"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <LabelCombo
            label="Block (optional)"
            value={blockLabel}
            onChange={setBlockLabel}
            options={blockOptions}
            testId="new-session-block"
          />
          <LabelCombo
            label="Week (optional)"
            value={weekLabel}
            onChange={setWeekLabel}
            options={weekOptions}
            testId="new-session-week"
          />
        </div>
        {error && <p className="text-caption text-error">{error}</p>}
      </div>
    </CenteredDialog>
  );
}
