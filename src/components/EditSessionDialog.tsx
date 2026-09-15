import { useState } from 'react';
import { apiService } from '../services/api';
import { usePeriodization } from '../contexts/PeriodizationContext';
import { CenteredDialog } from './CenteredDialog';
import { LabelCombo, uniquePlanLabels, uniquePlanTitles } from './LabelCombo';
import { ComboBox } from '../surface/ui/ComboBox';

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
    blockLabel?: string | null;
    weekLabel?: string | null;
  };
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onDeleted?: () => void | Promise<void>;
}) {
  const { microcycles } = usePeriodization();
  const nameOptions = uniquePlanTitles(microcycles);
  const blockOptions = uniquePlanLabels(microcycles, 'blockLabel');
  const weekOptions = uniquePlanLabels(microcycles, 'weekLabel');
  const [title, setTitle] = useState(session.title || '');
  const [blockLabel, setBlockLabel] = useState(session.blockLabel || '');
  const [weekLabel, setWeekLabel] = useState(session.weekLabel || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (busy) return;
    if (!title.trim()) {
      setError('Name is required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiService.updateSession(session.id, {
        title: title.trim(),
        blockLabel: blockLabel.trim(),
        weekLabel: weekLabel.trim(),
      });
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
            disabled={busy || !title.trim()}
            onClick={() => void save()}
            className="h-8 px-3 text-xs text-white bg-[#007AFF] rounded disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        <ComboBox
          label="Name"
          value={title}
          onChange={setTitle}
          options={nameOptions}
          testId="session-title"
          allowCreate
          required
        />
        <div className="grid grid-cols-2 gap-2">
          <LabelCombo
            label="Block (optional)"
            value={blockLabel}
            onChange={setBlockLabel}
            options={blockOptions}
            testId="session-block"
          />
          <LabelCombo
            label="Week (optional)"
            value={weekLabel}
            onChange={setWeekLabel}
            options={weekOptions}
            testId="session-week"
          />
        </div>
        {error && <p className="text-xs text-[#FF453A]">{error}</p>}
      </div>
    </CenteredDialog>
  );
}
