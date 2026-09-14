import { useRef, useState } from 'react';
import type { DragEvent, PointerEvent } from 'react';
import { MoreHorizontal, Plus, StickyNote } from 'lucide-react';
import type { WorkoutData } from '../../types';
import type { CalendarLayout } from '../breakpoints';
import { CHIPS_VISIBLE } from '../breakpoints';
import { overflowChips } from './chipLabel';
import type { MonthDay } from './monthModel';
import { SessionChip } from './SessionChip';

const GHOST = 'h-5 w-5 flex items-center justify-center rounded text-fg-muted hover:text-fg-strong hover:bg-cell-hover';

export function DayCell({
  day,
  today,
  focused,
  layout,
  sessions,
  highlightedIds,
  copyMode,
  onFocus,
  onActivate,
  onCreate,
  onNote,
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
  layout: CalendarLayout;
  sessions: WorkoutData[];
  highlightedIds?: Set<string>;
  copyMode?: boolean;
  onFocus: () => void;
  onActivate: () => void;
  onCreate: () => void;
  onNote: () => void;
  onOpenSession: (workout: WorkoutData) => void;
  onOpenGrid: (workout: WorkoutData) => void;
  onMore: () => void;
  onDragStart?: (event: DragEvent, workout: WorkoutData) => void;
  onDrop?: (event: DragEvent) => void;
  onCopy?: (workout: WorkoutData) => void;
  key?: string;
}) {
  const { shown, overflow } = overflowChips(sessions, CHIPS_VISIBLE);
  const [menuOpen, setMenuOpen] = useState(false);
  const pressRef = useRef<number | null>(null);
  const weekStrip = layout === 'week-strip';
  const showGhosts = day.inMonth && (!weekStrip || menuOpen);

  const clearPress = () => {
    if (pressRef.current != null) {
      window.clearTimeout(pressRef.current);
      pressRef.current = null;
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!day.inMonth || !weekStrip || event.pointerType === 'mouse') return;
    clearPress();
    pressRef.current = window.setTimeout(() => {
      setMenuOpen(true);
      pressRef.current = null;
    }, 450);
  };

  return (
    <div
      role="gridcell"
      aria-selected={focused}
      aria-colindex={day.col}
      data-testid={`calendar-day-${day.iso}`}
      tabIndex={focused ? 0 : -1}
      onFocus={onFocus}
      onClick={onActivate}
      onPointerDown={onPointerDown}
      onPointerUp={clearPress}
      onPointerLeave={clearPress}
      onPointerCancel={clearPress}
      onDragOver={(event) => {
        if (day.inMonth) event.preventDefault();
      }}
      onDrop={day.inMonth ? onDrop : undefined}
      className={`group/day relative min-h-[var(--day-cell-min-h)] p-1 border border-border flex flex-col gap-0.5 ${
        day.inMonth ? 'bg-cell hover:bg-cell-hover' : 'bg-canvas text-fg-subtle'
      } ${today ? 'ring-1 ring-accent' : ''} ${focused ? 'bg-cell-selected' : ''}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-mini font-mono tabular-nums">{day.dayNumber}</span>
        {day.inMonth && weekStrip ? (
          <button
            type="button"
            data-testid={`calendar-day-menu-${day.iso}`}
            aria-label="Day actions"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((open) => !open);
            }}
            className={`${GHOST} opacity-70 group-hover/day:opacity-100 ${focused || menuOpen ? 'opacity-100' : ''}`}
          >
            <MoreHorizontal size={16} />
          </button>
        ) : null}
        {showGhosts ? (
          <div
            className={`flex items-center gap-0.5 ${
              weekStrip
                ? ''
                : `invisible pointer-events-none group-hover/day:visible group-hover/day:pointer-events-auto group-focus-within/day:visible group-focus-within/day:pointer-events-auto ${
                    focused ? 'visible pointer-events-auto' : ''
                  }`
            }`}
          >
            <button
              type="button"
              data-testid={`calendar-new-session-${day.iso}`}
              aria-label="New session"
              onClick={(event) => {
                event.stopPropagation();
                onCreate();
              }}
              className={GHOST}
            >
              <Plus size={16} />
            </button>
            <button
              type="button"
              data-testid={`calendar-day-note-${day.iso}`}
              aria-label="Note"
              onClick={(event) => {
                event.stopPropagation();
                onNote();
              }}
              className={GHOST}
            >
              <StickyNote size={16} />
            </button>
          </div>
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
