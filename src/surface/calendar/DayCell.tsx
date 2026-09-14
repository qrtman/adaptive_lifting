import type { DragEvent } from 'react';
import type { WorkoutData } from '../../types';
import { CHIPS_VISIBLE } from '../breakpoints';
import { overflowChips } from './chipLabel';
import type { MonthDay } from './monthModel';
import { SessionChip } from './SessionChip';

export function DayCell({
  day,
  today,
  focused,
  sessions,
  highlightedIds,
  copyMode,
  onFocus,
  onActivate,
  onCreate,
  onOpenSession,
  onOpenGrid,
  onMore,
  onDragStart,
  onDrop,
  onCopy,
}: {
  day: MonthDay;
  today: boolean;
  focused: boolean;
  sessions: WorkoutData[];
  highlightedIds?: Set<string>;
  copyMode?: boolean;
  onFocus: () => void;
  onActivate: () => void;
  onCreate: () => void;
  onOpenSession: (workout: WorkoutData) => void;
  onOpenGrid: (workout: WorkoutData) => void;
  onMore: () => void;
  onDragStart?: (event: DragEvent, workout: WorkoutData) => void;
  onDrop?: (event: DragEvent) => void;
  onCopy?: (workout: WorkoutData) => void;
  key?: string;
}) {
  const { shown, overflow } = overflowChips(sessions, CHIPS_VISIBLE);
  return (
    <div
      role="gridcell"
      aria-selected={focused}
      aria-colindex={day.col}
      data-testid={`calendar-day-${day.iso}`}
      tabIndex={focused ? 0 : -1}
      onFocus={onFocus}
      onClick={onActivate}
      onDragOver={(event) => {
        if (day.inMonth) event.preventDefault();
      }}
      onDrop={day.inMonth ? onDrop : undefined}
      className={`min-h-[var(--day-cell-min-h)] p-1 border border-border flex flex-col gap-0.5 ${
        day.inMonth ? 'bg-cell hover:bg-cell-hover' : 'bg-canvas text-fg-subtle'
      } ${today ? 'ring-1 ring-accent' : ''} ${focused ? 'bg-cell-selected' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-mini font-mono tabular-nums">{day.dayNumber}</span>
        {day.inMonth ? (
          <button
            type="button"
            data-testid={`calendar-new-session-${day.iso}`}
            onClick={(event) => {
              event.stopPropagation();
              onCreate();
            }}
            className="h-5 px-1 text-micro text-fg-muted hover:text-fg-strong"
          >
            New session
          </button>
        ) : null}
      </div>
      {shown.map((workout) => (
        <SessionChip
          key={workout.id}
          workout={workout}
          highlighted={highlightedIds?.has(workout.id)}
          onOpen={() => onOpenSession(workout)}
          onOpenGrid={() => onOpenGrid(workout)}
          onDragStart={onDragStart ? (event) => onDragStart(event, workout) : undefined}
          onCopy={!copyMode && onCopy ? () => onCopy(workout) : undefined}
        />
      ))}
      {overflow > 0 ? (
        <button
          type="button"
          data-testid={`calendar-overflow-${day.iso}`}
          onClick={(event) => {
            event.stopPropagation();
            onMore();
          }}
          className="text-micro text-accent text-left"
        >
          +{overflow} more
        </button>
      ) : null}
    </div>
  );
}
