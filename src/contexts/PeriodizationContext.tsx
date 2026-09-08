import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { apiService } from '../services/api';
import { evictOldSyncedData } from '../services/db';
import { queueMutation } from '../services/sync_engine';
import { trainingIntOrZero, trainingOrZero } from '../services/numericTraining';
import { UI_KEYS, getUiPref, setUiPref, removeUiPref } from '../storage/uiPrefs';
import { insertWorkoutChronologically } from '../services/workoutDays';
import { importedPlanFor, pickActiveAthlete, planVersion } from '../data/athletePlans';
import { loadLocalRoster, mergeRoster, type LocalAthlete } from '../services/localRoster';
import {
  PLAN_SCHEMA,
  PlanSource,
  clearStoredPlan,
  migrateLegacyPlanSnapshot,
  planSharesStructure,
  readStoredPlan,
  reconcileImportedPlan,
  inferOwnedWorkoutIds,
  writeStoredPlan,
} from '../services/planStore';
import {
  INITIAL_MESOCYCLE,
  WorkoutData,
  MicrocycleData,
  MesocycleData,
  WorkoutStatus,
  ExerciseData,
} from '../types';

interface PeriodizationState {
  microcycles: MicrocycleData[];
  setMicrocycles: (next: MicrocycleData[] | ((prev: MicrocycleData[]) => MicrocycleData[])) => void;
  mesocycles: MesocycleData[];
  athletes: LocalAthlete[];
  rosterReady: boolean;
  activeAthleteId: string | null;
  activeAthlete: LocalAthlete | undefined;
  selectAthlete: (athleteId: string) => void;
  refreshRoster: () => Promise<void>;
  activeWorkoutId: string | null;
  setActiveWorkoutId: (id: string | null) => void;
  activeMicrocycleId: string | null;
  setActiveMicrocycleId: (id: string | null) => void;
  activeMicro: MicrocycleData | undefined;
  activeWorkout: WorkoutData | undefined;
  updateExerciseSets: (
    exerciseId: string,
    updatedSets: any[],
    scope?: { workoutId?: string; microcycleId?: string }
  ) => void;
  addExercise: (workoutId: string, microcycleId: string, exercise: ExerciseData) => void;
  addWorkout: (microcycleId: string, workout: WorkoutData) => void;
  finishSession: (
    status: WorkoutStatus,
    scope?: { workoutId?: string; microcycleId?: string }
  ) => Promise<void>;
  resetPlan: () => Promise<void>;
}

/** Provenance for the plan currently in memory, so every write lands on the right key. */
type PlanMeta = {
  athleteId: string | null;
  source: PlanSource;
  planVersion: string | null;
  ownedWorkoutIds: Set<string>;
};

const EMPTY_META: PlanMeta = {
  athleteId: null,
  source: 'local',
  planVersion: null,
  ownedWorkoutIds: new Set(),
};

const PeriodizationContext = createContext<PeriodizationState | null>(null);

export function usePeriodization(): PeriodizationState {
  const value = useContext(PeriodizationContext);
  if (!value) {
    throw new Error('usePeriodization must be used inside PeriodizationProvider');
  }
  return value;
}

export function PeriodizationProvider({ children }: { children: ReactNode }) {
  const [microcycles, setMicrocycles] = useState<MicrocycleData[]>([]);
  const [athletes, setAthletes] = useState<LocalAthlete[]>([]);
  const [rosterReady, setRosterReady] = useState(false);
  const [activeAthleteId, setActiveAthleteId] = useState<string | null>(() => getUiPref(UI_KEYS.activeAthleteId));
  const [activeWorkoutId, setActiveWorkoutId] = useState<string | null>(() => getUiPref(UI_KEYS.activeWorkoutId));
  const [activeMicrocycleId, setActiveMicrocycleId] = useState<string | null>(() => getUiPref(UI_KEYS.activeMicrocycleId));

  const mesocycles = INITIAL_MESOCYCLE;

  const planMeta = useRef<PlanMeta>(EMPTY_META);
  const planCache = useRef(new Map<string, {
    microcycles: MicrocycleData[];
    source: PlanSource;
    planVersion: string | null;
    ownedWorkoutIds: string[];
  }>());
  const hydrated = useRef(false);
  const selectGeneration = useRef(0);

  const focusPlan = (plan: MicrocycleData[]) => {
    const current = plan.find((micro) => micro.status === 'ACTIVE') ?? plan[plan.length - 1];
    if (!current) {
      setActiveMicrocycleId(null);
      setActiveWorkoutId(null);
      return;
    }
    setActiveMicrocycleId(current.id);
    setUiPref(UI_KEYS.sessionsExpandedMicro, current.id);
    const first = current.workouts[0];
    if (first) setActiveWorkoutId(first.id);
  };

  const markWorkoutEdited = (workoutId: string) => {
    planMeta.current.ownedWorkoutIds.add(workoutId);
  };

  const applyResolvedPlan = (
    athleteId: string,
    imported: ReturnType<typeof importedPlanFor>,
    stored: Awaited<ReturnType<typeof readStoredPlan>>,
    focus: boolean,
  ) => {
    if (imported) {
      const usable =
        stored && planSharesStructure(imported.microcycles, stored.microcycles) ? stored : null;
      const version = planVersion(imported.microcycles);
      const tracked = usable
        ? usable.ownedWorkoutIds.length > 0
          ? usable
          : {
              ...usable,
              ownedWorkoutIds: inferOwnedWorkoutIds(imported.microcycles, usable.microcycles),
            }
        : null;
      const plan = !tracked
        ? imported.microcycles
        : reconcileImportedPlan(imported.microcycles, tracked);
      planMeta.current = {
        athleteId,
        source: 'imported',
        planVersion: version,
        ownedWorkoutIds: new Set(tracked?.ownedWorkoutIds ?? []),
      };
      hydrated.current = true;
      setMicrocycles(plan);
      planCache.current.set(athleteId, {
        microcycles: plan,
        source: 'imported',
        planVersion: version,
        ownedWorkoutIds: Array.from(planMeta.current.ownedWorkoutIds),
      });
      const remembered = getUiPref(UI_KEYS.activeWorkoutId);
      const known = plan.some((micro) => micro.workouts.some((w) => w.id === remembered));
      if (focus || !known) focusPlan(plan);
      return;
    }

    planMeta.current = {
      athleteId,
      source: stored?.source === 'imported' || stored?.source === 'api' ? stored.source : 'local',
      planVersion: stored?.planVersion ?? null,
      ownedWorkoutIds: new Set(stored?.ownedWorkoutIds ?? []),
    };
    hydrated.current = true;
    const plan = stored?.microcycles ?? [];
    setMicrocycles(plan);
    planCache.current.set(athleteId, {
      microcycles: plan,
      source: planMeta.current.source,
      planVersion: planMeta.current.planVersion,
      ownedWorkoutIds: Array.from(planMeta.current.ownedWorkoutIds),
    });
    if (plan.length) {
      const remembered = getUiPref(UI_KEYS.activeWorkoutId);
      const known = plan.some((micro) => micro.workouts.some((w) => w.id === remembered));
      if (focus || !known) focusPlan(plan);
    } else {
      setActiveMicrocycleId(null);
      setActiveWorkoutId(null);
    }
  };

  const loadRoster = async (): Promise<LocalAthlete[]> => {
    const local = await loadLocalRoster();
    let remote: Array<{ id: string; email?: string; activeMicrocycles?: number }> = [];
    try {
      remote = await apiService.fetchRoster();
    } catch (err) {
      console.warn('Failed to refresh roster from backend:', err);
    }
    return mergeRoster(remote, local);
  };

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        await evictOldSyncedData();
      } catch (err) {
        console.warn('Failed to evict old synced mutations on launch:', err);
      }

      const roster = await loadRoster();
      if (cancelled) return;
      setAthletes(roster);

      const athlete = pickActiveAthlete(roster, getUiPref(UI_KEYS.activeAthleteId));
      if (!athlete) {
        await migrateLegacyPlanSnapshot(null, null);
        planMeta.current = EMPTY_META;
        hydrated.current = true;
        setActiveAthleteId(null);
        setMicrocycles([]);
        setRosterReady(true);
        return;
      }

      setActiveAthleteId(athlete.id);
      setUiPref(UI_KEYS.activeAthleteId, athlete.id);

      const imported = importedPlanFor(athlete.id);
      await migrateLegacyPlanSnapshot(athlete.id, imported?.microcycles ?? null);
      const stored = await readStoredPlan(athlete.id);
      if (cancelled) return;
      applyResolvedPlan(athlete.id, imported, stored, false);
      setRosterReady(true);
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    const meta = planMeta.current;
    if (meta.athleteId) {
      planCache.current.set(meta.athleteId, {
        microcycles,
        source: meta.source,
        planVersion: meta.planVersion,
        ownedWorkoutIds: Array.from(meta.ownedWorkoutIds),
      });
    }
    if (meta.source === 'imported' && microcycles.length === 0) return;
    void writeStoredPlan({
      schema: PLAN_SCHEMA,
      athleteId: meta.athleteId,
      source: meta.source,
      planVersion: meta.planVersion,
      ownedWorkoutIds: Array.from(meta.ownedWorkoutIds),
      microcycles,
    });
  }, [microcycles]);

  useEffect(() => {
    if (activeWorkoutId) setUiPref(UI_KEYS.activeWorkoutId, activeWorkoutId);
  }, [activeWorkoutId]);

  useEffect(() => {
    if (activeMicrocycleId) setUiPref(UI_KEYS.activeMicrocycleId, activeMicrocycleId);
  }, [activeMicrocycleId]);

  const activeMicro = microcycles.find(m => m.id === activeMicrocycleId);
  const activeWorkout = activeMicro?.workouts.find(w => w.id === activeWorkoutId);

  const updateExerciseSets = (
    exerciseId: string,
    updatedSets: any[],
    scope?: { workoutId?: string; microcycleId?: string }
  ) => {
    const workoutId = scope?.workoutId ?? activeWorkoutId;
    if (!workoutId) return;
    markWorkoutEdited(workoutId);

    setMicrocycles(prev => prev.map(m => {
      const inThisMicro = m.workouts.some(w => w.id === workoutId);
      if (!inThisMicro) return m;
      if (scope?.microcycleId && m.id !== scope.microcycleId) return m;
      return {
        ...m,
        workouts: m.workouts.map(w => {
          if (w.id !== workoutId) return w;

          const updatedExercises = w.exercises.map(ex => {
            if (ex.id !== exerciseId) return ex;

            const topSet = updatedSets.find(s => s.isTop) || updatedSets[0];
            const topLabel = topSet ? `${topSet.actual || topSet.plannedWeight || '---'}kg x ${topSet.reps || topSet.plannedReps || '—'}` : '---';
            const totalVol = updatedSets.reduce((acc, s) => {
              const wt = trainingOrZero(s.actual ?? s.suggestedWeight);
              const rp = trainingIntOrZero(s.reps);
              return acc + (wt * rp);
            }, 0);

            return {
              ...ex,
              sets: updatedSets,
              top: topLabel,
              vol: `${totalVol.toLocaleString()}kg`
            };
          });

          const primaryTonnage = updatedExercises.reduce((acc, ex) => {
            return acc + ex.sets.reduce((sum, s) => {
              const wt = trainingOrZero(s.actual ?? s.suggestedWeight);
              const rp = trainingIntOrZero(s.reps);
              return sum + (wt * rp);
            }, 0);
          }, 0);

          return {
            ...w,
            exercises: updatedExercises,
            tonnage: primaryTonnage
          };
        })
      };
    }));

    void queueMutation(workoutId, 'ExerciseSet', exerciseId, { sets: updatedSets });
  };

  const addExercise = (workoutId: string, microcycleId: string, exercise: ExerciseData) => {
    markWorkoutEdited(workoutId);
    setMicrocycles((prev) =>
      prev.map((m) => {
        if (m.id !== microcycleId) return m;
        return {
          ...m,
          workouts: m.workouts.map((w) => {
            if (w.id !== workoutId) return w;
            return { ...w, exercises: [...w.exercises, exercise] };
          }),
        };
      })
    );
    void queueMutation(workoutId, 'Exercise', exercise.id, { exercise });
  };

  const addWorkout = (microcycleId: string, workout: WorkoutData) => {
    markWorkoutEdited(workout.id);
    let labeled: WorkoutData = workout;
    setMicrocycles((prev) =>
      prev.map((m) => {
        if (m.id !== microcycleId) return m;
        const workouts = insertWorkoutChronologically(m.workouts, workout);
        labeled = workouts.find((w) => w.id === workout.id) ?? workout;
        return { ...m, workouts };
      })
    );
    setActiveWorkoutId(workout.id);
    setActiveMicrocycleId(microcycleId);
    void queueMutation(workout.id, 'Workout', workout.id, { workout: labeled });
  };

  const finishSession = async (
    status: WorkoutStatus,
    scope?: { workoutId?: string; microcycleId?: string }
  ) => {
    const workoutId = scope?.workoutId ?? activeWorkoutId;
    if (!workoutId) return;
    markWorkoutEdited(workoutId);

    let updatedWorkoutData: WorkoutData | null = null;

    setMicrocycles(prev => prev.map(m => {
      const inThisMicro = m.workouts.some(w => w.id === workoutId);
      if (!inThisMicro) return m;
      if (scope?.microcycleId && m.id !== scope.microcycleId) return m;
      return {
        ...m,
        workouts: m.workouts.map(w => {
          if (w.id !== workoutId) return w;
          const newWorkout = {
            ...w,
            status,
            color: status === 'COMPLETED' ? 'mac-green' as const : 'mac-blue' as const
          };
          updatedWorkoutData = newWorkout;
          return newWorkout;
        })
      };
    }));

    if (updatedWorkoutData) {
      try {
        await apiService.saveLog(updatedWorkoutData);
      } catch (err) {
        console.error('Failed to save workout log to backend', err);
      }
    }
  };

  /** The only path that deliberately throws away logged work. */
  const resetPlan = async () => {
    const athleteId = planMeta.current.athleteId;
    const imported = importedPlanFor(athleteId);
    if (imported) {
      await clearStoredPlan(imported.athleteId);
      planMeta.current = {
        athleteId: imported.athleteId,
        source: 'imported',
        planVersion: planVersion(imported.microcycles),
        ownedWorkoutIds: new Set(),
      };
      setMicrocycles(imported.microcycles);
      focusPlan(imported.microcycles);
      return;
    }

    if (athleteId) {
      await clearStoredPlan(athleteId);
      planMeta.current = { athleteId, source: 'local', planVersion: null, ownedWorkoutIds: new Set() };
      setMicrocycles([]);
      setActiveMicrocycleId(null);
      setActiveWorkoutId(null);
      return;
    }

    await clearStoredPlan(null);
    planMeta.current = EMPTY_META;
    setMicrocycles([]);
  };

  const paintAthletePlan = (
    athleteId: string,
    cached: {
      microcycles: MicrocycleData[];
      source: PlanSource;
      planVersion: string | null;
      ownedWorkoutIds: string[];
    },
    focus: boolean,
  ) => {
    planMeta.current = {
      athleteId,
      source: cached.source,
      planVersion: cached.planVersion,
      ownedWorkoutIds: new Set(cached.ownedWorkoutIds),
    };
    hydrated.current = true;
    setMicrocycles(cached.microcycles);
    if (cached.microcycles.length) {
      if (focus) focusPlan(cached.microcycles);
    } else {
      setActiveMicrocycleId(null);
      setActiveWorkoutId(null);
    }
  };

  const selectAthlete = (athleteId: string) => {
    if (athleteId === activeAthleteId) return;
    const generation = ++selectGeneration.current;
    setActiveAthleteId(athleteId);
    setUiPref(UI_KEYS.activeAthleteId, athleteId);

    const cached = planCache.current.get(athleteId);
    if (cached) {
      paintAthletePlan(athleteId, cached, true);
      return;
    }

    void (async () => {
      const imported = importedPlanFor(athleteId);
      const stored = await readStoredPlan(athleteId);
      if (generation !== selectGeneration.current) return;
      applyResolvedPlan(athleteId, imported, stored, true);
    })();
  };

  const refreshRoster = async () => {
    const roster = await loadRoster();
    setAthletes(roster);
    if (activeAthleteId && !roster.some((row) => row.id === activeAthleteId)) {
      const next = pickActiveAthlete(roster, null);
      if (next) selectAthlete(next.id);
      else {
        setActiveAthleteId(null);
        removeUiPref(UI_KEYS.activeAthleteId);
        setMicrocycles([]);
      }
    }
  };

  return (
    <PeriodizationContext.Provider
      value={{
        microcycles,
        setMicrocycles,
        mesocycles,
        athletes,
        rosterReady,
        activeAthleteId,
        activeAthlete: athletes.find((row) => row.id === activeAthleteId),
        selectAthlete,
        refreshRoster,
        activeWorkoutId,
        setActiveWorkoutId,
        activeMicrocycleId,
        setActiveMicrocycleId,
        activeMicro,
        activeWorkout,
        updateExerciseSets,
        addExercise,
        addWorkout,
        finishSession,
        resetPlan,
      }}
    >
      {children}
    </PeriodizationContext.Provider>
  );
}
