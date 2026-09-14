import { useEffect, useMemo, useRef } from 'react';
import type { DragEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { WorkoutData } from '../../types';
import type { CalendarLayout } from '../breakpoints';
import { calendarShortcut } from './calendarKeyboard';
import { chipLabel } from './chipLabel';
import { DayCell } from './DayCell';
import { DayPopover } from './DayPopover';
import {
  buildMonthGrid,
  moveFocus,
  shiftMonth,
  todayIso,
  weekdayHeaders,
  weekStripDays,
  type WeekStart,
} from './monthModel';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function MonthCalendar({
  year,
  month,
  weekStartsOn = 1,
  layout,
  focusedIso,
  sessionsByDate,
  today = todayIso(),
  highlightedIds,
  copyMode,
  popoverIso,
  empty,
  emptyCopy,
  onYearMonth,
  onFocus,
  onOpenDay,
  onCreate,
  onOpenSession,
  onOpenGrid,
  onReschedule,
  onCopy,
  onPopoverIso,
}: {
  year: number;
  month: number;
  weekStartsOn?: WeekStart;
  layout: CalendarLayout;
  focusedIso: string;
  sessionsByDate: Map<string, WorkoutData[]>;
  today?: string;
  highlightedIds?: Set<string>;
  copyMode?: boolean;
  popoverIso: string | null;
  empty?: boolean;
  emptyCopy?: string;
  onYearMonth: (next: { year: number; month: number }) => void;
  onFocus: (iso: string) => void;
  onOpenDay: (iso: string) => void;
  onCreate: (iso: string) => void;
  onOpenSession: (workout: WorkoutData) => void;
  onOpenGrid: (workout: WorkoutData) => void;
  onReschedule: (workout: WorkoutData, date: string) => void;
  onCopy?: (workout: WorkoutData) => void;
  onPopoverIso: (iso: string | null) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => buildMonthGrid(year, month, weekStartsOn), [year, month, weekStartsOn]);
  const visible = layout === 'week-strip' ? weekStripDays(days, focusedIso) : days;
  const headers = weekdayHeaders(weekStartsOn);
  const popoverSessions = popoverIso ? (sessionsByDate.get(popoverIso) || []) : [];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mapped = calendarShortcut(event);
      if (!mapped) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-testid="set-grid"]') || target?.closest('input, textarea, select')) return;
      event.preventDefault();
      if (mapped.type === 'move') onFocus(moveFocus(focusedIso, mapped.key, days));
      else if (mapped.type === 'prevMonth') onYearMonth(shiftMonth(year, month, -1));
      else if (mapped.type === 'nextMonth') onYearMonth(shiftMonth(year, month, 1));
      else if (mapped.type === 'today') {
        const now = new Date();
        onYearMonth({ year: now.getFullYear(), month: now.getMonth() });
        onFocus(todayIso(now));
      } else if (mapped.type === 'create') onCreate(focusedIso);
      else if (mapped.type === 'open') onOpenDay(focusedIso);
      else if (mapped.type === 'escape') onPopoverIso(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [days, focusedIso, month, onCreate, onFocus, onOpenDay, onPopoverIso, onYearMonth, year]);

  const dragStart = (event: DragEvent, workout: WorkoutData) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', JSON.stringify({ workoutId: workout.id }));
  };

  const dropOn = (iso: string) => (event: DragEvent) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData('text/plain');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { workoutId?: string };
      const all = [...sessionsByDate.values()].flat();
      const workout = all.find((item) => item.id === parsed.workoutId);
      if (workout && workout.date !== iso) onReschedule(workout, iso);
    } catch {
      return;
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-canvas" data-testid="month-calendar" data-layout={layout} tabIndex={0}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-1">
        <div className="flex items-center gap-2">
          <h2 data-testid="calendar-month-label" className="text-ui text-fg-strong">
            {MONTHS[month]} {year}
          </h2>
          <button type="button" data-testid="calendar-prev-month" aria-label="Previous month" onClick={() => onYearMonth(shiftMonth(year, month, -1))} className="h-7 w-7 flex items-center justify-center text-fg-muted hover:text-fg-strong">
            <ChevronLeft size={16} />
          </button>
          <button type="button" data-testid="calendar-today" onClick={() => { const now = new Date(); onYearMonth({ year: now.getFullYear(), month: now.getMonth() }); onFocus(todayIso(now)); }} className="h-7 px-2 text-caption text-fg-muted hover:text-fg-strong">
            Today
          </button>
          <button type="button" data-testid="calendar-next-month" aria-label="Next month" onClick={() => onYearMonth(shiftMonth(year, month, 1))} className="h-7 w-7 flex items-center justify-center text-fg-muted hover:text-fg-strong">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      {empty ? (
        <div data-testid="calendar-empty" className="border border-border rounded p-6 text-center m-1">
          <p className="text-ui text-fg-strong mb-1">{emptyCopy || 'Select an athlete'}</p>
          <p className="text-caption text-fg-muted">Use the athlete switcher in the sidebar to load a plan.</p>
        </div>
      ) : (
        <div
          ref={gridRef}
          role="grid"
          aria-label="Training calendar"
          className="flex-1 overflow-auto p-1"
        >
          <div role="row" className="grid grid-cols-7 gap-px mb-px">
            {headers.map((label) => (
              <div key={label} role="columnheader" className="text-micro uppercase tracking-wider text-fg-subtle px-1">
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px">
            {Array.from({ length: visible.length / 7 }, (_, week) => (
              <div key={week} role="row" aria-rowindex={week + 1} className="contents">
                {visible.slice(week * 7, week * 7 + 7).map((day) => (
                  <DayCell
                    key={day.iso}
                    day={day}
                    today={day.iso === today}
                    focused={day.iso === focusedIso}
                    sessions={sessionsByDate.get(day.iso) || []}
                    highlightedIds={highlightedIds}
                    copyMode={copyMode}
                    onFocus={() => onFocus(day.iso)}
                    onActivate={() => onOpenDay(day.iso)}
                    onCreate={() => onCreate(day.iso)}
                    onOpenSession={onOpenSession}
                    onOpenGrid={onOpenGrid}
                    onMore={() => onPopoverIso(day.iso)}
                    onDragStart={dragStart}
                    onDrop={dropOn(day.iso)}
                    onCopy={onCopy}
                  />
                ))}
              </div>
            ))}
          </div>
          {layout === 'week-strip' ? (
            <div data-testid="week-agenda" className="mt-2 border-t border-border divide-y divide-border">
              {visible.flatMap((day) => (sessionsByDate.get(day.iso) || []).map((workout) => (
                <button
                  key={workout.id}
                  type="button"
                  data-testid={`week-agenda-${workout.id}`}
                  onClick={() => onOpenSession(workout)}
                  className="w-full text-left px-2 py-2 flex items-center gap-2 hover:bg-cell-hover"
                >
                  <span className="font-mono text-mini text-fg-muted w-24 shrink-0">{day.iso}</span>
                  <span className="text-caption text-fg-strong truncate">{chipLabel(workout)}</span>
                  <span className="text-micro text-fg-muted truncate">
                    {[workout.blockLabel, workout.weekLabel].filter(Boolean).join(' · ')}
                  </span>
                </button>
              )))}
              {visible.every((day) => !(sessionsByDate.get(day.iso) || []).length) ? (
                <p className="px-2 py-4 text-caption text-fg-muted">No sessions this week.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      {popoverIso && !empty ? (
        <div className="absolute z-20 mt-8 ml-4">
          <DayPopover
            iso={popoverIso}
            sessions={popoverSessions}
            onClose={() => onPopoverIso(null)}
            onOpenSession={onOpenSession}
            onOpenGrid={onOpenGrid}
            onCreate={() => onCreate(popoverIso)}
          />
        </div>
      ) : null}
    </div>
  );
}
