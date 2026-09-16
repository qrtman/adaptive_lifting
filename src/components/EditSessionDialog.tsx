import { useState } from 'react';
import { apiService } from '../services/api';
import { usePeriodization } from '../contexts/PeriodizationContext';
import { displayDayField, normalizeDayLabel } from '../features/plan/sessionLabels';
import { setRecentBlock, setRecentDay, setRecentName, setRecentWeek } from '../storage/uiPrefs';
import { CenteredDialog } from './CenteredDialog';
import { ComboBox } from './ComboBox';
import { LabelCombo, dayComboOptions, uniquePlanLabels, uniquePlanTitles } from './LabelCombo';

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
  const blockOptions = uniquePlanLabels(microcycles, 'blockLabel');
  const weekOptions = uniquePlanLabels(microcycles, 'weekLabel');
  const dayOptions = dayComboOptions(microcycles);
  const nameOptions = uniquePlanTitles(microcycles);
  const [dayInput, setDayInput] = useState(() => displayDayField(session.dayLabel));
  const [title, setTitle] = useState(session.title || '');
  const [blockLabel, setBlockLabel] = useState(session.blockLabel || '');
  const [weekLabel, setWeekLabel] = useState(session.weekLabel || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (busy) return;
    const name = title.trim();
    if (!name) {
      setError('Enter a name');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const dayCanonical = normalizeDayLabel(dayInput);
      await apiService.updateSession(session.id, {
        title: name,
        dayLabel: dayCanonical ?? session.date,
        blockLabel: blockLabel.trim(),
        weekLabel: weekLabel.trim(),
      });
      if (dayCanonical) setRecentDay(planAthleteId, dayCanonical);
      setRecentName(planAthleteId, name);
      if (blockLabel.trim()) setRecentBlock(planAthleteId, blockLabel.trim());
      if (weekLabel.trim()) setRecentWeek(planAthleteId, weekLabel.trim());
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
      title={`Edit session · ${session.date}`}
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
              className="mr-auto h-8 px-3 text-xs text-[#FF453A] hover:text-white disabled:opacity-40"
            >
              Delete
            </button>
          ) : null}
          <button
            type="button"
            data-testid="edit-session-cancel"
            onClick={onClose}
            className="h-8 px-3 text-xs text-[#AEAEB2] hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="edit-session-save"
            disabled={busy}
            onClick={() => void save()}
            className="h-8 px-3 text-xs text-white bg-[#007AFF] rounded disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    >
      <div className="flex flex-col gap-2">
        <ComboBox
          label="Name"
          value={title}
          onChange={setTitle}
          options={nameOptions}
          placeholder="Squat, Meet…"
          testId="session-title"
        />
        <div
          data-testid="edit-session-slot-row"
          className="grid grid-cols-3 gap-1.5 items-start min-w-0"
        >
          <div className="min-w-0">
            <ComboBox
              label="Day"
              value={dayInput}
              onChange={setDayInput}
              options={dayOptions}
              placeholder="Day 1…"
              testId="session-day"
            />
          </div>
          <div className="min-w-0">
            <LabelCombo
              label="Block (optional)"
              value={blockLabel}
              onChange={setBlockLabel}
              options={blockOptions}
              testId="session-block"
            />
          </div>
          <div className="min-w-0">
            <LabelCombo
              label="Week (optional)"
              value={weekLabel}
              onChange={setWeekLabel}
              options={weekOptions}
              testId="session-week"
            />
          </div>
        </div>
        {error && <p data-testid="edit-session-error" className="text-xs text-[#FF453A]">{error}</p>}
      </div>
    </CenteredDialog>
  );
}
