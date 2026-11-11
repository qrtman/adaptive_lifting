import { formatPlanLabel, formatSessionDate } from '../features/plan/sessionLabels';
import { liftScheme, sessionSetCount, setCountLabel, type RailSession, type WeekRailModel } from '../features/plan/weekRail';

/** Drag payload of a lift dragged out of the rail: `{ workoutId, exerciseId }` as JSON. */
export const LIFT_DRAG_MIME = 'application/x-al-lift';

/**
 * The other days of this session's Week, next to the session (session sheet phase 1,
 * `.cursor/rules/session-sheet.mdc`). Desktop: a column. Phone: a strip of days.
 * Labels are only written by an explicit "Assign" click, never automatically.
 */
export function WeekRail({
  model,
  activeId,
  notes,
  onOpen,
  canAssign,
  assignDisabledReason,
  onAssign,
  onAssignWeek,
  variant = 'column',
  canDragLifts = false,
}: {
  /** Lifts of other days can be dragged into the open session (copies its Plan sets). */
  canDragLifts?: boolean;
  /** `column`: desktop side column (lg+). `strip`: phone day strip (below lg). */
  variant?: 'column' | 'strip';
  model: WeekRailModel;
  activeId: string;
  /** Day notes keyed by calendar date. */
  notes: Record<string, string>;
  onOpen: (session: RailSession) => void;
  canAssign: boolean;
  assignDisabledReason?: string;
  /** Give an inferred session this week's Block/Week labels. */
  onAssign: (session: RailSession) => void;
  /** No week found: open the session's Edit dialog. */
  onAssignWeek: () => void;
}) {
  if (model.kind === 'unassigned') {
    if (variant === 'strip') return null;
    return (
      <aside aria-label="Week" data-testid="week-rail" className="hidden w-60 shrink-0 self-start pt-3 lg:block">
        <div className="rounded-[var(--cal-radius-md)] border border-dashed border-[var(--cal-hairline)] px-3 py-3">
          <p className="text-[13px] font-medium text-[var(--cal-ink)]">No Week</p>
          <p className="mt-1 text-[12px] leading-snug text-[var(--cal-muted)]">Assign a Week to see the rest of the week here.</p>
          <button
            type="button"
            data-testid="week-rail-assign-week"
            onClick={onAssignWeek}
            disabled={!canAssign}
            title={!canAssign ? assignDisabledReason : undefined}
            className="mt-2 h-8 rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)] px-2.5 text-[12px] text-[var(--cal-ink)] hover:bg-[var(--cal-surface-soft)] disabled:opacity-40"
          >
            Assign a Week
          </button>
        </div>
      </aside>
    );
  }

  const week = formatPlanLabel('Week', model.weekLabel) ?? model.weekLabel;
  const block = formatPlanLabel('Block', model.blockLabel);
  const totalSets = model.sessions.reduce((sum, s) => sum + sessionSetCount(s.workout), 0);
  const dayName = (s: RailSession) => formatPlanLabel('Day', s.workout.dayLabel) ?? formatSessionDate(s.workout.date);

  if (variant === 'column') return (
      <aside aria-label="Week" data-testid="week-rail" className="sticky top-0 hidden max-h-[100dvh] w-60 shrink-0 flex-col gap-2 self-start overflow-y-auto py-3 lg:flex">
        <div className="px-1">
          <p className="text-[13px] font-semibold text-[var(--cal-ink)]" data-testid="week-rail-title">{week}</p>
          <p className="text-[11px] text-[var(--cal-muted)]">
            {[block, `${model.sessions.length} ${model.sessions.length === 1 ? 'session' : 'sessions'}`, setCountLabel(totalSets)].filter(Boolean).join(' · ')}
          </p>
        </div>
        {model.sessions.map((session) => {
          const { workout } = session;
          const active = workout.id === activeId;
          const note = notes[workout.date]?.trim();
          return (
            <div key={workout.id} className="flex flex-col gap-1">
              <button
                type="button"
                data-testid={`week-rail-day-${workout.id}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => { if (!active) onOpen(session); }}
                className={`w-full rounded-[var(--cal-radius-md)] border px-2.5 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--cal-accent)] ${
                  active
                    ? 'border-[color-mix(in_srgb,var(--cal-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--cal-accent)_8%,transparent)]'
                    : 'border-transparent hover:bg-[var(--cal-surface-soft)]'
                }`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] font-semibold text-[var(--cal-ink)]">{dayName(session)}</span>
                  <span className="tnum whitespace-nowrap text-[11px] text-[var(--cal-muted)]">
                    {/* An unlabeled day is already named by its date on the left. */}
                    {formatPlanLabel('Day', workout.dayLabel) ? `${formatSessionDate(workout.date)} · ` : ''}
                    {setCountLabel(sessionSetCount(workout))}
                  </span>
                </span>
                {session.inferred ? (
                  <span className="mt-0.5 inline-block rounded-full bg-[var(--cal-surface-soft)] px-1.5 text-[10px] text-[var(--cal-muted)]">no Week</span>
                ) : null}
                {note ? (
                  <span data-testid={`week-rail-note-${workout.id}`} className="mt-0.5 block truncate text-[11px] italic text-[var(--cal-muted)]">{note}</span>
                ) : null}
                {workout.exercises.length ? (
                  <span className="mt-1 flex flex-col">
                    {workout.exercises.map((exercise) => (
                      <span
                        key={exercise.id}
                        data-testid={`week-rail-lift-${exercise.id}`}
                        draggable={canDragLifts && !active}
                        title={canDragLifts && !active ? 'Drag into this session to copy it with its Plan sets' : undefined}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(LIFT_DRAG_MIME, JSON.stringify({ workoutId: workout.id, exerciseId: exercise.id }));
                          event.dataTransfer.setData('text/plain', exercise.title);
                          event.dataTransfer.effectAllowed = 'copy';
                        }}
                        className={`flex items-baseline justify-between gap-2 text-[12px] leading-[19px] ${canDragLifts && !active ? 'cursor-grab active:cursor-grabbing' : ''}`}
                      >
                        <span className="truncate text-[var(--cal-ink)]">{exercise.title}</span>
                        <span className="tnum whitespace-nowrap text-[var(--cal-muted)]">{liftScheme(exercise.sets)}</span>
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="mt-1 block text-[12px] text-[var(--cal-muted)]">No lifts yet</span>
                )}
              </button>
              {session.inferred ? (
                <button
                  type="button"
                  data-testid={`week-rail-assign-${workout.id}`}
                  onClick={() => onAssign(session)}
                  disabled={!canAssign}
                  title={!canAssign ? assignDisabledReason : undefined}
                  className="self-start px-2.5 text-[11px] text-[var(--cal-accent)] hover:underline disabled:opacity-40 disabled:no-underline"
                >
                  Assign to {week}
                </button>
              ) : null}
            </div>
          );
        })}
      </aside>
  );

  return (
      <nav aria-label="Week days" data-testid="week-rail-strip" className="-mx-3 mb-3 flex gap-2 overflow-x-auto px-3 lg:hidden">
        {model.sessions.map((session) => {
          const active = session.workout.id === activeId;
          return (
            <button
              key={session.workout.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => { if (!active) onOpen(session); }}
              className={`shrink-0 rounded-[var(--cal-radius-md)] border px-3 py-1.5 text-left ${
                active
                  ? 'border-[color-mix(in_srgb,var(--cal-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--cal-accent)_8%,transparent)]'
                  : 'border-[var(--cal-hairline)]'
              }`}
            >
              <span className="block text-[12px] font-semibold text-[var(--cal-ink)]">{dayName(session)}</span>
              <span className="tnum block text-[11px] text-[var(--cal-muted)]">{setCountLabel(sessionSetCount(session.workout))}</span>
            </button>
          );
        })}
      </nav>
  );
}
