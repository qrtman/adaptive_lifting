import { useState } from 'react';
import { apiService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { usePeriodization } from '../contexts/PeriodizationContext';
import { displayDayField, normalizeDayLabel } from '../features/plan/sessionLabels';
import {
  UI_KEYS,
  getRecentBlock,
  getRecentDay,
  getRecentName,
  getRecentWeek,
  getUiPref,
  setRecentBlock,
  setRecentDay,
  setRecentName,
  setRecentWeek,
} from '../storage/uiPrefs';
import { CenteredDialog, NestedCard } from './CenteredDialog';
import { ComboBox } from './ComboBox';
import { dayComboOptions, uniquePlanLabels, uniquePlanTitles } from './LabelCombo';

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
  const blockOptions = uniquePlanLabels(microcycles, 'blockLabel');
  const weekOptions = uniquePlanLabels(microcycles, 'weekLabel');
  const dayOptions = dayComboOptions(microcycles);
  const nameOptions = uniquePlanTitles(microcycles);

  const [targetDate, setTargetDate] = useState(date);
  const [dayInput, setDayInput] = useState(() => displayDayField(getRecentDay(prefAthleteId)));
  const [title, setTitle] = useState(() => getRecentName(prefAthleteId));
  const [blockLabel, setBlockLabel] = useState(() => initialBlockLabel ?? getRecentBlock(prefAthleteId));
  const [weekLabel, setWeekLabel] = useState(() => getRecentWeek(prefAthleteId));
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
    const name = title.trim();
    if (!name) {
      setError('Enter a name');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const dayCanonical = normalizeDayLabel(dayInput);
      const created = await apiService.createSession({
        date: targetDate,
        title: name,
        dayLabel: dayCanonical || undefined,
        blockLabel: blockLabel.trim() || null,
        weekLabel: weekLabel.trim() || null,
        athleteId: isCoach ? linkedAthleteId || undefined : undefined,
      });
      if (dayCanonical) setRecentDay(prefAthleteId, dayCanonical);
      setRecentName(prefAthleteId, name);
      if (blockLabel.trim()) setRecentBlock(prefAthleteId, blockLabel.trim());
      if (weekLabel.trim()) setRecentWeek(prefAthleteId, weekLabel.trim());
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
      <div className="flex flex-col gap-2">
        {needsAthlete && (
          <p data-testid="new-session-need-athlete" className="text-xs text-[var(--cal-muted)]">
            Select an athlete in the sidebar, then create a session on that plan.
          </p>
        )}
        <NestedCard testId="new-session-name-card" className="relative z-20 overflow-visible focus-within:!transform-none">
          <ComboBox
            label="Name"
            value={title}
            onChange={setTitle}
            options={nameOptions}
            placeholder="Squat, Meet…"
            testId="new-session-title"
          />
        </NestedCard>
        {allowDateEdit && (
          <NestedCard testId="new-session-date-card">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-[var(--cal-muted)]">Date</span>
              <input
                type="date"
                data-testid="new-session-date"
                value={targetDate}
                onChange={(event) => setTargetDate(event.target.value)}
                className="h-10 px-3 rounded-[var(--cal-radius-md)] bg-[var(--cal-canvas)] border border-[var(--cal-hairline)] text-sm text-[var(--cal-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]"
              />
            </label>
          </NestedCard>
        )}
        <NestedCard testId="new-session-slot-card" className="overflow-visible">
          <div className="@container min-w-0">
            <div
              data-testid="new-session-slot-row"
              className="grid grid-cols-2 @min-[340px]:grid-cols-3 gap-1.5 items-start min-w-0"
            >
              <div className="col-span-2 @min-[340px]:col-span-1 min-w-0">
                <ComboBox
                  label="Day"
                  value={dayInput}
                  onChange={setDayInput}
                  options={dayOptions}
                  placeholder="Day 1…"
                  testId="new-session-day"
                />
              </div>
              <div className="min-w-0">
                <ComboBox
                  label="Block (optional)"
                  value={blockLabel}
                  onChange={setBlockLabel}
                  options={blockOptions}
                  placeholder="Block…"
                  testId="new-session-block"
                />
              </div>
              <div className="min-w-0">
                <ComboBox
                  label="Week (optional)"
                  value={weekLabel}
                  onChange={setWeekLabel}
                  options={weekOptions}
                  placeholder="Week…"
                  testId="new-session-week"
                />
              </div>
            </div>
          </div>
        </NestedCard>
        {error && <p data-testid="new-session-error" className="text-xs text-[var(--cal-error)]">{error}</p>}
      </div>
    </CenteredDialog>
  );
}
