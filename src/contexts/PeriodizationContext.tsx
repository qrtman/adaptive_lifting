import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiService } from '../services/api';
import { saveSnapshot, getSnapshot, evictOldSyncedData } from '../services/db';
import { queueMutation } from '../services/sync_engine';
import { trainingIntOrZero, trainingOrZero } from '../services/numericTraining';
import { deriveBaselineE1RM, exerciseCategoryOf } from '../services/exerciseLibrary';
import { UI_KEYS, getUiPref, setUiPref } from '../storage/uiPrefs';
import {
  INITIAL_MICROCYCLES,
  INITIAL_MESOCYCLE,
  ExerciseData,
  WorkoutData,
  MicrocycleData,
  MesocycleData,
  WorkoutStatus,
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
  updateExerciseSets: (exerciseId: string, updatedSets: any[]) => void;
  addExercise: (exercise: ExerciseData) => void;
  removeExercise: (exerciseId: string) => void;
  addWorkout: (microcycleId: string) => string | null;
  finishSession: (status: WorkoutStatus) => Promise<void>;
  resetPlan: () => Promise<void>;
}

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

  useEffect(() => {
    const hydrateAndEvict = async () => {
      try {
        await evictOldSyncedData();
      } catch (err) {
        console.warn('Failed to evict old synced mutations on launch:', err);
      }

      try {
        const cached = await getSnapshot('microcycles');
        if (cached && Array.isArray(cached) && cached.length > 0 && cached[0].workouts) {
          setMicrocycles(cached);
        }
      } catch (err) {
        console.error('Failed to hydrate workout data from IndexedDB:', err);
      }

      try {
        const meso = await apiService.getMesocycle();
        if (meso && meso.microcycles) {
          setMicrocycles(meso.microcycles);
          await saveSnapshot('microcycles', meso.microcycles);
        }
      } catch (err) {
        console.warn('Failed to refresh mesocycle from backend (offline fallback active):', err);
      }
    };
    hydrateAndEvict();
  }, []);

  useEffect(() => {
    saveSnapshot('microcycles', microcycles)
      .catch(err => console.error('Failed to write IndexedDB microcycles snapshot:', err));
  }, [microcycles]);

  useEffect(() => {
    if (activeWorkoutId) setUiPref(UI_KEYS.activeWorkoutId, activeWorkoutId);
  }, [activeWorkoutId]);

  useEffect(() => {
    if (activeMicrocycleId) setUiPref(UI_KEYS.activeMicrocycleId, activeMicrocycleId);
  }, [activeMicrocycleId]);

  const activeMicro = microcycles.find(m => m.id === activeMicrocycleId);
  const activeWorkout = activeMicro?.workouts.find(w => w.id === activeWorkoutId);

  const updateExerciseSets = (exerciseId: string, updatedSets: any[]) => {
    if (!activeMicrocycleId || !activeWorkoutId) return;

    setMicrocycles(prev => prev.map(m => {
      if (m.id !== activeMicrocycleId) return m;
      return {
        ...m,
        workouts: m.workouts.map(w => {
          if (w.id !== activeWorkoutId) return w;

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

    void queueMutation(activeWorkoutId, 'ExerciseSet', exerciseId, { sets: updatedSets });
  };

  const computeWorkoutTonnage = (workout: WorkoutData): number =>
    workout.exercises.reduce((acc, ex) => {
      return acc + ex.sets.reduce((sum, s) => {
        const wt = trainingOrZero(s.actual ?? s.suggestedWeight);
        const rp = trainingIntOrZero(s.reps);
        return sum + wt * rp;
      }, 0);
    }, 0);

  const addExercise = (exercise: ExerciseData) => {
    if (!activeMicrocycleId || !activeWorkoutId) return;

    // Seed the anchor e1RM from the athlete's own history for this lift category
    // (dynamic, per-athlete) rather than a static library constant.
    const category = exerciseCategoryOf(exercise);
    const baseline = deriveBaselineE1RM(microcycles, category);
    const seededExercise: ExerciseData = {
      ...exercise,
      sets: exercise.sets.map((s, i) =>
        i === 0 ? { ...s, baseline_e1rm: s.baseline_e1rm ?? baseline } : s
      ),
    };
    exercise = seededExercise;

    setMicrocycles(prev => prev.map(m => {
      if (m.id !== activeMicrocycleId) return m;
      return {
        ...m,
        workouts: m.workouts.map(w => {
          if (w.id !== activeWorkoutId) return w;
          if (w.exercises.some(ex => ex.id === exercise.id)) return w;
          const updated = { ...w, exercises: [...w.exercises, exercise] };
          return { ...updated, tonnage: computeWorkoutTonnage(updated) };
        }),
      };
    }));

    void queueMutation(activeWorkoutId, 'Exercise', exercise.id, {
      action: 'ADD',
      title: exercise.title,
      variation: exercise.variation,
      tier: exercise.tier,
      liftCategory: exercise.liftCategory,
      tags: exercise.tags,
      sets: exercise.sets,
    });
  };

  const removeExercise = (exerciseId: string) => {
    if (!activeMicrocycleId || !activeWorkoutId) return;

    setMicrocycles(prev => prev.map(m => {
      if (m.id !== activeMicrocycleId) return m;
      return {
        ...m,
        workouts: m.workouts.map(w => {
          if (w.id !== activeWorkoutId) return w;
          const updated = { ...w, exercises: w.exercises.filter(ex => ex.id !== exerciseId) };
          return { ...updated, tonnage: computeWorkoutTonnage(updated) };
        }),
      };
    }));

    void queueMutation(activeWorkoutId, 'Exercise', exerciseId, { action: 'REMOVE' });
  };

  const addWorkout = (microcycleId: string): string | null => {
    const micro = microcycles.find(m => m.id === microcycleId);
    if (!micro) return null;

    const dayNumber = micro.workouts.length + 1;
    const lastDate = micro.workouts[micro.workouts.length - 1]?.date;
    let date = lastDate ?? new Date().toISOString().slice(0, 10);
    if (lastDate) {
      const [y, mo, d] = lastDate.split('-').map(Number);
      const next = new Date(Date.UTC(y, mo - 1, d));
      next.setUTCDate(next.getUTCDate() + 1);
      date = next.toISOString().slice(0, 10);
    }

    const newWorkout: WorkoutData = {
      id: `w-${microcycleId}-${dayNumber}-${Date.now()}`,
      date,
      dayLabel: `D${dayNumber}`,
      title: 'New Session',
      tonnage: 0,
      delta: 0,
      color: 'gray',
      status: 'PLANNED',
      exercises: [],
    };

    setMicrocycles(prev => prev.map(m => {
      if (m.id !== microcycleId) return m;
      return { ...m, workouts: [...m.workouts, newWorkout] };
    }));

    void queueMutation(newWorkout.id, 'Workout', newWorkout.id, {
      action: 'ADD',
      date: newWorkout.date,
      dayLabel: newWorkout.dayLabel,
      title: newWorkout.title,
      microcycleId,
    });

    return newWorkout.id;
  };

  const finishSession = async (status: WorkoutStatus) => {
    if (!activeMicrocycleId || !activeWorkoutId) return;

    let updatedWorkoutData: WorkoutData | null = null;

    setMicrocycles(prev => prev.map(m => {
      if (m.id !== activeMicrocycleId) return m;
      return {
        ...m,
        workouts: m.workouts.map(w => {
          if (w.id !== activeWorkoutId) return w;
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

  const resetPlan = async () => {
    const next = await apiService.resetMicrocycles();
    setMicrocycles(next);
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
        removeExercise,
        addWorkout,
        finishSession,
        resetPlan,
      }}
    >
      {children}
    </PeriodizationContext.Provider>
  );
}
