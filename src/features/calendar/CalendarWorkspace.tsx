import { useCallback, useEffect, useMemo, useState } from 'react';
import { LiftFilter, type LiftFilterValue } from '../../components/LiftFilter';
import { useAuth } from '../../contexts/AuthContext';
import { usePeriodization } from '../../contexts/PeriodizationContext';
import { useSync } from '../../contexts/SyncContext';
import { apiService } from '../../services/api';
import { queueMutation } from '../../services/sync_engine';
import { getUiPref, setUiPref, UI_KEYS } from '../../storage/uiPrefs';
import { MonthCalendar } from '../../surface/calendar/MonthCalendar';
import { QuickCreatePopover } from '../../surface/calendar/QuickCreatePopover';
import { rescheduleFields } from '../../surface/calendar/chipLabel';
import { todayIso } from '../../surface/calendar/monthModel';
import { BP_WEEK_STRIP, calendarLayout, inspectorOverlays, INSPECTOR_SNAP_B } from '../../surface/breakpoints';
import { SessionInspector } from '../../surface/inspector/SessionInspector';
import { ShortcutsOverlay } from '../../surface/ShortcutsOverlay';
import type { WorkoutData } from '../../types';
import type { MovementPattern } from '../../services/exerciseCatalog';
import { addSetBelow, applyCommits, flattenSessions } from '../plan/sessionActions';
import { usePlanLive } from '../plan/usePlanLive';
import type { GridCommit } from '../../surface/grid/gridTypes';

function useWidth() {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

export function CalendarWorkspace({
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
    setMicrocycles,
    activeAthleteId,
    planAthleteId,
    reloadMicrocycles,
    setActiveWorkoutId,
    setActiveMicrocycleId,
    updateExerciseSets,
    finishSession,
    activeWorkout,
  } = usePeriodization();
  const { isOnline, locks, conflicts } = useSync();
  const viewport = useWidth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [focusedIso, setFocusedIso] = useState(todayIso(now));
  const [filter, setFilter] = useState<LiftFilterValue>('All');
  const [createIso, setCreateIso] = useState<string | null>(null);
  const [createFocusNotes, setCreateFocusNotes] = useState(false);
  const [focusInspectorNotes, setFocusInspectorNotes] = useState(false);
  const [popoverIso, setPopoverIso] = useState<string | null>(null);
  const [copySource, setCopySource] = useState<WorkoutData | null>(null);
  const [copyWithLogs, setCopyWithLogs] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [inspectorWidth, setInspectorWidth] = useState(() => Number(getUiPref(UI_KEYS.inspectorWidth)) || INSPECTOR_SNAP_B);
  const weekStartsOn = (Number(getUiPref(UI_KEYS.weekStartsOn) || '1') === 0 ? 0 : 1) as 0 | 1;

  const isCoach = String(user?.role || getUiPref(UI_KEYS.role) || '').toUpperCase() === 'COACH';
  const showCoachSelectAthlete = isCoach && !activeAthleteId;
  const layout = calendarLayout(viewport);
  const overlay = inspectorOverlays(viewport);

  const entries = flattenSessions(microcycles) as Array<{ workout: WorkoutData; microId: string }>;
  const sessionsByDate = useMemo(() => {
    const map = new Map<string, WorkoutData[]>();
    for (const { workout } of entries) {
      if (filter !== 'All') {
        const hit = workout.exercises.some((ex) => {
          if (filter === 'Squat') return (ex.movementPattern || '').includes('Knee') || ex.title.toLowerCase().includes('squat');
          if (filter === 'Bench') return (ex.movementPattern || '').includes('Push') || ex.title.toLowerCase().includes('bench');
          if (filter === 'Deadlift') return (ex.movementPattern || '').includes('Hip') || ex.title.toLowerCase().includes('dead');
          return true;
        });
        if (!hit && workout.exercises.length) continue;
      }
      const list = map.get(workout.date) || [];
      list.push(workout);
      map.set(workout.date, list);
    }
    return map;
  }, [entries, filter]);

  const openWorkout = entries.find((item) => item.workout.id === sessionId)?.workout || activeWorkout;
  const locked = Boolean(sessionId && locks.some((lock) => lock.workout_id === sessionId));

  useEffect(() => {
    setUiPref(UI_KEYS.inspectorWidth, String(inspectorWidth));
  }, [inspectorWidth]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '?' && (event.target as HTMLElement)?.tagName !== 'INPUT') setHelp(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  usePlanLive(planAthleteId, sessionId, (workoutId) => {
    if (workoutId) {
      setHighlight(new Set([workoutId]));
      window.setTimeout(() => setHighlight(new Set()), 200);
    }
    void reloadMicrocycles(planAthleteId);
  });

  const open = (workout: WorkoutData, grid?: boolean, notes?: boolean) => {
    const microId = entries.find((item) => item.workout.id === workout.id)?.microId || '';
    setActiveWorkoutId(workout.id);
    setActiveMicrocycleId(microId);
    setFocusInspectorNotes(Boolean(notes));
    onOpenSession(workout, microId, grid);
  };

  const startCreate = (iso: string, notes = false) => {
    if (copySource || showCoachSelectAthlete) return;
    setPopoverIso(null);
    setCreateFocusNotes(notes);
    setCreateIso(iso);
  };

  const handleNote = (iso: string) => {
    const list = sessionsByDate.get(iso) || [];
    if (!list.length) {
      startCreate(iso, true);
      return;
    }
    if (list.length === 1) {
      setPopoverIso(null);
      open(list[0], false, true);
      return;
    }
    setPopoverIso(iso);
  };

  const reschedule = async (workout: WorkoutData, date: string) => {
    const fields = rescheduleFields(date);
    setMicrocycles((prev) => prev.map((micro) => ({
      ...micro,
      workouts: micro.workouts.map((item) => item.id === workout.id ? { ...item, date } : item),
    })));
    void queueMutation(workout.id, 'Workout', workout.id, fields);
    try {
      await apiService.updateSession(workout.id, fields);
      await reloadMicrocycles(planAthleteId);
    } catch (err) {
      console.error(err);
    }
  };

  const copyToDate = async (dateStr: string) => {
    if (!copySource) return;
    if (dateStr === copySource.date) {
      setCopyError('Pick a different day.');
      return;
    }
    setCopyBusy(true);
    const start = new Date(`${copySource.date}T00:00:00`);
    const end = new Date(`${dateStr}T00:00:00`);
    const offset = Math.round((end.getTime() - start.getTime()) / 86400000);
    try {
      await apiService.copyWeek({
        sessionIds: [copySource.id],
        athleteId: planAthleteId || undefined,
        dateOffsetDays: offset,
        targetBlockLabel: copySource.blockLabel ?? null,
        targetWeekLabel: copySource.weekLabel ?? null,
        includeLogs: copyWithLogs,
      });
      await reloadMicrocycles(planAthleteId);
      setCopySource(null);
      setCopyError(null);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : 'Failed to copy');
    } finally {
      setCopyBusy(false);
    }
  };

  const handleOpenDay = (iso: string) => {
    if (copySource) void copyToDate(iso);
  };

  const onCommit = useCallback((commits: GridCommit[]) => {
    const byEx = new Map<string, GridCommit[]>();
    for (const commit of commits) {
      const list = byEx.get(commit.exerciseId) || [];
      list.push(commit);
      byEx.set(commit.exerciseId, list);
    }
    byEx.forEach((list, exerciseId) => {
      const exercise = openWorkout?.exercises.find((item) => item.id === exerciseId);
      if (!exercise) return;
      updateExerciseSets(exerciseId, applyCommits(exercise.sets, list));
    });
  }, [openWorkout, updateExerciseSets]);

  return (
    <div className="flex-1 flex overflow-hidden relative bg-canvas" data-testid="calendar-workspace">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex justify-end px-2 pt-1">
          <LiftFilter value={filter} onChange={setFilter} />
        </div>
        {copySource ? (
          <div data-testid="copy-to-banner" className="min-h-8 px-2 py-1 flex flex-wrap items-center justify-between gap-2 text-mini text-fg-strong bg-accent/15 border border-accent/40 rounded mx-1">
            <span>Copy {copySource.title} — click a day{copyBusy ? ' · Copying…' : ''}{copyError ? ` · ${copyError}` : ''}</span>
            <div className="flex gap-2">
              <button type="button" data-testid="copy-to-lifts" onClick={() => setCopyWithLogs(false)} className={`h-6 px-2 rounded ${!copyWithLogs ? 'bg-accent/20 text-fg-strong' : 'text-fg-muted'}`}>Lifts only</button>
              <button type="button" data-testid="copy-to-logs" onClick={() => setCopyWithLogs(true)} className={`h-6 px-2 rounded ${copyWithLogs ? 'bg-accent/20 text-fg-strong' : 'text-fg-muted'}`}>With logs</button>
              <button type="button" data-testid="copy-to-cancel" onClick={() => setCopySource(null)} className="h-6 px-2 text-fg-muted">Cancel</button>
            </div>
          </div>
        ) : null}
        <MonthCalendar
          year={year}
          month={month}
          weekStartsOn={weekStartsOn}
          layout={layout}
          focusedIso={focusedIso}
          sessionsByDate={sessionsByDate}
          highlightedIds={highlight}
          copyMode={Boolean(copySource)}
          popoverIso={popoverIso}
          empty={showCoachSelectAthlete}
          onYearMonth={({ year: y, month: m }) => { setYear(y); setMonth(m); }}
          onFocus={setFocusedIso}
          onOpenDay={handleOpenDay}
          onCreate={(iso) => startCreate(iso)}
          onNote={handleNote}
          onOpenSession={(workout) => open(workout, false)}
          onOpenGrid={(workout) => open(workout, true)}
          onOpenNotes={(workout) => {
            setPopoverIso(null);
            open(workout, false, true);
          }}
          onReschedule={reschedule}
          onCopy={setCopySource}
          onPopoverIso={setPopoverIso}
        />
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
          focusNotes={focusInspectorNotes}
          conflicts={conflicts.filter((c) => c.workout_id === sessionId).map((c) => ({
            field: c.field_path || 'State',
            server: c.reason || 'server',
            client: 'local edit',
          }))}
          onWidth={setInspectorWidth}
          onClose={() => {
            setFocusInspectorNotes(false);
            onCloseSession();
          }}
          onNotes={(notes) => {
            void queueMutation(openWorkout.id, 'Workout', openWorkout.id, { notes });
            if (isOnline) void apiService.updateSession(openWorkout.id, { notes });
          }}
          onStatus={async (status) => {
            await finishSession(status);
            onCloseSession();
          }}
          onCommit={onCommit}
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
      {createIso ? (
        <QuickCreatePopover
          date={createIso}
          athleteId={planAthleteId}
          overlay={overlay}
          focusNotes={createFocusNotes}
          online={isOnline}
          onClose={() => {
            setCreateIso(null);
            setCreateFocusNotes(false);
          }}
          onCreated={async (created) => {
            setCreateIso(null);
            setCreateFocusNotes(false);
            setInspectorWidth(INSPECTOR_SNAP_B);
            setActiveWorkoutId(created.id);
            if (created.microcycleId) setActiveMicrocycleId(created.microcycleId);
            if (createFocusNotes || created.notes) setFocusInspectorNotes(true);
            await reloadMicrocycles(planAthleteId);
            onOpenSession(created, created.microcycleId || '', false);
          }}
        />
      ) : null}
      {help ? <ShortcutsOverlay onClose={() => setHelp(false)} /> : null}
      <span className="sr-only" data-bp={BP_WEEK_STRIP}>{layout}</span>
    </div>
  );
}
