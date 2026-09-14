import { useEffect, useRef, useState } from 'react';
import { apiService } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { usePeriodization } from '../../contexts/PeriodizationContext';
import { UI_KEYS, getUiPref } from '../../storage/uiPrefs';
import { ComboBox } from '../ui/ComboBox';
import { uniquePlanLabels, uniquePlanTitles } from '../../components/LabelCombo';
import type { WorkoutData } from '../../types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function SessionCreateForm({
  date,
  athleteId,
  allowDateEdit = false,
  focusNotes = false,
  online = true,
  onClose,
  onCreated,
}: {
  date: string;
  athleteId?: string | null;
  allowDateEdit?: boolean;
  focusNotes?: boolean;
  online?: boolean;
  onClose: () => void;
  onCreated: (workout: WorkoutData & { microcycleId?: string }) => void | Promise<void>;
}) {
  const { user } = useAuth();
  const { microcycles } = usePeriodization();
  const isCoach = String(user?.role || getUiPref(UI_KEYS.role) || '').toUpperCase() === 'COACH';
  const coachUserId = user?.id ? String(user.id) : '';
  const linkedAthleteId = athleteId && athleteId !== coachUserId ? athleteId : null;
  const needsAthlete = isCoach && !linkedAthleteId;
  const nameOptions = uniquePlanTitles(microcycles);
  const blockOptions = uniquePlanLabels(microcycles, 'blockLabel');
  const weekOptions = uniquePlanLabels(microcycles, 'weekLabel');
  const notesRef = useRef<HTMLTextAreaElement>(null);

  const [targetDate, setTargetDate] = useState(date);
  const [title, setTitle] = useState('');
  const [blockLabel, setBlockLabel] = useState('');
  const [weekLabel, setWeekLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!focusNotes) return;
    notesRef.current?.focus();
  }, [focusNotes]);

  const canSubmit = Boolean(title.trim()) && ISO_DATE.test(targetDate) && !needsAthlete && online && !busy;

  const create = async () => {
    if (!canSubmit) {
      if (!online) setError('Connect to create a session.');
      else if (!title.trim()) setError('Name is required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await apiService.createSession({
        date: targetDate,
        title: title.trim(),
        blockLabel: blockLabel.trim() || null,
        weekLabel: weekLabel.trim() || null,
        athleteId: isCoach ? linkedAthleteId || undefined : undefined,
      });
      if (notes.trim()) {
        await apiService.updateSession(created.id, { notes: notes.trim() });
        created.notes = notes.trim();
      }
      await onCreated(created);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <div className="flex flex-col gap-3">
        {needsAthlete ? (
          <p data-testid="new-session-need-athlete" className="text-caption text-fg-muted">
            Select an athlete in the sidebar, then create a session on that plan.
          </p>
        ) : null}
        {allowDateEdit ? (
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
        ) : null}
        <ComboBox
          label="Name"
          value={title}
          onChange={setTitle}
          options={nameOptions}
          testId="new-session-title"
          allowCreate
          required
          autoFocus={!focusNotes}
          placeholder="Session name"
        />
        <div className="grid grid-cols-2 gap-2">
          <ComboBox
            label="Block (optional)"
            value={blockLabel}
            onChange={setBlockLabel}
            options={blockOptions}
            testId="new-session-block"
            allowEmpty
            allowCreate
            emptyLabel="None"
          />
          <ComboBox
            label="Week (optional)"
            value={weekLabel}
            onChange={setWeekLabel}
            options={weekOptions}
            testId="new-session-week"
            allowEmpty
            allowCreate
            emptyLabel="None"
          />
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-micro uppercase tracking-wider text-fg-subtle">Notes (optional)</span>
          <textarea
            ref={notesRef}
            data-testid="new-session-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="min-h-20 bg-canvas border border-border rounded p-2 text-caption text-fg-strong resize-y"
          />
        </label>
        {error ? <p className="text-caption text-error">{error}</p> : null}
        {!online ? <p className="text-caption text-warn">Connect to create a session.</p> : null}
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
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
          disabled={!canSubmit}
          className="h-8 px-3 text-caption text-fg-strong bg-accent rounded disabled:opacity-40"
        >
          {busy ? 'Creating…' : 'Create'}
        </button>
      </div>
    </form>
  );
}
