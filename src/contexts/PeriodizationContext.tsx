import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { apiService } from '../services/api';
import { evictOldSyncedData } from '../services/db';
import { queueMutation } from '../services/sync_engine';
import { trainingIntOrZero, trainingOrZero } from '../services/numericTraining';
import { UI_KEYS, getUiPref, setUiPref, removeUiPref } from '../storage/uiPrefs';
import { insertWorkoutChronologically } from '../services/workoutDays';
import { importedPlanFor, planVersion } from '../data/athletePlans';
import {
  PLAN_SCHEMA,
  PlanSource,
  clearStoredPlan,
  migrateLegacyPlanSnapshot,
  readStoredPlan,
  reconcileImportedPlan,
  writeStoredPlan,
} from '../services/planStore';
import {
  INITIAL_MICROCYCLES,
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
  loadAthletePlan: (athleteId: string) => boolean;
}

/** Provenance for the plan currently in memory, so every write lands on the right key. */
type PlanMeta = {
  athleteId: string | null;
  source: PlanSource;
  planVersion: string | null;
  ownedWorkoutIds: Set<string>;
};

const SEED_META: PlanMeta = {
  athleteId: null,
  source: 'seed',
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
  const [microcycles, setMicrocycles] = useState<MicrocycleData[]>(INITIAL_MICROCYCLES);
  const [activeWorkoutId, setActiveWorkoutId] = useState<string | null>(() => {
    return getUiPref(UI_KEYS.activeWorkoutId) || 'w-3-1';
  });
  const [activeMicrocycleId, setActiveMicrocycleId] = useState<string | null>(() => {
    return getUiPref(UI_KEYS.activeMicrocycleId) || 'micro-3';
  });

  const mesocycles = INITIAL_MESOCYCLE;

  const planMeta = useRef<PlanMeta>(SEED_META);
  /** Blocks the persistence effect until hydration knows which key to write to. */
  const hydrated = useRef(false);

  /** Point the UI at a plan's live week, used when the remembered ids are not in it. */
  const focusPlan = (plan: MicrocycleData[]) => {
    const current = plan.find((micro) => micro.status === 'ACTIVE') ?? plan[plan.length - 1];
    if (!current) return;
    setActiveMicrocycleId(current.id);
    setUiPref(UI_KEYS.sessionsExpandedMicro, current.id);
    const first = current.workouts[0];
    if (first) setActiveWorkoutId(first.id);
  };

  const markWorkoutEdited = (workoutId: string) => {
    planMeta.current.ownedWorkoutIds.add(workoutId);
  };

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        await evictOldSyncedData();
      } catch (err) {
        console.warn('Failed to evict old synced mutations on launch:', err);
      }

      const imported = importedPlanFor(getUiPref(UI_KEYS.activeAthleteId));
      const scopeId = imported?.athleteId ?? null;

      await migrateLegacyPlanSnapshot(scopeId, imported?.microcycles ?? null);
      const stored = await readStoredPlan(scopeId);
      if (cancelled) return;

      if (imported) {
        const version = planVersion(imported.microcycles);
        // A changed import reconciles itself here. Nobody has to re-open the block.
        const plan = !stored
          ? imported.microcycles
          : stored.planVersion === version
            ? stored.microcycles
            : reconcileImportedPlan(imported.microcycles, stored);

        planMeta.current = {
          athleteId: scopeId,
          source: 'imported',
          planVersion: version,
          ownedWorkoutIds: new Set(stored?.ownedWorkoutIds ?? []),
        };
        hydrated.current = true;
        setMicrocycles(plan);

        const remembered = getUiPref(UI_KEYS.activeWorkoutId);
        const known = plan.some((micro) => micro.workouts.some((w) => w.id === remembered));
        if (!known) focusPlan(plan);
        return;
      }

      planMeta.current = {
        athleteId: null,
        source: stored?.source ?? 'seed',
        planVersion: null,
        ownedWorkoutIds: new Set(stored?.ownedWorkoutIds ?? []),
      };
      hydrated.current = true;
      if (stored) setMicrocycles(stored.microcycles);

      try {
        const meso = await apiService.getMesocycle();
        if (cancelled || !meso?.microcycles) return;
        planMeta.current = { ...planMeta.current, source: 'api' };
        setMicrocycles(meso.microcycles);
      } catch (err) {
        console.warn('Failed to refresh mesocycle from backend (offline fallback active):', err);
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    const meta = planMeta.current;
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
    const imported = importedPlanFor(planMeta.current.athleteId);
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

    removeUiPref(UI_KEYS.activeAthleteId);
    await clearStoredPlan(null);
    planMeta.current = { athleteId: null, source: 'api', planVersion: null, ownedWorkoutIds: new Set() };
    const next = await apiService.resetMicrocycles();
    setMicrocycles(next);
  };

  /**
   * Open an athlete's block. This is navigation: it shows their saved plan and
   * keeps every logged set. Use resetPlan to go back to the import as shipped.
   */
  const loadAthletePlan = (athleteId: string): boolean => {
    const imported = importedPlanFor(athleteId);
    if (!imported) return false;
    setUiPref(UI_KEYS.activeAthleteId, athleteId);

    void (async () => {
      const stored = await readStoredPlan(athleteId);
      const version = planVersion(imported.microcycles);
      const plan = !stored
        ? imported.microcycles
        : stored.planVersion === version
          ? stored.microcycles
          : reconcileImportedPlan(imported.microcycles, stored);

      planMeta.current = {
        athleteId,
        source: 'imported',
        planVersion: version,
        ownedWorkoutIds: new Set(stored?.ownedWorkoutIds ?? []),
      };
      hydrated.current = true;
      setMicrocycles(plan);
      focusPlan(plan);
    })();

    return true;
  };

  return (
    <PeriodizationContext.Provider
      value={{
        microcycles,
        setMicrocycles,
        mesocycles,
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
        loadAthletePlan,
      }}
    >
      {children}
    </PeriodizationContext.Provider>
  );
}
