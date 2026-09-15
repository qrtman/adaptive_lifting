import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { apiService } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { usePeriodization } from '../../contexts/PeriodizationContext';
import { UI_KEYS, getUiPref } from '../../storage/uiPrefs';
import { ComboBox } from '../ui/ComboBox';
import { uniquePlanTitles } from '../../components/LabelCombo';
import type { WorkoutData } from '../../types';

function positionFor(iso: string, width = 280, height = 280) {
  const cell = document.querySelector(`[data-testid="calendar-day-${iso}"]`);
  const rect = cell?.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!rect) return { top: 48, left: Math.max(8, (vw - width) / 2) };
  let left = rect.right + 8;
  if (left + width > vw - 8) left = Math.max(8, rect.left - width - 8);
  let top = rect.top;
  if (top + height > vh - 8) top = Math.max(8, vh - height - 8);
  return { top, left };
}

export function DayNotesCard({
  iso,
  sessions,
  preferId,
  athleteId,
  online,
  onClose,
  onSaved,
}: {
  iso: string;
  sessions: WorkoutData[];
  preferId?: string | null;
  athleteId?: string | null;
  online: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { user } = useAuth();
  const { microcycles } = usePeriodization();
  const isCoach = String(user?.role || getUiPref(UI_KEYS.role) || '').toUpperCase() === 'COACH';
  const coachUserId = user?.id ? String(user.id) : '';
  const linkedAthleteId = athleteId && athleteId !== coachUserId ? athleteId : null;
  const names = uniquePlanTitles(microcycles);
  const [box, setBox] = useState(positionFor(iso));
  const sessionKey = `${preferId || ''}:${sessions.map((item) => item.id).join(',')}`;
  const [activeId, setActiveId] = useState(preferId || sessions[0]?.id || '');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState(
    (preferId && sessions.find((item) => item.id === preferId)?.notes) || sessions[0]?.notes || '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const active = sessions.find((item) => item.id === activeId) || sessions[0] || null;

  useLayoutEffect(() => {
    setBox(positionFor(iso));
  }, [iso]);

  useEffect(() => {
    const preferred = preferId && sessions.some((item) => item.id === preferId)
      ? preferId
      : sessions[0]?.id || '';
    setActiveId(preferred);
    const next = sessions.find((item) => item.id === preferred);
    setNotes(next?.notes || '');
  }, [iso, sessionKey]);

  useEffect(() => {
    textRef.current?.focus();
  }, [activeId, iso]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const persistExisting = async (next: string) => {
    if (!active) return;
    await apiService.updateSession(active.id, { notes: next });
    await onSaved();
  };

  const saveEmptyDay = async () => {
    if (!online) {
      setError('Connect to save a note.');
      return;
    }
    if (!title.trim()) {
      setError('Name is required');
      return;
    }
    if (isCoach && !linkedAthleteId) {
      setError('Select an athlete');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await apiService.createSession({
        date: iso,
        title: title.trim(),
        athleteId: isCoach ? linkedAthleteId || undefined : undefined,
      });
      if (notes.trim()) await apiService.updateSession(created.id, { notes: notes.trim() });
      await onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save note');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40">
      <button type="button" aria-label="Close note" className="absolute inset-0" onClick={onClose} />
      <div
        role="dialog"
        aria-label={`Notes · ${iso}`}
        data-testid="day-notes-card"
        className="absolute z-10 bg-card border border-border rounded p-3 shadow-[var(--sticky-shadow)]"
        style={{ top: box.top, left: box.left, width: 280 }}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-caption text-fg-strong font-mono">{iso}</p>
          <button type="button" data-testid="day-notes-close" onClick={onClose} className="text-mini text-fg-muted hover:text-fg-strong">
            Close
          </button>
        </div>
        {sessions.length > 1 ? (
          <div className="flex flex-col gap-1 mb-2 max-h-24 overflow-auto">
            {sessions.map((workout) => (
              <button
                key={workout.id}
                type="button"
                data-testid={`day-notes-pick-${workout.id}`}
                onClick={() => {
                  setActiveId(workout.id);
                  setNotes(workout.notes || '');
                }}
                className={`h-8 px-2 text-left text-mini truncate rounded ${
                  workout.id === active?.id ? 'bg-cell-selected text-fg-strong' : 'text-fg-muted hover:bg-cell-hover'
                }`}
              >
                {workout.title}
              </button>
            ))}
          </div>
        ) : null}
        {active ? (
          <>
            <p className="text-mini text-fg-muted mb-1 truncate">{active.title}</p>
            <textarea
              ref={textRef}
              data-testid="day-notes-text"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              onBlur={() => {
                if ((active.notes || '') !== notes) void persistExisting(notes);
              }}
              className="w-full min-h-24 bg-canvas border border-border rounded p-2 text-caption text-fg-strong resize-y"
              placeholder="Session note"
            />
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <ComboBox
              label="Name"
              value={title}
              onChange={setTitle}
              options={names}
              testId="day-notes-title"
              allowCreate
              required
              placeholder="Session name"
            />
            <textarea
              ref={textRef}
              data-testid="day-notes-text"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="w-full min-h-24 bg-canvas border border-border rounded p-2 text-caption text-fg-strong resize-y"
              placeholder="Session note"
            />
            <button
              type="button"
              data-testid="day-notes-save"
              disabled={busy || !title.trim() || !online}
              onClick={() => void saveEmptyDay()}
              className="h-8 px-3 text-caption text-fg-strong bg-accent rounded disabled:opacity-40 self-end"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
        {error ? <p className="text-caption text-error mt-2">{error}</p> : null}
      </div>
    </div>
  );
}
