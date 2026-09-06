import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiService } from '../services/api';
import { saveSnapshot, getSnapshot, evictOldSyncedData } from '../services/db';
import { trainingIntOrZero, trainingOrZero } from '../services/numericTraining';
import { UI_KEYS, getUiPref, setUiPref } from '../storage/uiPrefs';
import {
  INITIAL_MICROCYCLES,
  INITIAL_MESOCYCLE,
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
        finishSession,
        resetPlan,
      }}
    >
      {children}
    </PeriodizationContext.Provider>
  );
}
