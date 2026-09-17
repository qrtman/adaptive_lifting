import type { WorkoutData } from '../../types';
import { SessionChip } from './SessionChip';

export function DayPopover({
  iso,
  sessions,
  onClose,
  onOpenSession,
  onOpenGrid,
  onCreate,
  onNote,
}: {
  iso: string;
  sessions: WorkoutData[];
  onClose: () => void;
  onOpenSession: (workout: WorkoutData) => void;
  onOpenGrid: (workout: WorkoutData) => void;
  onCreate: () => void;
  onNote: (workout: WorkoutData) => void;
}) {
  return (
    <div
      role="dialog"
      aria-label={`Sessions on ${iso}`}
      data-testid="day-popover"
      className="w-[min(100%,var(--inspector-snap-a))] min-w-[var(--popover-w)] bg-card border border-border rounded p-2 shadow-[var(--sticky-shadow)]"
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-caption text-fg-strong font-mono">{iso}</p>
        <button type="button" onClick={onClose} className="text-mini text-fg-muted hover:text-fg-strong">
          Close
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {sessions.map((workout) => (
          <div key={workout.id} className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <SessionChip
                workout={workout}
                onOpen={() => onOpenSession(workout)}
                onOpenGrid={() => onOpenGrid(workout)}
              />
            </div>
            <button
              type="button"
              data-testid={`day-popover-note-${workout.id}`}
              aria-label={`Note ${workout.title}`}
              onClick={() => onNote(workout)}
              className="h-7 px-2 text-mini text-fg-muted hover:text-fg-strong shrink-0"
            >
              Note
            </button>
          </div>
        ))}
        {sessions.length === 0 ? (
          <p className="text-caption text-fg-muted py-2">No sessions.</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onCreate}
        className="mt-2 h-7 w-full text-mini text-accent hover:text-fg-strong"
      >
        New session
      </button>
    </div>
  );
}
