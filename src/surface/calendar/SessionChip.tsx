import type { DragEvent } from 'react';
import type { WorkoutData } from '../../types';
import { chipLabel, chipMeta, chipStatusClass } from './chipLabel';

export function SessionChip({
  workout,
  highlighted,
  onOpen,
  onOpenGrid,
  onDragStart,
  onCopy,
}: {
  workout: WorkoutData;
  highlighted?: boolean;
  onOpen: () => void;
  onOpenGrid?: () => void;
  onDragStart?: (event: DragEvent) => void;
  onCopy?: () => void;
  key?: string;
}) {
  const meta = chipMeta(workout);
  const labels = [workout.blockLabel, workout.weekLabel].filter(Boolean).join(' · ');
  return (
    <div
      data-testid={`workout-card-${workout.id}`}
      draggable={Boolean(onDragStart)}
      onDragStart={onDragStart}
      className={`group/chip h-[var(--chip-height)] px-[var(--chip-pad-x)] max-w-[var(--chip-max-w)] rounded-[var(--chip-radius)] border flex items-center gap-1 ${chipStatusClass(workout.status)} ${highlighted ? 'ring-1 ring-accent' : 'bg-cell'}`}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onOpenGrid?.();
        }}
        className="min-w-0 flex-1 text-left text-mini truncate"
      >
        {chipLabel(workout)}
        {labels ? <span className="ml-1 text-micro text-fg-muted">{labels}</span> : null}
        {meta ? <span className="ml-1 text-micro text-fg-subtle">{meta}</span> : null}
      </button>
      {onCopy ? (
        <button
          type="button"
          data-testid={`calendar-copy-to-${workout.id}`}
          onClick={(event) => {
            event.stopPropagation();
            onCopy();
          }}
          className="text-micro text-fg-muted hover:text-fg-strong shrink-0 opacity-0 group-hover/chip:opacity-100 group-hover/day:opacity-100 focus:opacity-100"
        >
          Copy to
        </button>
      ) : null}
    </div>
  );
}
