import { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo, ReactNode } from 'react';
import { ApiRequestError, apiService } from '../services/api';
import { saveSnapshot, getSnapshot, clearSnapshot, evictOldSyncedData, microcycleSnapshotKey } from '../services/db';
import { queueMutation } from '../services/sync_engine';
import { trainingIntOrZero, trainingOrZero } from '../services/numericTraining';
import { UI_KEYS, getUiPref, setUiPref, removeUiPref } from '../storage/uiPrefs';
import { useAuth } from './AuthContext';
import {
  WorkoutData,
  MicrocycleData,
  MesocycleData,
  WorkoutStatus,
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
    let data: MicrocycleData[];
    try {
      data = await apiService.fetchMicrocycles(owner ?? undefined, { allowOffline: false });
    } catch (error) {
      if (accountRole(user) === 'COACH' && owner && error instanceof ApiRequestError && error.status === 403) {
        snapshotOwnerRef.current = null;
        liveFetchedRef.current = false;
        setMicrocycles([]);
        if (activeAthleteId === owner) {
          setActiveAthleteIdState(null);
          removeUiPref(UI_KEYS.activeAthleteId);
          setActiveWorkoutId(null);
          setActiveMicrocycleId(null);
        }
      }
      throw error;
    }
    if (gen !== reloadGen.current) return;
    snapshotOwnerRef.current = owner ?? null;
    liveFetchedRef.current = true;
    setMicrocycles(data);
    if (owner) {
      await saveSnapshot(microcycleSnapshotKey(owner), data);
      if (gen !== reloadGen.current) {
        await clearSnapshot(microcycleSnapshotKey(owner)).catch(() => undefined);
      }
    }
  }, [user, resolvePlanOwnerId, activeAthleteId]);

  const setActiveAthleteId = useCallback((id: string | null) => {
    setActiveAthleteIdState(id);
    if (id) {
      setUiPref(UI_KEYS.activeAthleteId, id);
    } else {
      removeUiPref(UI_KEYS.activeAthleteId);
    }
  }, []);

  useEffect(() => {
    if (accountRole(user) !== 'COACH') return;

    const clearRevokedAthlete = (athleteId: unknown) => {
      if (typeof athleteId !== 'string' || !athleteId) return;
      void clearSnapshot(microcycleSnapshotKey(athleteId)).catch((error) => {
        console.warn('Failed to clear revoked athlete snapshot:', error);
      });

      if (activeAthleteId !== athleteId && planAthleteId !== athleteId) return;
      reloadGen.current += 1;
      snapshotOwnerRef.current = null;
      liveFetchedRef.current = false;
      setMicrocycles([]);
      setActiveAthleteIdState(null);
      removeUiPref(UI_KEYS.activeAthleteId);
      setActiveWorkoutId(null);
      setActiveMicrocycleId(null);
      removeUiPref(UI_KEYS.activeWorkoutId);
      removeUiPref(UI_KEYS.activeMicrocycleId);
    };

    const onCustomEvent = (event: Event) => {
      clearRevokedAthlete((event as CustomEvent<{ athleteId?: unknown }>).detail?.athleteId);
    };
    window.addEventListener('coach-athlete-unlinked', onCustomEvent);

    if (typeof BroadcastChannel === 'undefined') {
      return () => window.removeEventListener('coach-athlete-unlinked', onCustomEvent);
    }

    const channel = new BroadcastChannel('adaptive-lifting-access');
    const onBroadcast = (event: MessageEvent<{ type?: string; athleteId?: unknown }>) => {
      if (event.data?.type === 'coach-athlete-unlinked') clearRevokedAthlete(event.data.athleteId);
    };
    channel.addEventListener('message', onBroadcast);
    return () => {
      window.removeEventListener('coach-athlete-unlinked', onCustomEvent);
      channel.removeEventListener('message', onBroadcast);
      channel.close();
    };
  }, [user, activeAthleteId, planAthleteId]);

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
      // A coach's cached plan is only a convenience while this tab is already
      // open. On an offline launch we cannot verify that the relationship is
      // still active, so keep the cached copy hidden until the server responds.
      if (accountRole(user) === 'COACH' && typeof navigator !== 'undefined' && !navigator.onLine) return;
      try {
        const gen = reloadGen.current;
        const cached = await getSnapshot(microcycleSnapshotKey(owner));
        if (gen !== reloadGen.current) return;
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
    if (!user || accountRole(user) !== 'COACH') return;
    const revalidateOnReconnect = () => {
      if (!navigator.onLine || !activeAthleteId) return;
      reloadGen.current += 1;
      liveFetchedRef.current = false;
      snapshotOwnerRef.current = null;
      setMicrocycles([]);
      void reloadMicrocycles(activeAthleteId).catch((error) => {
        console.warn('Could not revalidate the selected athlete after reconnecting:', error);
      });
    };
    window.addEventListener('online', revalidateOnReconnect);
    return () => window.removeEventListener('online', revalidateOnReconnect);
  }, [user, activeAthleteId, reloadMicrocycles]);

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
    const gen = reloadGen.current;
    saveSnapshot(microcycleSnapshotKey(owner), microcycles)
      .then(() => {
        if (gen !== reloadGen.current) return clearSnapshot(microcycleSnapshotKey(owner));
        return undefined;
      })
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
  const pendingSetWrites = useRef<Record<string, Parameters<typeof apiService.replaceExerciseSets>[2]>>({});

  const persistExerciseSets = useCallback((exerciseId: string, updatedSets: any[]) => {
    if (!activeWorkoutId) return;
    const payload = updatedSets.map((row, index) => ({
      id: row.id,
      label: row.label || `Set ${index + 1}`,
      scope: row.scope ?? 'both',
      plannedWeight: row.plannedWeight ?? null,
      plannedReps: row.plannedReps ?? null,
      plannedRpe: row.target_value ?? row.plannedRpe ?? null,
      intensityType: row.intensity_type || row.intensityType || 'RPE',
      dropPercent: row.dropPercent ?? 0,
      isAuto: false,
      isTop: index === 0,
      actual: row.actual ?? null,
      reps: row.reps ?? null,
      executedRpe: row.executedRpe ?? null,
    }));
    pendingSetWrites.current[exerciseId] = payload;
    void queueMutation(activeWorkoutId, 'Exercise', exerciseId, { sets: payload });
    window.clearTimeout(saveTimers.current[exerciseId]);
    saveTimers.current[exerciseId] = window.setTimeout(() => {
      const next = pendingSetWrites.current[exerciseId];
      delete pendingSetWrites.current[exerciseId];
      delete saveTimers.current[exerciseId];
      if (!next) return;
      void apiService.replaceExerciseSets(activeWorkoutId, exerciseId, next).catch((err) => {
        console.error('Failed to save sets', err);
      });
    }, 400);
  }, [activeWorkoutId]);

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

    const workoutId = activeWorkoutId;
    Object.values(saveTimers.current).forEach((timer) => window.clearTimeout(timer as number));
    saveTimers.current = {};
    const pending = pendingSetWrites.current;
    pendingSetWrites.current = {};
    await Promise.all(
      Object.keys(pending).map((exerciseId) =>
        apiService.replaceExerciseSets(workoutId, exerciseId, pending[exerciseId]).catch((err) => {
          console.error('Failed to save sets', err);
        })
      )
    );

    await apiService.updateSession(workoutId, { status });
    await reloadMicrocycles(planAthleteId);
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
      }}
    >
      {children}
    </PeriodizationContext.Provider>
  );
}
