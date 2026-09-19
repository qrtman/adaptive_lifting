import { useMemo, useState, type CSSProperties } from 'react';
import { ExerciseData, WorkoutData } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { usePeriodization } from '../contexts/PeriodizationContext';
import { useSync } from '../contexts/SyncContext';
import { getRecentBlock, getUiPref, UI_KEYS } from '../storage/uiPrefs';
import { LiftFilter, type LiftFilterValue } from './LiftFilter';
import { NewSessionDialog } from './NewSessionDialog';
import { EditSessionDialog } from './EditSessionDialog';
import {
  buildBlockClipboard,
  buildDayClipboard,
  buildWeekClipboard,
  groupLabeledSessions,
  type CopyClipboard,
} from '../features/plan/copyClipboard';

interface SessionsViewProps {
  onViewSession: (workout: WorkoutData, microId: string) => void;
  filter: LiftFilterValue;
  onFilterChange: (value: LiftFilterValue) => void;
  onStartCopy: (clip: CopyClipboard) => void;
}

type SessionEntry = { workout: WorkoutData; microId: string };

function liftAbbrev(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('squat')) return 'SQ';
  if (t.includes('bench')) return 'BP';
  if (t.includes('dead')) return 'DL';
  return title.slice(0, 3).toUpperCase();
}

function liftColorStyle(title: string): CSSProperties | undefined {
  const t = title.toLowerCase();
  if (t.includes('squat')) return { color: 'var(--cal-badge-sq)' };
  if (t.includes('bench')) return { color: 'var(--cal-badge-bp)' };
  if (t.includes('dead')) return { color: 'var(--cal-badge-dl)' };
  return undefined;
}

function setLine(ex: ExerciseData): { planned: string; logged: string | null } {
  const set = ex.sets[0];
  const planned = `${set?.plannedWeight ?? '—'}×${set?.plannedReps ?? '—'}@${set?.plannedRpe ?? '—'}`;
  if (set?.actual != null && Number(set.actual) > 0) {
    return {
      planned,
      logged: `${set.actual}×${set.reps ?? '—'}@${set.executedRpe ?? '—'}`,
    };
  }
  return { planned, logged: null };
}

function workoutPassesFilter(w: WorkoutData, filter: LiftFilterValue): boolean {
  if (filter === 'All') return true;
  const hasSquat = w.exercises.some(e => e.title.toLowerCase().includes('squat'));
  const hasBench = w.exercises.some(e => e.title.toLowerCase().includes('bench'));
  const hasDeadlift = w.exercises.some(e => e.title.toLowerCase().includes('deadlift') || e.title.toLowerCase().includes('dead'));
  if (filter === 'Squat') return hasSquat;
  if (filter === 'Bench') return hasBench;
  if (filter === 'Deadlift') return hasDeadlift;
  return false;
}

function weekRowKey(blockLabel: string, weekLabel: string): string {
  return `${blockLabel || '_'}::${weekLabel}`;
}

const weekCardClass =
  'rounded-[var(--cal-radius-lg)] border border-[var(--cal-hairline)] bg-[var(--cal-surface-card)] p-[var(--cal-space-xs)] flex flex-col gap-[var(--cal-space-xs)]';

const blockCardClass =
  'rounded-[var(--cal-radius-lg)] border border-[var(--cal-hairline)] bg-[var(--cal-surface-soft)] p-[var(--cal-space-xs)] flex flex-col gap-[var(--cal-space-sm)]';

const copyBtnClass =
  'h-6 px-2 rounded-[var(--cal-radius-md)] bg-[var(--cal-surface-strong)] text-[var(--cal-ink)] text-[10px] font-medium disabled:opacity-40 hover:opacity-90 transition-opacity';

function SessionCard({
  workout,
  microId,
  active,
  canCopy,
  selected,
  onOpen,
  onToggleSelected,
  onCopyTo,
  onEdit,
}: {
  workout: WorkoutData;
  microId: string;
  active: boolean;
  canCopy: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggleSelected: (checked: boolean) => void;
  onCopyTo: () => void;
  onEdit: () => void;
  key?: string;
}) {
  const labels = [workout.blockLabel, workout.weekLabel].filter(Boolean).join(' · ');
  return (
    <div
      data-testid={`sessions-card-${workout.id}`}
      data-elevated={active ? 'true' : undefined}
      className={`cal-nested-card flex flex-col gap-[var(--cal-space-xs)] ${
        active ? 'ring-1 ring-[color-mix(in_srgb,var(--cal-accent)_45%,transparent)]' : ''
      }`}
    >
      <button type="button" onClick={onOpen} className="text-left flex flex-col gap-1 hover:opacity-90">
        <div className="flex items-center justify-between gap-2 min-h-6">
          <span className="text-xs tnum text-[var(--cal-ink)] truncate">{workout.date}</span>
          <span className="text-[10px] tnum text-[var(--cal-muted)] shrink-0">
            {workout.status} · {workout.tonnage}kg
          </span>
        </div>
        <p className="text-xs font-medium text-[var(--cal-ink)] truncate">{workout.title || 'Session'}</p>
        <p className="text-[10px] text-[var(--cal-muted)] truncate">{labels || 'No block/week'}</p>
        <div className="flex flex-col gap-0.5">
          {workout.exercises.map((ex) => {
            const { planned, logged } = setLine(ex);
            return (
              <div key={ex.id} className="flex items-center gap-2 tnum text-[11px] leading-tight min-h-5">
                <span className="w-6 shrink-0 font-medium" style={liftColorStyle(ex.title)}>
                  {liftAbbrev(ex.title)}
                </span>
                <span className="text-[var(--cal-ink)] truncate flex-1 min-w-0" title={ex.title}>{ex.title}</span>
                <span className="text-[var(--cal-muted)] shrink-0">{planned}</span>
                <span className={`shrink-0 ${logged ? 'text-[var(--cal-ink)]' : 'text-[var(--cal-muted-soft)]'}`}>
                  {logged ?? '—'}
                </span>
              </div>
            );
          })}
        </div>
      </button>
      <div className="flex items-center gap-2 pt-[var(--cal-space-xxs)] border-t border-[var(--cal-hairline-soft)]">
        <label className="flex items-center gap-1 text-[11px] text-[var(--cal-muted)]">
          <input
            type="checkbox"
            data-testid={`sessions-select-${workout.id}`}
            checked={selected}
            disabled={!canCopy}
            onChange={(event) => onToggleSelected(event.target.checked)}
            className="accent-[var(--cal-accent)]"
          />
          Select
        </label>
        <button
          type="button"
          data-testid={`sessions-copy-to-${workout.id}`}
          disabled={!canCopy}
          onClick={onCopyTo}
          className={`h-7 px-2 text-[11px] rounded-[var(--cal-radius-md)] disabled:opacity-40 ${
            canCopy
              ? 'text-[var(--cal-ink)] bg-[var(--cal-surface-strong)] hover:opacity-90'
              : 'text-[var(--cal-muted)] bg-[var(--cal-surface-soft)]'
          }`}
        >
          Copy to
        </button>
        <button
          type="button"
          data-testid={`sessions-edit-${workout.id}`}
          onClick={onEdit}
          className="h-7 px-2 text-[11px] text-[var(--cal-muted)] hover:text-[var(--cal-ink)] rounded-[var(--cal-radius-md)]"
        >
          Edit
        </button>
      </div>
    </div>
  );
}

function WeekRow({
  rowKey,
  weekLabel,
  count,
  canCopy,
  onCopyWeek,
}: {
  rowKey: string;
  weekLabel: string;
  count: number;
  canCopy: boolean;
  onCopyWeek: () => void;
}) {
  return (
    <div
      data-testid={`sessions-week-row-${rowKey}`}
      className="min-h-8 px-[var(--cal-space-xxs)] flex items-center justify-between gap-2"
    >
      <h4 className="text-xs font-semibold text-[var(--cal-ink)]">Week {weekLabel}</h4>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid={`sessions-copy-week-${rowKey}`}
          disabled={!canCopy}
          onClick={onCopyWeek}
          className={copyBtnClass}
        >
          Copy week
        </button>
        <span className="text-[10px] tnum text-[var(--cal-muted)]">
          {count} session{count !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}

function BlockHeader({
  blockLabel,
  count,
  canCopy,
  onCopyBlock,
}: {
  blockLabel: string;
  count: number;
  canCopy: boolean;
  onCopyBlock: () => void;
}) {
  return (
    <div
      data-testid={`sessions-block-row-${blockLabel}`}
      className="min-h-8 px-[var(--cal-space-xxs)] flex items-center justify-between gap-2"
    >
      <h3 className="text-sm font-semibold tracking-tight text-[var(--cal-ink)]">Block {blockLabel}</h3>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid={`sessions-copy-block-${blockLabel}`}
          disabled={!canCopy}
          onClick={onCopyBlock}
          className={copyBtnClass}
        >
          Copy block
        </button>
        <span className="text-[10px] tnum text-[var(--cal-muted)]">
          {count} session{count !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}

export function SessionsView({
  onViewSession,
  filter,
  onFilterChange,
  onStartCopy,
}: SessionsViewProps) {
  const {
    microcycles,
    activeWorkoutId,
    reloadMicrocycles,
    activeAthleteId,
    planAthleteId,
  } = usePeriodization();
  const { isOnline } = useSync();

  const [editingSession, setEditingSession] = useState<WorkoutData | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { user } = useAuth();
  const isCoach = String(user?.role || getUiPref(UI_KEYS.role) || '').toUpperCase() === 'COACH';

  const allSessions = useMemo(() => {
    const entries: SessionEntry[] = [];
    microcycles.forEach((micro) => {
      micro.workouts.forEach((workout) => {
        entries.push({ workout, microId: micro.id });
      });
    });
    return entries
      .filter(({ workout }) => workoutPassesFilter(workout, filter))
      .sort((a, b) => a.workout.date.localeCompare(b.workout.date));
  }, [microcycles, filter]);

  const groupedSessions = useMemo(
    () => groupLabeledSessions<SessionEntry>(allSessions, (entry) => entry.workout),
    [allSessions],
  );

  const showCoachSelectAthlete = isCoach && !activeAthleteId;
  const [showNewSession, setShowNewSession] = useState(false);
  const canCopy = isOnline && !showCoachSelectAthlete;

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const startDayCopy = (workouts: WorkoutData[]) => {
    if (!canCopy || workouts.length === 0) return;
    onStartCopy(buildDayClipboard(workouts, getRecentBlock(planAthleteId)));
  };

  const startWeekCopy = (entries: SessionEntry[]) => {
    const workouts = entries.map(({ workout }) => workout);
    if (!canCopy || workouts.length === 0) return;
    onStartCopy(buildWeekClipboard(workouts, getRecentBlock(planAthleteId)));
  };

  const startBlockCopy = (entries: SessionEntry[], blockLabel: string) => {
    const workouts = entries.map(({ workout }) => workout);
    if (!canCopy || workouts.length === 0) return;
    onStartCopy(buildBlockClipboard(workouts, blockLabel));
  };

  const renderSessionCard = ({ workout, microId }: SessionEntry) => (
    <SessionCard
      key={workout.id}
      workout={workout}
      microId={microId}
      active={activeWorkoutId === workout.id}
      canCopy={canCopy}
      selected={selectedIds.has(workout.id)}
      onOpen={() => onViewSession(workout, microId)}
      onToggleSelected={(checked) => toggleSelected(workout.id, checked)}
      onCopyTo={() => startDayCopy([workout])}
      onEdit={() => setEditingSession(workout)}
    />
  );

  return (
    <div className="flex-1 flex relative h-full overflow-hidden bg-[var(--cal-canvas)]">
      <div className="flex-1 overflow-y-auto p-[var(--cal-space-sm)]">
        <div className="space-y-[var(--cal-space-sm)] pb-[var(--cal-space-lg)]">
          <div className="min-h-7 px-[var(--cal-space-xxs)] flex items-center justify-between gap-2">
            <LiftFilter value={filter} onChange={onFilterChange} />
          </div>

          {!showCoachSelectAthlete && (
            <div className="px-[var(--cal-space-xxs)] flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="sessions-add"
                onClick={() => setShowNewSession(true)}
                className="h-7 px-3 rounded-[var(--cal-radius-md)] bg-[color-mix(in_srgb,var(--cal-accent)_15%,transparent)] text-[var(--cal-accent)] text-[11px] font-medium hover:bg-[color-mix(in_srgb,var(--cal-accent)_25%,transparent)] transition-colors"
              >
                Add session
              </button>
              {selectedIds.size > 0 ? (
                <button
                  type="button"
                  data-testid="sessions-copy-selected"
                  disabled={!canCopy}
                  onClick={() => {
                    const selected = allSessions
                      .filter(({ workout }) => selectedIds.has(workout.id))
                      .map(({ workout }) => workout);
                    startDayCopy(selected);
                  }}
                  className="h-7 px-3 rounded-[var(--cal-radius-md)] bg-[var(--cal-surface-strong)] text-[var(--cal-ink)] text-[11px] font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  Copy selected
                </button>
              ) : null}
              {!isOnline ? (
                <p data-testid="copy-offline" className="w-full text-[10px] text-[var(--cal-warning)]">
                  Connect to copy sessions.
                </p>
              ) : null}
            </div>
          )}

          {showCoachSelectAthlete ? (
            <div
              data-testid="sessions-empty"
              className="border border-[var(--cal-hairline)] rounded-[var(--cal-radius-lg)] p-6 text-center bg-[var(--cal-surface-soft)]"
            >
              <p className="text-sm text-[var(--cal-ink)] mb-1">Select an athlete</p>
              <p className="text-xs text-[var(--cal-muted)]">Use the athlete switcher in the sidebar to load a plan.</p>
            </div>
          ) : allSessions.length === 0 ? (
            <div
              data-testid="sessions-empty"
              className="border border-[var(--cal-hairline)] rounded-[var(--cal-radius-lg)] p-6 text-center bg-[var(--cal-surface-soft)]"
            >
              <p className="text-sm text-[var(--cal-ink)] mb-1">No sessions yet</p>
              <p className="text-xs text-[var(--cal-muted)]">Add session. Block/Week can wait.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-[var(--cal-space-lg)]">
              {groupedSessions.blocks.map((block) => (
                <section key={`block-${block.blockLabel}`} className="flex flex-col gap-[var(--cal-space-xs)]">
                  <BlockHeader
                    blockLabel={block.blockLabel}
                    count={block.all.length}
                    canCopy={canCopy}
                    onCopyBlock={() => startBlockCopy(block.all, block.blockLabel)}
                  />
                  <div className={blockCardClass}>
                    {block.weeks.map((week) => {
                      const rowKey = weekRowKey(block.blockLabel, week.weekLabel);
                      return (
                        <div key={rowKey} className={weekCardClass}>
                          <WeekRow
                            rowKey={rowKey}
                            weekLabel={week.weekLabel}
                            count={week.items.length}
                            canCopy={canCopy}
                            onCopyWeek={() => startWeekCopy(week.items)}
                          />
                          <div className="flex flex-col gap-[var(--cal-space-xs)]">
                            {week.items.map(renderSessionCard)}
                          </div>
                        </div>
                      );
                    })}
                    {block.noWeek.length > 0 ? (
                      <div className="flex flex-col gap-[var(--cal-space-xs)]">
                        {block.noWeek.map(renderSessionCard)}
                      </div>
                    ) : null}
                  </div>
                </section>
              ))}
              {groupedSessions.weeksNoBlock.map((week) => {
                const rowKey = weekRowKey('', week.weekLabel);
                return (
                  <section key={rowKey} className="flex flex-col gap-[var(--cal-space-xs)]">
                    <div className={weekCardClass}>
                      <WeekRow
                        rowKey={rowKey}
                        weekLabel={week.weekLabel}
                        count={week.items.length}
                        canCopy={canCopy}
                        onCopyWeek={() => startWeekCopy(week.items)}
                      />
                      <div className="flex flex-col gap-[var(--cal-space-xs)]">
                        {week.items.map(renderSessionCard)}
                      </div>
                    </div>
                  </section>
                );
              })}
              {groupedSessions.unlabeled.length > 0 ? (
                <section className="flex flex-col gap-[var(--cal-space-xs)]">
                  <div className="min-h-8 px-[var(--cal-space-xxs)] flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold tracking-tight text-[var(--cal-ink)]">Ungrouped</h3>
                    <span className="text-[10px] tnum text-[var(--cal-muted)]">
                      {groupedSessions.unlabeled.length} session{groupedSessions.unlabeled.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="flex flex-col gap-[var(--cal-space-xs)]">
                    {groupedSessions.unlabeled.map(renderSessionCard)}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </div>
      </div>
      {showNewSession && (
        <NewSessionDialog
          date={new Date().toISOString().slice(0, 10)}
          allowDateEdit
          athleteId={planAthleteId}
          onClose={() => setShowNewSession(false)}
          onCreated={async () => {
            await reloadMicrocycles(planAthleteId);
            setShowNewSession(false);
          }}
        />
      )}
      {editingSession && (
        <EditSessionDialog
          session={editingSession}
          onClose={() => setEditingSession(null)}
          onSaved={async () => {
            await reloadMicrocycles(planAthleteId);
            setEditingSession(null);
          }}
          onDeleted={async () => {
            await reloadMicrocycles(planAthleteId);
            setEditingSession(null);
          }}
        />
      )}
    </div>
  );
}
