import type { WorkoutData } from '../../types';
import { SessionChip } from './SessionChip';

export function DayPopover({
  iso,
  sessions,
  onClose,
  onOpenSession,
  onOpenGrid,
  onCreate,
}: {
  iso: string;
  sessions: WorkoutData[];
  onClose: () => void;
  onOpenSession: (workout: WorkoutData) => void;
  onOpenGrid: (workout: WorkoutData) => void;
  onCreate: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label={`Sessions on ${iso}`}
      data-testid="day-popover"
      className="w-[var(--popover-w)] bg-card border border-border rounded p-2 shadow-[var(--sticky-shadow)]"
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-caption text-fg-strong font-mono">{iso}</p>
        <button type="button" onClick={onClose} className="text-mini text-fg-muted hover:text-fg-strong">
          Close
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {sessions.map((workout) => (
          <SessionChip
            key={workout.id}
            workout={workout}
            onOpen={() => onOpenSession(workout)}
            onOpenGrid={() => onOpenGrid(workout)}
          />
        ))}
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
