import { useState } from 'react';
import { apiService } from '../services/api';
import { usePeriodization } from '../contexts/PeriodizationContext';
import { UNNAMED_SESSION_TITLE, formatSessionDate, isPlaceholderTitle, labelNumber, normalizeDayLabel } from '../features/plan/sessionLabels';
import { setRecentBlock, setRecentDay, setRecentName, setRecentWeek } from '../storage/uiPrefs';
import { CenteredDialog } from './CenteredDialog';
import { uniquePlanTitles } from './LabelCombo';
import { distinctBlocks } from './BlockPicker';
import { SessionSlotFields } from './SessionSlotFields';

export function EditSessionDialog({
  session,
  onClose,
  onSaved,
  onDeleted,
}: {
  session: {
    id: string;
    date: string;
    title: string;
    dayLabel?: string | null;
    blockLabel?: string | null;
    weekLabel?: string | null;
  };
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onDeleted?: () => void | Promise<void>;
}) {
  const { microcycles, planAthleteId } = usePeriodization();
  const blockOptions = distinctBlocks(microcycles.flatMap((micro) => micro.workouts.map((workout) => workout.blockLabel)));
  // Old free-text labels that are not numbers ("Deload") stay unless a number is picked.
  const storedDay = normalizeDayLabel(session.dayLabel);
  const storedWeek = session.weekLabel?.trim() || null;
  const legacyDay = storedDay && labelNumber('Day', storedDay) === null ? storedDay : null;
  const legacyWeek = storedWeek && labelNumber('Week', storedWeek) === null ? storedWeek : null;
  const nameOptions = uniquePlanTitles(microcycles);
  const [day, setDay] = useState<number | null>(() => labelNumber('Day', storedDay));
  const [week, setWeek] = useState<number | null>(() => labelNumber('Week', storedWeek));
  const [block, setBlock] = useState<string | null>(session.blockLabel?.trim() || null);
  const [title, setTitle] = useState(isPlaceholderTitle(session.title) ? '' : session.title.trim());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (busy) return;
    const name = isPlaceholderTitle(title) ? '' : title.trim();
    setBusy(true);
    setError(null);
    try {
      const dayCanonical = day !== null ? String(day) : legacyDay;
      const weekCanonical = week !== null ? String(week) : legacyWeek ?? '';
      await apiService.updateSession(session.id, {
        title: name || UNNAMED_SESSION_TITLE,
        dayLabel: dayCanonical ?? session.date,
        blockLabel: block ?? '',
        weekLabel: weekCanonical,
      });
      setRecentDay(planAthleteId, day === null ? null : String(day));
      if (name) setRecentName(planAthleteId, name);
      setRecentBlock(planAthleteId, block);
      setRecentWeek(planAthleteId, week === null ? null : String(week));
      await onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save session');
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy || !onDeleted) return;
    if (!window.confirm('Delete this session?')) return;
    setBusy(true);
    setError(null);
    try {
      await apiService.deleteSession(session.id);
      await onDeleted();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete session');
      setBusy(false);
    }
  };

  return (
    <CenteredDialog
      title={`Edit session · ${formatSessionDate(session.date)}`}
      onClose={onClose}
      testId="edit-session-dialog"
      footer={(
        <>
          {onDeleted ? (
            <button
              type="button"
              data-testid="edit-session-delete"
              disabled={busy}
              onClick={() => void remove()}
              className="mr-auto h-10 px-4 text-sm text-[var(--cal-error)] hover:bg-[var(--cal-surface-soft)] rounded-[var(--cal-radius-md)] disabled:opacity-40"
            >
              Delete
            </button>
          ) : null}
          <button
            type="button"
            data-testid="edit-session-cancel"
            onClick={onClose}
            className="h-10 px-4 text-sm text-[var(--cal-ink)] hover:bg-[var(--cal-surface-soft)] rounded-[var(--cal-radius-md)]"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="edit-session-save"
            disabled={busy}
            onClick={() => void save()}
            className="h-10 px-4 text-sm font-medium text-[var(--cal-on-primary)] bg-[var(--cal-primary)] rounded-[var(--cal-radius-md)] hover:bg-[var(--cal-primary-active)] disabled:opacity-40 disabled:hover:bg-[var(--cal-primary)]"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        <SessionSlotFields
          day={day}
          week={week}
          block={block}
          blocks={blockOptions}
          title={title}
          nameOptions={nameOptions}
          onDay={setDay}
          onWeek={setWeek}
          onBlock={setBlock}
          onTitle={setTitle}
          testIdPrefix="session"
          titleTestId="session-title"
          legacyDay={legacyDay}
          legacyWeek={legacyWeek}
          autoFocusFirst
        />
        {error && <p data-testid="edit-session-error" className="text-xs text-[var(--cal-error)]">{error}</p>}
      </div>
    </CenteredDialog>
  );
}
