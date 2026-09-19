import { Fragment, useMemo, useState, type CSSProperties } from 'react';
import { WorkoutData } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { usePeriodization } from '../contexts/PeriodizationContext';
import { useSync } from '../contexts/SyncContext';
import { getRecentBlock, getUiPref, UI_KEYS } from '../storage/uiPrefs';
import { LiftFilter } from './LiftFilter';
import {
  exercisePassesFilter,
  isEmptyLiftFilter,
  workoutPassesFilter,
  type LiftFilterState,
} from '../services/liftFilter';
import { NewSessionDialog } from './NewSessionDialog';
import { EditSessionDialog } from './EditSessionDialog';
import {
  buildBlockClipboard,
  buildDayClipboard,
  buildWeekClipboard,
  groupLabeledSessions,
  type CopyClipboard,
} from '../features/plan/copyClipboard';
import { formatPlanLabel } from '../features/plan/sessionLabels';
import { formatSessionStatusMeta, formatSetReadout } from '../features/plan/sessionSetReadout';

interface SessionsViewProps {
  onViewSession: (workout: WorkoutData, microId: string) => void;
  filter: LiftFilterState;
  onFilterChange: (value: LiftFilterState) => void;
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
  active,
  canCopy,
  selected,
  filter,
  onOpen,
  onToggleSelected,
  onCopyTo,
  onEdit,
}: {
  workout: WorkoutData;
  active: boolean;
  canCopy: boolean;
  selected: boolean;
  filter: LiftFilterState;
  onOpen: () => void;
  onToggleSelected: (checked: boolean) => void;
  onCopyTo: () => void;
  onEdit: () => void;
  key?: string;
}) {
  const dayLabel = formatPlanLabel('Day', workout.dayLabel);
  const statusMeta = formatSessionStatusMeta(workout.status, workout.tonnage);
  const visibleExercises = isEmptyLiftFilter(filter)
    ? workout.exercises
    : workout.exercises.filter((ex) => exercisePassesFilter(ex, filter));
  const metaBits = [dayLabel, workout.date].filter(Boolean);
  return (
    <div
      data-testid={`sessions-card-${workout.id}`}
      data-elevated={active ? 'true' : undefined}
      className={`cal-nested-card flex flex-col gap-[var(--cal-space-xs)] ${
        active ? 'ring-1 ring-[color-mix(in_srgb,var(--cal-accent)_45%,transparent)]' : ''
      }`}
    >
      <button
        type="button"
        data-testid={`sessions-open-${workout.id}`}
        onClick={onOpen}
        className="text-left flex flex-col gap-1.5 hover:opacity-90 min-w-0"
      >
        <div className="flex items-start justify-between gap-2 min-h-6">
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight text-[var(--cal-ink)] truncate">
              {workout.title || 'Session'}
            </p>
            {metaBits.length > 0 ? (
              <p className="text-[11px] tnum text-[var(--cal-muted)] truncate">{metaBits.join(' · ')}</p>
            ) : null}
          </div>
          {statusMeta ? (
            <span className="text-[10px] tnum text-[var(--cal-muted)] shrink-0 pt-0.5">{statusMeta}</span>
          ) : null}
        </div>
        {visibleExercises.length > 0 ? (
          <div className="grid grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 gap-y-0.5 min-w-0">
            <span className="text-[10px] text-[var(--cal-muted)]">#</span>
            <span
              data-testid={`sessions-plan-h-${workout.id}`}
              className="text-[10px] text-[var(--cal-muted)] text-right"
            >
              Plan
            </span>
            <span
              data-testid={`sessions-log-h-${workout.id}`}
              className="text-[10px] text-[var(--cal-muted)] text-right"
            >
              Log
            </span>
            {visibleExercises.map((ex) => {
              const sets = ex.sets;
              return (
                <Fragment key={ex.id}>
                  <div className="col-span-3 flex items-center gap-2 min-w-0 pt-1">
                    <span className="w-6 shrink-0 text-[11px] font-medium" style={liftColorStyle(ex.title)}>
                      {liftAbbrev(ex.title)}
                    </span>
                    <span className="text-[11px] font-medium text-[var(--cal-ink)] truncate" title={ex.title}>
                      {ex.title}
                    </span>
                  </div>
                  {(sets.length > 0 ? sets : [null]).map((set, index) => {
                    const planned = formatSetReadout(set?.plannedWeight, set?.plannedReps, set?.plannedRpe);
                    const logged = formatSetReadout(set?.actual, set?.reps, set?.executedRpe);
                    const rowKey = set?.id ?? `${ex.id}-empty`;
                    return (
                      <Fragment key={rowKey}>
                        <span className="tnum text-[11px] text-[var(--cal-muted)]">{index + 1}</span>
                        <span
                          data-testid={set ? `sessions-set-plan-${set.id}` : undefined}
                          className="tnum text-[11px] text-[var(--cal-muted)] text-right whitespace-nowrap"
                        >
                          {planned}
                        </span>
                        <span
                          data-testid={set ? `sessions-set-log-${set.id}` : undefined}
                          className={`tnum text-[11px] text-right whitespace-nowrap ${
                            logged === '—' ? 'text-[var(--cal-muted-soft)]' : 'text-[var(--cal-ink)]'
                          }`}
                        >
                          {logged}
                        </span>
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        ) : null}
      </button>
      <div className="flex flex-wrap items-center gap-2">
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
      active={activeWorkoutId === workout.id}
      canCopy={canCopy}
      selected={selectedIds.has(workout.id)}
      filter={filter}
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
          ) : allSessions.length === 0 && !isEmptyLiftFilter(filter) ? (
            <p data-testid="sessions-filter-empty" className="text-xs text-[var(--cal-muted)] px-[var(--cal-space-xxs)]">
              No matching sessions.
            </p>
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
