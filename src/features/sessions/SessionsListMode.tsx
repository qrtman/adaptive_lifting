import { useMemo, useState } from 'react';
import type { ExerciseData, WorkoutData } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { usePeriodization } from '../../contexts/PeriodizationContext';
import { useSync } from '../../contexts/SyncContext';
import { apiService } from '../../services/api';
import { getUiPref, setUiPref, UI_KEYS } from '../../storage/uiPrefs';
import { LiftFilter, type LiftFilterValue } from '../../components/LiftFilter';
import { NewSessionDialog } from '../../components/NewSessionDialog';
import { EditSessionDialog } from '../../components/EditSessionDialog';
import { PATTERN_ABBREV } from '../../surface/calendar/chipLabel';
import { inspectorOverlays, INSPECTOR_SNAP_A } from '../../surface/breakpoints';
import { SessionInspector } from '../../surface/inspector/SessionInspector';
import { addSetBelow, applyCommits } from '../plan/sessionActions';
import { queueMutation } from '../../services/sync_engine';
import type { GridCommit } from '../../surface/grid/gridTypes';
import type { MovementPattern } from '../../services/exerciseCatalog';

type SessionEntry = { workout: WorkoutData; microId: string };

function sessionGroupKey(workout: WorkoutData): string {
  const block = workout.blockLabel?.trim() || '';
  const week = workout.weekLabel?.trim() || '';
  if (!block && !week) return 'Ungrouped';
  return `${block}/${week}`;
}

function sessionGroupLabel(key: string): string {
  if (key === 'Ungrouped') return 'Ungrouped';
  const [block, week] = key.split('/');
  const parts = [];
  if (block) parts.push(`Block ${block}`);
  if (week) parts.push(`Week ${week}`);
  return parts.join(' · ') || key;
}

function setLine(ex: ExerciseData): { planned: string; logged: string | null } {
  const set = ex.sets[0];
  const planned = `${set?.plannedWeight ?? '—'}×${set?.plannedReps ?? '—'}@${set?.plannedRpe ?? '—'}`;
  if (set?.actual != null && Number(set.actual) > 0) {
    return { planned, logged: `${set.actual}×${set.reps ?? '—'}@${set.executedRpe ?? '—'}` };
  }
  return { planned, logged: null };
}

export function SessionsListMode({
  sessionId,
  gridFocus,
  onOpenSession,
  onCloseSession,
}: {
  sessionId: string | null;
  gridFocus?: boolean;
  onOpenSession: (workout: WorkoutData, microId: string, grid?: boolean) => void;
  onCloseSession: () => void;
}) {
  const { user, roleMode } = useAuth();
  const {
    microcycles,
    activeWorkoutId,
    reloadMicrocycles,
    activeAthleteId,
    planAthleteId,
    setActiveWorkoutId,
    setActiveMicrocycleId,
    updateExerciseSets,
    finishSession,
    activeWorkout,
  } = usePeriodization();
  const { isOnline, locks, conflicts } = useSync();
  const [filter, setFilter] = useState<LiftFilterValue>('All');
  const [editingSession, setEditingSession] = useState<WorkoutData | null>(null);
  const [showNewSession, setShowNewSession] = useState(false);
  const [copyingKey, setCopyingKey] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copyOffsetDays, setCopyOffsetDays] = useState<Record<string, number>>({});
  const [inspectorWidth, setInspectorWidth] = useState(() => Number(getUiPref(UI_KEYS.inspectorWidth)) || INSPECTOR_SNAP_A);
  const overlay = typeof window !== 'undefined' ? inspectorOverlays(window.innerWidth) : false;
  const isCoach = String(user?.role || getUiPref(UI_KEYS.role) || '').toUpperCase() === 'COACH';
  const showCoachSelectAthlete = isCoach && !activeAthleteId;

  const allSessions = useMemo(() => {
    const entries: SessionEntry[] = [];
    microcycles.forEach((micro) => {
      micro.workouts.forEach((workout) => entries.push({ workout, microId: micro.id }));
    });
    return entries
      .filter(({ workout }) => {
        if (filter === 'All') return true;
        return workout.exercises.some((ex) => {
          if (filter === 'Squat') return ex.movementPattern === 'Knee Dominant' || ex.title.toLowerCase().includes('squat');
          if (filter === 'Bench') return (ex.movementPattern || '').includes('Push') || ex.title.toLowerCase().includes('bench');
          if (filter === 'Deadlift') return ex.movementPattern === 'Hip Dominant' || ex.title.toLowerCase().includes('dead');
          return true;
        });
      })
      .sort((a, b) => a.workout.date.localeCompare(b.workout.date));
  }, [microcycles]);

  const groupedSessions = useMemo(() => {
    const groups = new Map<string, SessionEntry[]>();
    for (const entry of allSessions) {
      const key = sessionGroupKey(entry.workout);
      const list = groups.get(key) || [];
      list.push(entry);
      groups.set(key, list);
    }
    const keys = Array.from(groups.keys()).sort((a, b) => {
      if (a === 'Ungrouped') return 1;
      if (b === 'Ungrouped') return -1;
      return a.localeCompare(b);
    });
    return keys.map((key) => ({ key, label: sessionGroupLabel(key), entries: groups.get(key)! }));
  }, [allSessions]);

  const openWorkout = allSessions.find((item) => item.workout.id === sessionId)?.workout || activeWorkout;
  const locked = Boolean(sessionId && locks.some((lock) => lock.workout_id === sessionId));

  const handleCopySessions = async (copyKey: string, sessionIds: string[], includeLogs: boolean, days: number) => {
    if (showCoachSelectAthlete || sessionIds.length === 0) return;
    setCopyingKey(copyKey);
    setCopyError(null);
    try {
      await apiService.copyWeek({ sessionIds, athleteId: planAthleteId || undefined, dateOffsetDays: days, includeLogs });
      await reloadMicrocycles(planAthleteId);
    } catch (err: unknown) {
      setCopyError(err instanceof Error ? err.message : 'Failed to copy');
    } finally {
      setCopyingKey(null);
    }
  };

  const open = (workout: WorkoutData, microId: string, grid?: boolean) => {
    setActiveWorkoutId(workout.id);
    setActiveMicrocycleId(microId);
    onOpenSession(workout, microId, grid);
  };

  return (
    <div className="flex-1 flex relative h-full overflow-hidden bg-canvas">
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-2 pb-8">
          <div className="h-7 px-1 flex items-center justify-between gap-2">
            <LiftFilter value={filter} onChange={setFilter} />
          </div>
          {!showCoachSelectAthlete && (
            <div className="px-1">
              <button type="button" data-testid="sessions-add" onClick={() => setShowNewSession(true)} className="h-7 px-3 rounded bg-accent/20 text-accent text-mini hover:bg-accent/30">
                Add session
              </button>
              {copyError && <p className="w-full text-micro text-error mt-1">{copyError}</p>}
            </div>
          )}
          {showCoachSelectAthlete ? (
            <div data-testid="sessions-empty" className="border border-border rounded p-6 text-center">
              <p className="text-ui text-fg-strong mb-1">Select an athlete</p>
              <p className="text-caption text-fg-muted">Use the athlete switcher in the sidebar to load a plan.</p>
            </div>
          ) : allSessions.length === 0 ? (
            <div data-testid="sessions-empty" className="border border-border rounded p-6 text-center">
              <p className="text-ui text-fg-strong mb-1">No sessions yet</p>
              <p className="text-caption text-fg-muted">Add session. Block/Week can wait.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {groupedSessions.map(({ key, label, entries }) => (
                <section key={key}>
                  <div className="min-h-8 px-1 flex items-center justify-between gap-2">
                    <h4 className="text-caption text-fg-strong">{label}</h4>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1">
                        <span className="text-micro text-fg-subtle">Shift</span>
                        <input
                          type="number"
                          min={1}
                          data-testid={`sessions-copy-days-${key}`}
                          value={copyOffsetDays[key] ?? 7}
                          onChange={(e) => setCopyOffsetDays((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                          className="h-6 w-12 px-1 rounded bg-canvas border border-border text-mini text-fg-strong font-mono"
                        />
                        <span className="text-micro text-fg-subtle">days</span>
                      </label>
                      <button type="button" data-testid={`sessions-copy-lifts-${key}`} onClick={() => handleCopySessions(`${key}::lifts`, entries.map(({ workout }) => workout.id), false, copyOffsetDays[key] ?? 7)} disabled={copyingKey === `${key}::lifts`} className="h-6 px-2 rounded bg-accent/20 text-accent text-micro disabled:opacity-50">
                        {copyingKey === `${key}::lifts` ? 'Copying…' : 'Copy lifts'}
                      </button>
                      <button type="button" data-testid={`sessions-copy-logs-${key}`} onClick={() => handleCopySessions(`${key}::logs`, entries.map(({ workout }) => workout.id), true, copyOffsetDays[key] ?? 7)} disabled={copyingKey === `${key}::logs`} className="h-6 px-2 rounded bg-white/10 text-fg-strong text-micro disabled:opacity-50">
                        {copyingKey === `${key}::logs` ? 'Copying…' : 'Copy with logs'}
                      </button>
                      <span className="text-micro font-mono text-fg-muted">{entries.length} session{entries.length !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                  <div className="divide-y divide-border border-t border-border">
                    {entries.map(({ workout, microId }) => {
                      const labels = [workout.blockLabel, workout.weekLabel].filter(Boolean).join(' · ');
                      return (
                        <div key={workout.id} data-testid={`sessions-card-${workout.id}`} className={`py-2 px-1 flex flex-col gap-2 ${activeWorkoutId === workout.id ? 'bg-card' : ''}`}>
                          <button type="button" onClick={() => open(workout, microId)} className="text-left flex flex-col gap-1 hover:opacity-90">
                            <div className="flex items-center justify-between gap-2 h-6">
                              <span className="text-caption text-fg-strong truncate">{workout.date}</span>
                              <span className="text-micro font-mono text-fg-muted shrink-0">{workout.status} · {workout.tonnage}kg</span>
                            </div>
                            <p className="text-caption text-fg-strong truncate">{workout.title || 'Session'}</p>
                            <p className="text-micro text-fg-muted truncate">{labels || 'No block/week'}</p>
                            {workout.exercises.map((ex) => {
                              const { planned, logged } = setLine(ex);
                              const abbrev = ex.movementPattern && ex.movementPattern in PATTERN_ABBREV
                                ? PATTERN_ABBREV[ex.movementPattern]
                                : ex.title.slice(0, 3).toUpperCase();
                              return (
                                <div key={ex.id} className="flex items-center gap-2 font-mono text-mini leading-tight min-h-5">
                                  <span className="text-accent w-6 shrink-0">{abbrev}</span>
                                  <span className="text-fg-strong truncate flex-1 min-w-0">{ex.title}</span>
                                  <span className="text-fg-muted shrink-0">{planned}</span>
                                  <span className={`shrink-0 ${logged ? 'text-fg-strong' : 'text-fg-subtle'}`}>{logged ?? '—'}</span>
                                </div>
                              );
                            })}
                          </button>
                          <button type="button" data-testid={`sessions-edit-${workout.id}`} onClick={() => setEditingSession(workout)} className="self-start h-7 px-2 text-mini text-fg-muted hover:text-fg-strong">
                            Edit
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
      {openWorkout && sessionId === openWorkout.id ? (
        <SessionInspector
          workout={openWorkout}
          role={roleMode}
          locked={locked}
          lockMessage={locks.find((lock) => lock.workout_id === sessionId)?.message}
          overlay={overlay}
          width={inspectorWidth}
          gridFocus={gridFocus}
          conflicts={conflicts.filter((c) => c.workout_id === sessionId).map((c) => ({
            field: c.field_path || 'State',
            server: c.reason || 'server',
            client: 'local edit',
          }))}
          onWidth={(w) => { setInspectorWidth(w); setUiPref(UI_KEYS.inspectorWidth, String(w)); }}
          onClose={onCloseSession}
          onNotes={(notes) => {
            void queueMutation(openWorkout.id, 'Workout', openWorkout.id, { notes });
            if (isOnline) void apiService.updateSession(openWorkout.id, { notes });
          }}
          onStatus={async (status) => { await finishSession(status); onCloseSession(); }}
          onCommit={(commits: GridCommit[]) => {
            const byEx = new Map<string, GridCommit[]>();
            for (const commit of commits) {
              const list = byEx.get(commit.exerciseId) || [];
              list.push(commit);
              byEx.set(commit.exerciseId, list);
            }
            byEx.forEach((list, exerciseId) => {
              const exercise = openWorkout.exercises.find((item) => item.id === exerciseId);
              if (exercise) updateExerciseSets(exerciseId, applyCommits(exercise.sets, list));
            });
          }}
          onAddSet={(exerciseId) => {
            const exercise = openWorkout.exercises.find((item) => item.id === exerciseId);
            if (exercise) updateExerciseSets(exerciseId, addSetBelow(exercise.sets));
          }}
          onPattern={(exerciseId, value: MovementPattern) => {
            void apiService.updateSessionExercise(openWorkout.id, exerciseId, { movementPattern: value }).then(() => reloadMicrocycles(planAthleteId));
          }}
          onMoveExercise={(exerciseId, move) => {
            void apiService.updateSessionExercise(openWorkout.id, exerciseId, { move }).then(() => reloadMicrocycles(planAthleteId));
          }}
          onRemoveExercise={(exerciseId) => {
            void apiService.removeSessionExercise(openWorkout.id, exerciseId).then(() => reloadMicrocycles(planAthleteId));
          }}
          onUpdateMeta={(exerciseId, patch) => {
            void apiService.updateSessionExercise(openWorkout.id, exerciseId, patch).then(() => reloadMicrocycles(planAthleteId));
          }}
          onSaved={() => reloadMicrocycles(planAthleteId)}
          onDeleted={() => { void reloadMicrocycles(planAthleteId); onCloseSession(); }}
          onReload={() => reloadMicrocycles(planAthleteId)}
        />
      ) : null}
      {showNewSession && (
        <NewSessionDialog
          date={new Date().toISOString().slice(0, 10)}
          allowDateEdit
          athleteId={planAthleteId}
          onClose={() => setShowNewSession(false)}
          onCreated={async (created) => {
            await reloadMicrocycles(planAthleteId);
            setShowNewSession(false);
            setActiveWorkoutId(created.id);
            if (created.microcycleId) setActiveMicrocycleId(created.microcycleId);
            onOpenSession(created, created.microcycleId || '', false);
          }}
        />
      )}
      {editingSession && (
        <EditSessionDialog
          session={editingSession}
          onClose={() => setEditingSession(null)}
          onSaved={async () => { await reloadMicrocycles(planAthleteId); setEditingSession(null); }}
          onDeleted={async () => { await reloadMicrocycles(planAthleteId); setEditingSession(null); }}
        />
      )}
    </div>
  );
}
