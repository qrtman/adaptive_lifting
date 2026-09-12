import { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo, ReactNode } from 'react';
import { apiService } from '../services/api';
import { saveSnapshot, getSnapshot, evictOldSyncedData, microcycleSnapshotKey } from '../services/db';
import { queueMutation } from '../services/sync_engine';
import { trainingIntOrZero, trainingOrZero } from '../services/numericTraining';
import { UI_KEYS, getUiPref, setUiPref, removeUiPref } from '../storage/uiPrefs';
import { useAuth } from './AuthContext';
import {
  WorkoutData,
  MicrocycleData,
  MesocycleData,
  WorkoutStatus,
  isWorkoutLocked,
} from '../types';

interface PeriodizationState {
  microcycles: MicrocycleData[];
  setMicrocycles: (next: MicrocycleData[] | ((prev: MicrocycleData[]) => MicrocycleData[])) => void;
  mesocycles: MesocycleData[];
  activeAthleteId: string | null;
  planAthleteId: string | null;
  setActiveAthleteId: (id: string | null) => void;
  reloadMicrocycles: (athleteId?: string | null) => Promise<void>;
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

function selfUserId(user: { id?: string } | null): string | null {
  if (user?.id) return String(user.id);
  return getUiPref(UI_KEYS.userId);
}

function accountRole(user: { role?: string } | null): string {
  return String(user?.role || getUiPref(UI_KEYS.role) || '').toUpperCase();
}

export function PeriodizationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [microcycles, setMicrocycles] = useState<MicrocycleData[]>([]);
  const [activeAthleteId, setActiveAthleteIdState] = useState<string | null>(() => {
    return getUiPref(UI_KEYS.activeAthleteId) || null;
  });
  const [activeWorkoutId, setActiveWorkoutId] = useState<string | null>(() => {
    return getUiPref(UI_KEYS.activeWorkoutId) || null;
  });
  const [activeMicrocycleId, setActiveMicrocycleId] = useState<string | null>(() => {
    return getUiPref(UI_KEYS.activeMicrocycleId) || null;
  });

  const mesocycles: MesocycleData[] = [];
  const reloadGen = useRef(0);
  const liveFetchedRef = useRef(false);
  const snapshotOwnerRef = useRef<string | null>(null);

  const planAthleteId = useMemo(() => {
    const role = accountRole(user);
    const selfId = selfUserId(user);
    if (role === 'ATHLETE' && selfId) return selfId;
    if (role === 'COACH') return activeAthleteId;
    return selfId || activeAthleteId;
  }, [user, activeAthleteId]);

  const resolvePlanOwnerId = useCallback((athleteId?: string | null) => {
    const role = accountRole(user);
    const selfId = selfUserId(user);
    if (role === 'ATHLETE' && selfId) return selfId;
    if (athleteId !== undefined) return athleteId;
    if (role === 'COACH') return activeAthleteId;
    return selfId || activeAthleteId;
  }, [user, activeAthleteId]);

  const reloadMicrocycles = useCallback(async (athleteId?: string | null) => {
    if (!user) return;
    const owner = resolvePlanOwnerId(athleteId);
    const gen = ++reloadGen.current;
    const data = await apiService.fetchMicrocycles(owner ?? undefined, { allowOffline: false });
    if (gen !== reloadGen.current) return;
    snapshotOwnerRef.current = owner ?? null;
    liveFetchedRef.current = true;
    setMicrocycles(data);
    if (owner) {
      await saveSnapshot(microcycleSnapshotKey(owner), data);
    }
  }, [user, resolvePlanOwnerId]);

  const setActiveAthleteId = useCallback((id: string | null) => {
    setActiveAthleteIdState(id);
    if (id) {
      setUiPref(UI_KEYS.activeAthleteId, id);
    } else {
      removeUiPref(UI_KEYS.activeAthleteId);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      liveFetchedRef.current = false;
      return;
    }
    const hydrateAndEvict = async () => {
      try {
        await evictOldSyncedData();
      } catch (err) {
        console.warn('Failed to evict old synced mutations on launch:', err);
      }

      const owner = resolvePlanOwnerId();
      if (!owner) return;
      try {
        const cached = await getSnapshot(microcycleSnapshotKey(owner));
        if (liveFetchedRef.current && snapshotOwnerRef.current === owner) return;
        if (cached && Array.isArray(cached) && cached.length > 0 && cached[0]?.workouts) {
          setMicrocycles(cached);
        }
      } catch (err) {
        console.error('Failed to hydrate workout data from IndexedDB:', err);
      }
    };
    void hydrateAndEvict();
  }, [user, resolvePlanOwnerId]);

  useEffect(() => {
    if (!user) return;
    liveFetchedRef.current = false;
    if (snapshotOwnerRef.current !== planAthleteId) {
      setMicrocycles([]);
    }
    reloadMicrocycles(planAthleteId).catch((err) => {
      console.warn('Failed to reload microcycles:', err);
    });
  }, [user, planAthleteId, reloadMicrocycles]);

  useEffect(() => {
    if (!user) return;
    const owner = planAthleteId;
    if (!owner) return;
    if (!liveFetchedRef.current) return;
    if (snapshotOwnerRef.current !== owner) return;
    saveSnapshot(microcycleSnapshotKey(owner), microcycles)
      .catch(err => console.error('Failed to write IndexedDB microcycles snapshot:', err));
  }, [microcycles, planAthleteId, user]);

  useEffect(() => {
    if (activeWorkoutId) setUiPref(UI_KEYS.activeWorkoutId, activeWorkoutId);
  }, [activeWorkoutId]);

  useEffect(() => {
    if (activeMicrocycleId) setUiPref(UI_KEYS.activeMicrocycleId, activeMicrocycleId);
  }, [activeMicrocycleId]);

  const activeMicro = microcycles.find(m => m.id === activeMicrocycleId);
  const activeWorkout = activeMicro?.workouts.find(w => w.id === activeWorkoutId);

  const saveTimers = useRef<Record<string, number>>({});

  const persistExerciseSets = useCallback((exerciseId: string, updatedSets: any[]) => {
    if (!activeWorkoutId) return;
    if (activeWorkout && isWorkoutLocked(activeWorkout.status)) return;
    const payload = updatedSets.map((row, index) => ({
      id: row.id,
      label: row.label || `Set ${index + 1}`,
      plannedWeight: row.plannedWeight ?? null,
      plannedReps: row.plannedReps ?? null,
      plannedRpe: row.target_value ?? row.plannedRpe ?? null,
      intensityType: row.intensity_type || row.intensityType || 'RPE',
      isAuto: false,
      isTop: index === 0,
      actual: row.actual ?? null,
      reps: row.reps ?? null,
      executedRpe: row.executedRpe ?? null,
    }));
    void queueMutation(activeWorkoutId, 'Exercise', exerciseId, { sets: payload });
    window.clearTimeout(saveTimers.current[exerciseId]);
    saveTimers.current[exerciseId] = window.setTimeout(() => {
      void apiService.replaceExerciseSets(activeWorkoutId, exerciseId, payload).catch((err) => {
        console.error('Failed to save sets', err);
      });
    }, 400);
  }, [activeWorkoutId, activeWorkout]);

  const updateExerciseSets = (exerciseId: string, updatedSets: any[]) => {
    if (!activeMicrocycleId || !activeWorkoutId) return;
    if (activeWorkout && isWorkoutLocked(activeWorkout.status)) return;

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
              const wt = trainingOrZero(s.actual);
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
              const wt = trainingOrZero(s.actual);
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

    persistExerciseSets(exerciseId, updatedSets);
  };

  const finishSession = async (status: WorkoutStatus) => {
    if (!activeWorkoutId) return;

    Object.values(saveTimers.current).forEach((timer) => window.clearTimeout(timer));
    saveTimers.current = {};

    await apiService.updateSession(activeWorkoutId, { status });
    await reloadMicrocycles(planAthleteId);
  };

  const resetPlan = async () => {
    const next = await apiService.resetMicrocycles();
    liveFetchedRef.current = true;
    snapshotOwnerRef.current = resolvePlanOwnerId();
    setMicrocycles(next);
    const owner = resolvePlanOwnerId();
    if (owner) {
      await saveSnapshot(microcycleSnapshotKey(owner), next);
    }
  };

  return (
    <PeriodizationContext.Provider
      value={{
        microcycles,
        setMicrocycles,
        mesocycles,
        activeAthleteId,
        planAthleteId,
        setActiveAthleteId,
        reloadMicrocycles,
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