import { useMemo, useState } from 'react';
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

function liftColor(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('squat')) return 'text-[#007aff]';
  if (t.includes('bench')) return 'text-[#54e083]';
  if (t.includes('dead')) return 'text-[#F5A623]';
  return 'text-[#AEAEB2]';
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
      className={`py-2 px-1 flex flex-col gap-2 ${active ? 'bg-[#161616]' : ''}`}
    >
      <button type="button" onClick={onOpen} className="text-left flex flex-col gap-1 hover:opacity-90">
        <div className="flex items-center justify-between gap-2 h-6">
          <span className="text-xs text-white truncate">{workout.date}</span>
          <span className="text-[10px] font-mono text-[#AEAEB2] shrink-0">
            {workout.status} · {workout.tonnage}kg
          </span>
        </div>
        <p className="text-xs text-white truncate">{workout.title || 'Session'}</p>
        <p className="text-[10px] text-[#AEAEB2] truncate">{labels || 'No block/week'}</p>
        <div className="flex flex-col gap-0.5">
          {workout.exercises.map((ex) => {
            const { planned, logged } = setLine(ex);
            return (
              <div key={ex.id} className="flex items-center gap-2 font-mono text-[11px] leading-tight min-h-5">
                <span className={`${liftColor(ex.title)} w-6 shrink-0`}>{liftAbbrev(ex.title)}</span>
                <span className="text-white truncate flex-1 min-w-0" title={ex.title}>{ex.title}</span>
                <span className="text-[#AEAEB2] shrink-0">{planned}</span>
                <span className={`shrink-0 ${logged ? 'text-white' : 'text-[#636366]'}`}>{logged ?? '—'}</span>
              </div>
            );
          })}
        </div>
      </button>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-[11px] text-[#AEAEB2]">
          <input
            type="checkbox"
            data-testid={`sessions-select-${workout.id}`}
            checked={selected}
            disabled={!canCopy}
            onChange={(event) => onToggleSelected(event.target.checked)}
          />
          Select
        </label>
        <button
          type="button"
          data-testid={`sessions-copy-to-${workout.id}`}
          disabled={!canCopy}
          onClick={onCopyTo}
          className="h-7 px-2 text-[11px] text-white bg-white/15 rounded disabled:opacity-40"
        >
          Copy to
        </button>
        <button
          type="button"
          data-testid={`sessions-edit-${workout.id}`}
          onClick={onEdit}
          className="h-7 px-2 text-[11px] text-[#AEAEB2] hover:text-white"
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
      className="min-h-8 px-1 flex items-center justify-between gap-2"
    >
      <h4 className="text-xs text-white">Week {weekLabel}</h4>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid={`sessions-copy-week-${rowKey}`}
          disabled={!canCopy}
          onClick={onCopyWeek}
          className="h-6 px-2 rounded bg-white/10 text-white text-[10px] disabled:opacity-40"
        >
          Copy week
        </button>
        <span className="text-[10px] font-mono text-[#AEAEB2]">{count} session{count !== 1 ? 's' : ''}</span>
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

  return (
    <div className="flex-1 flex relative h-full overflow-hidden bg-[#0A0A0A]">
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-2 pb-8">
          <div className="h-7 px-1 flex items-center justify-between gap-2">
            <LiftFilter value={filter} onChange={onFilterChange} />
          </div>

          {!showCoachSelectAthlete && (
            <div className="px-1 flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="sessions-add"
                onClick={() => setShowNewSession(true)}
                className="h-7 px-3 rounded bg-[#007AFF]/20 text-[#007AFF] text-[11px] hover:bg-[#007AFF]/30"
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
                  className="h-7 px-3 rounded bg-white/10 text-white text-[11px] disabled:opacity-40"
                >
                  Copy selected
                </button>
              ) : null}
              {!isOnline ? (
                <p data-testid="copy-offline" className="w-full text-[10px] text-[#F5A623]">Connect to copy sessions.</p>
              ) : null}
            </div>
          )}

          {showCoachSelectAthlete ? (
            <div
              data-testid="sessions-empty"
              className="border border-white/10 rounded p-6 text-center"
            >
              <p className="text-sm text-white mb-1">Select an athlete</p>
              <p className="text-xs text-[#AEAEB2]">Use the athlete switcher in the sidebar to load a plan.</p>
            </div>
          ) : allSessions.length === 0 ? (
            <div
              data-testid="sessions-empty"
              className="border border-white/10 rounded p-6 text-center"
            >
              <p className="text-sm text-white mb-1">No sessions yet</p>
              <p className="text-xs text-[#AEAEB2]">Add session. Block/Week can wait.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {groupedSessions.blocks.map((block) => (
                <section key={`block-${block.blockLabel}`}>
                  <div
                    data-testid={`sessions-block-row-${block.blockLabel}`}
                    className="min-h-8 px-1 flex items-center justify-between gap-2"
                  >
                    <h4 className="text-xs text-white">Block {block.blockLabel}</h4>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        data-testid={`sessions-copy-block-${block.blockLabel}`}
                        disabled={!canCopy}
                        onClick={() => startBlockCopy(block.all, block.blockLabel)}
                        className="h-6 px-2 rounded bg-white/10 text-white text-[10px] disabled:opacity-40"
                      >
                        Copy block
                      </button>
                      <span className="text-[10px] font-mono text-[#AEAEB2]">{block.all.length} session{block.all.length !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                  {block.weeks.map((week) => {
                    const rowKey = weekRowKey(block.blockLabel, week.weekLabel);
                    return (
                      <div key={rowKey}>
                        <WeekRow
                          rowKey={rowKey}
                          weekLabel={week.weekLabel}
                          count={week.items.length}
                          canCopy={canCopy}
                          onCopyWeek={() => startWeekCopy(week.items)}
                        />
                        <div className="divide-y divide-white/10 border-t border-white/10">
                          {week.items.map(({ workout, microId }) => (
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
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {block.noWeek.length > 0 ? (
                    <div className="divide-y divide-white/10 border-t border-white/10">
                      {block.noWeek.map(({ workout, microId }) => (
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
                      ))}
                    </div>
                  ) : null}
                </section>
              ))}
              {groupedSessions.weeksNoBlock.map((week) => {
                const rowKey = weekRowKey('', week.weekLabel);
                return (
                  <section key={rowKey}>
                    <WeekRow
                      rowKey={rowKey}
                      weekLabel={week.weekLabel}
                      count={week.items.length}
                      canCopy={canCopy}
                      onCopyWeek={() => startWeekCopy(week.items)}
                    />
                    <div className="divide-y divide-white/10 border-t border-white/10">
                      {week.items.map(({ workout, microId }) => (
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
                      ))}
                    </div>
                  </section>
                );
              })}
              {groupedSessions.unlabeled.length > 0 ? (
                <section>
                  <div className="min-h-8 px-1 flex items-center justify-between gap-2">
                    <h4 className="text-xs text-white">Ungrouped</h4>
                    <span className="text-[10px] font-mono text-[#AEAEB2]">
                      {groupedSessions.unlabeled.length} session{groupedSessions.unlabeled.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="divide-y divide-white/10 border-t border-white/10">
                    {groupedSessions.unlabeled.map(({ workout, microId }) => (
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
                    ))}
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
