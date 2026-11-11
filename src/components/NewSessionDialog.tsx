import { useState } from 'react';
import { apiService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { usePeriodization } from '../contexts/PeriodizationContext';
import { formatSessionDate, isPlaceholderTitle, labelNumber } from '../features/plan/sessionLabels';
import {
  UI_KEYS,
  getRecentBlock,
  getRecentDay,
  getRecentWeek,
  getUiPref,
  setRecentBlock,
  setRecentDay,
  setRecentName,
  setRecentWeek,
} from '../storage/uiPrefs';
import { CenteredDialog } from './CenteredDialog';
import { uniquePlanTitles } from './LabelCombo';
import { distinctBlocks, existingBlock } from './BlockPicker';
import { SessionSlotFields } from './SessionSlotFields';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function NewSessionDialog({
  date,
  athleteId,
  initialBlockLabel,
  allowDateEdit = false,
  onClose,
  onCreated,
}: {
  date: string;
  athleteId?: string | null;
  initialBlockLabel?: string;
  allowDateEdit?: boolean;
  onClose: () => void;
  onCreated: (workout: { id: string; microcycleId?: string }) => void | Promise<void>;
}) {
  const { user } = useAuth();
  const { microcycles } = usePeriodization();
  const isCoach = String(user?.role || getUiPref(UI_KEYS.role) || '').toUpperCase() === 'COACH';
  const coachUserId = user?.id ? String(user.id) : '';
  const linkedAthleteId = athleteId && athleteId !== coachUserId ? athleteId : null;
  const needsAthlete = isCoach && !linkedAthleteId;
  const prefAthleteId = isCoach ? linkedAthleteId : (user?.id ? String(user.id) : athleteId);
  const blockOptions = distinctBlocks(microcycles.flatMap((micro) => micro.workouts.map((workout) => workout.blockLabel)));
  const nameOptions = uniquePlanTitles(microcycles);

  const [targetDate, setTargetDate] = useState(date);
  const [day, setDay] = useState<number | null>(() => labelNumber('Day', getRecentDay(prefAthleteId)));
  const [week, setWeek] = useState<number | null>(() => labelNumber('Week', getRecentWeek(prefAthleteId)));
  // Pre-fill only a block that still exists in this plan; forget a stale one so it never returns.
  const [block, setBlock] = useState<string | null>(() => {
    const remembered = getRecentBlock(prefAthleteId);
    const rememberedExists = existingBlock(remembered, blockOptions);
    if (remembered && !rememberedExists) setRecentBlock(prefAthleteId, null);
    if (initialBlockLabel !== undefined) return existingBlock(initialBlockLabel, blockOptions);
    return rememberedExists;
  });
  const [title, setTitle] = useState('');
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
    const name = isPlaceholderTitle(title) ? '' : title.trim();
    setBusy(true);
    setError(null);
    try {
      const dayCanonical = day === null ? null : String(day);
      const weekCanonical = week === null ? null : String(week);
      const created = await apiService.createSession({
        date: targetDate,
        title: name || undefined,
        dayLabel: dayCanonical || undefined,
        blockLabel: block,
        weekLabel: weekCanonical,
        athleteId: isCoach ? linkedAthleteId || undefined : undefined,
      });
      setRecentDay(prefAthleteId, dayCanonical);
      if (name) setRecentName(prefAthleteId, name);
      setRecentBlock(prefAthleteId, block);
      setRecentWeek(prefAthleteId, weekCanonical);
      await onCreated(created);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
      setBusy(false);
    }
  };

  return (
    <CenteredDialog
      title={`New session${allowDateEdit ? '' : ` · ${formatSessionDate(targetDate)}`}`}
      onClose={onClose}
      onSubmit={() => void create()}
      testId="new-session-dialog"
      footer={(
        <>
          <button
            type="button"
            data-testid="new-session-cancel"
            onClick={onClose}
            className="h-10 px-4 text-sm text-[var(--cal-ink)] hover:bg-[var(--cal-surface-soft)] rounded-[var(--cal-radius-md)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            data-testid="new-session-create"
            disabled={busy || needsAthlete || !ISO_DATE.test(targetDate)}
            className="h-10 px-4 text-sm font-medium text-[var(--cal-on-primary)] bg-[var(--cal-primary)] rounded-[var(--cal-radius-md)] hover:bg-[var(--cal-primary-active)] disabled:opacity-40 disabled:hover:bg-[var(--cal-primary)]"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        {needsAthlete && (
          <p data-testid="new-session-need-athlete" className="text-xs text-[var(--cal-muted)]">
            Select an athlete in the sidebar, then create a session on that plan.
          </p>
        )}
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
          testIdPrefix="new-session"
          titleTestId="new-session-title"
          autoFocusFirst
          dateField={allowDateEdit ? {
            id: 'new-session-date',
            node: (
              <input
                id="new-session-date"
                type="date"
                data-testid="new-session-date"
                value={targetDate}
                onChange={(event) => setTargetDate(event.target.value)}
                className="h-10 w-full px-3 rounded-[var(--cal-radius-md)] bg-[var(--cal-canvas)] border border-[var(--cal-hairline)] text-sm text-[var(--cal-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]"
              />
            ),
          } : undefined}
        />
        {error && <p data-testid="new-session-error" className="text-xs text-[var(--cal-error)]">{error}</p>}
      </div>
    </CenteredDialog>
  );
}
