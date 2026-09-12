import { MicrocycleData, AICoachResponse, isWorkoutCompleted, isWorkoutInProgress, isWorkoutLocked, WorkoutData } from '../types';
import { getSnapshot, saveSnapshot } from './db';
import { UI_KEYS, removeUiPref, setUiPref } from '../storage/uiPrefs';
import { calculateE1RM } from './mathEngine';
import { trainingInt, trainingIntOrZero, trainingNumber, trainingOrZero } from './numericTraining';

const BACKEND_URL = (import.meta as any).env.VITE_BACKEND_URL || 'http://localhost:8000';

/**
 * Recalculates metrics for a workout: exercise volumes, top single labels, and day's overall tonnage.
 */
export function recalculateWorkoutMetrics(
  workout: any,
  previousWorkoutTonnage: number = 0
): void {
  let totalTonnage = 0;

  workout.exercises = workout.exercises.map((exercise: any) => {
    let exerciseVolume = 0;
    let maxWeight = 0;
    let maxWeightReps = 0;
    let topSingleE1RM = 0;
    let topSingleSet: any = null;

    exercise.sets.forEach((set: any) => {
      const weight = trainingOrZero(set.actual ?? set.plannedWeight);
      const reps = trainingIntOrZero(set.reps ?? set.plannedReps);
      const rpe = trainingOrZero(set.executedRpe ?? set.plannedRpe);

      if (weight > 0 && reps > 0) {
        const setVolume = weight * reps;
        exerciseVolume += setVolume;

        // Track max physical load
        if (weight > maxWeight) {
          maxWeight = weight;
          maxWeightReps = reps;
        }

        // Track RTS top single (highest e1RM or explicitly flagged isTop)
        const setE1RM = calculateE1RM(weight, reps, rpe);
        if (set.isTop || setE1RM > topSingleE1RM) {
          topSingleE1RM = setE1RM;
          topSingleSet = { weight, reps };
        }
      }
    });

    totalTonnage += exerciseVolume;

    // Format display strings matching desktop dashboard metrics
    const topStr = topSingleSet
      ? `${topSingleSet.weight}kg x ${topSingleSet.reps}`
      : exercise.top || '—';
    const volStr = exerciseVolume > 0
      ? `${exerciseVolume.toLocaleString()}kg`
      : exercise.vol || '—';

    return {
      ...exercise,
      top: topStr,
      vol: volStr
    };
  });

  workout.tonnage = totalTonnage;
  workout.delta = previousWorkoutTonnage > 0 ? totalTonnage - previousWorkoutTonnage : 0;
}

async function getOfflineMicrocycles(): Promise<MicrocycleData[]> {
  try {
    const cached = await getSnapshot('microcycles');
    if (cached && Array.isArray(cached) && cached[0]?.workouts) {
      return cached;
    }
  } catch (err) {
    console.warn('IndexedDB snapshot read failed.', err);
  }
  return [];
}

async function saveOfflineMicrocycles(data: MicrocycleData[]): Promise<void> {
  try {
    await saveSnapshot('microcycles', data);
  } catch (err) {
    console.error('Failed to write IndexedDB microcycles snapshot:', err);
  }
}

function getHeaders() {
  return {
    'Content-Type': 'application/json'
  };
}

function apiErrorMessage(errData: unknown, fallback: string): string {
  const detail = errData && typeof errData === 'object' ? (errData as { detail?: unknown }).detail : undefined;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const first = detail[0];
    if (typeof first === 'string' && first.trim()) return first;
    if (first && typeof first === 'object' && 'msg' in first && typeof first.msg === 'string') {
      return first.msg;
    }
  }
  return fallback;
}

// --- Dual-Driver Service Layer Exports ---

export const apiService = {
  /**
   * Fetches the complete microcycle training data.
   */
  async fetchMicrocycles(athleteId?: string, options?: { allowOffline?: boolean }): Promise<MicrocycleData[]> {
    const allowOffline = options?.allowOffline !== false;
    if (BACKEND_URL) {
      try {
        const query = athleteId ? `?athlete_id=${encodeURIComponent(athleteId)}` : '';
        const response = await fetch(`${BACKEND_URL}/api/microcycles${query}`, { headers: getHeaders(), credentials: 'include' });
        if (!response.ok) throw new Error('API server returned error status');
        return await response.json();
      } catch (err) {
        if (!allowOffline) {
          throw err instanceof Error ? err : new Error('Failed to load plan');
        }
        console.warn('Backend server unavailable. Falling back to IndexedDB snapshot.', err);
        return getOfflineMicrocycles();
      }
    }
    if (!allowOffline) throw new Error('Failed to load plan');
    return getOfflineMicrocycles();
  },

  /**
   * Logs or updates a set inside a specific workout and exercise.
   */
  async logSet(
    workoutId: string,
    exerciseId: string,
    setId: string,
    weight: number,
    reps: number,
    rpe: number,
    note?: string,
    velocity?: number | null,
    readiness?: number | null,
    hrv?: number | null
  ): Promise<MicrocycleData[]> {
    if (BACKEND_URL) {
      try {
        const response = await fetch(`${BACKEND_URL}/api/sets/log`, {
          method: 'POST',
          headers: getHeaders(),
          credentials: 'include',
          body: JSON.stringify({ workoutId, exerciseId, setId, weight, reps, rpe, note, velocity, readiness, hrv })
        });
        if (response.status === 409) {
          throw new Error('Session is locked');
        }
        if (!response.ok) throw new Error('API set log request failed');
        return await response.json();
      } catch (err) {
        if (err instanceof Error && err.message === 'Session is locked') throw err;
        console.warn('Backend server save failed. Queueing set on IndexedDB snapshot.', err);
      }
    }

    const data = await getOfflineMicrocycles();
    
    // Find active workout indices
    let workoutObj: any = null;
    let prevWorkoutTonnage = 0;
    
    // 1. Locate current workout and calculate historical comparisons for delta tonnage
    data.forEach((mc, mcIdx) => {
      mc.workouts.forEach((w) => {
        if (w.id === workoutId) {
          workoutObj = w;
          
          // Find historical equivalent workout (same day label, e.g., "D1") in previous microcycle
          if (mcIdx > 0) {
            const prevMC = data[mcIdx - 1];
            const prevW = prevMC.workouts.find((pw) => pw.dayLabel === w.dayLabel);
            if (prevW) {
              prevWorkoutTonnage = prevW.tonnage;
            }
          }
        }
      });
    });

    if (!workoutObj) return data;
    if (isWorkoutLocked(workoutObj.status)) {
      throw new Error('Session is locked');
    }

    // 2. Locate exercise and update target set
    const exercise = workoutObj.exercises.find((ex: any) => ex.id === exerciseId);
    if (exercise) {
      const set = exercise.sets.find((s: any) => s.id === setId);
      if (set) {
        set.actual = trainingNumber(weight);
        set.reps = trainingInt(reps);
        set.executedRpe = trainingNumber(rpe);
        if (note !== undefined) set.note = note;
        if (velocity !== undefined) set.velocity = trainingNumber(velocity);
        if (readiness !== undefined) set.readiness = trainingInt(readiness);
        if (hrv !== undefined) set.hrv = trainingNumber(hrv);
      }
    }

    // 3. Recalculate training volumes and progression delta
    recalculateWorkoutMetrics(workoutObj, prevWorkoutTonnage);
    
    await saveOfflineMicrocycles(data);
    return data;
  },

  /**
   * Flushes and resets all datasets back to their initial baseline structures.
   */
  async resetMicrocycles(): Promise<MicrocycleData[]> {
    if (BACKEND_URL) {
      try {
        const response = await fetch(`${BACKEND_URL}/api/reset`, { method: 'POST', credentials: 'include' });
        if (!response.ok) throw new Error('API server reset failed');
        return await response.json();
      } catch (err) {
        console.warn('Backend server reset unavailable. Resetting IndexedDB snapshot.', err);
      }
    }
    await saveOfflineMicrocycles([]);
    return [];
  },

  /**
   * Fetches the advanced powerlifting analytics payload for a specific athlete.
   */
  async fetchAnalyticsTrends(athleteId?: string): Promise<any> {
    if (BACKEND_URL) {
      try {
        const url = athleteId ? `${BACKEND_URL}/api/analytics/trends?athlete_id=${athleteId}` : `${BACKEND_URL}/api/analytics/trends`;
        const response = await fetch(url, { headers: getHeaders(), credentials: 'include' });
        if (!response.ok) throw new Error('API server trends request failed');
        return await response.json();
      } catch (err) {
        console.warn('Backend server trends unavailable.', err);
        return null;
      }
    }
    return null;
  },

  /**
   * Fetches the secure AI-driven auto-regulation coaching prescriptions.
   */
  async fetchAICoachPrescription(athleteId?: string): Promise<AICoachResponse> {
    const baseUrl = BACKEND_URL || '';
    const url = athleteId ? `${baseUrl}/api/analytics/ai-advisor?athlete_id=${athleteId}` : `${baseUrl}/api/analytics/ai-advisor`;
    const response = await fetch(url, { headers: getHeaders(), credentials: 'include' });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload?.detail || 'Failed to generate AI recommendations.');
    }
    return await response.json();
  },

  /**
   * Mock mesocycle adaptor for App.tsx compatibility.
   */
  async getMesocycle(): Promise<any> {
    const microcycles = await this.fetchMicrocycles();
    return { microcycles };
  },

  /**
   * Mock workout saver for App.tsx compatibility.
   */
  async saveLog(workout: any): Promise<boolean> {
    return true;
  },

  /**
   * Generates chronological set trends from microcycle databases.
   */
  async fetchTrends(): Promise<any[]> {
    const microcycles = await this.fetchMicrocycles();
    const trends: any[] = [];
    
    microcycles.forEach((mc) => {
      mc.workouts.forEach((w) => {
        if (isWorkoutCompleted(w.status) || isWorkoutInProgress(w.status)) {
          w.exercises.forEach((e) => {
            e.sets.forEach((s) => {
              const weightVal = trainingOrZero(s.actual ?? s.plannedWeight);
              const repsVal = trainingIntOrZero(s.reps ?? s.plannedReps);
              const rpeVal = trainingOrZero(s.executedRpe ?? s.plannedRpe);
              
              if (weightVal > 0 && repsVal > 0) {
                const e1rmVal = calculateE1RM(weightVal, repsVal, rpeVal);
                trends.push({
                  date: w.date,
                  exercise: e.title,
                  variation: e.variation,
                  weight: weightVal,
                  reps: repsVal,
                  rpe: rpeVal,
                  e1rm: e1rmVal,
                  volume: weightVal * repsVal
                });
              }
            });
          });
        }
      });
    });
    
    return trends.sort((a, b) => a.date.localeCompare(b.date));
  },

  // --- Authentication & SaaS Methods ---
  async login(email: string, password: string) {
    const formData = new URLSearchParams();
    formData.append('username', email);
    formData.append('password', password);
    const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      body: formData,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      credentials: 'include'
    });
    if (!response.ok) throw new Error('Invalid credentials');
    const data = await response.json();
    setUiPref(UI_KEYS.role, data.user.role);
    setUiPref(UI_KEYS.email, data.user.email);
    if (data.user?.id) setUiPref(UI_KEYS.userId, String(data.user.id));
    return data;
  },

  async googleLogin(token: string, role = 'COACH') {
    const response = await fetch(`${BACKEND_URL}/api/auth/google`, {
      method: 'POST',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify({ token, role }),
    });
    if (!response.ok) throw new Error('Google authentication failed');
    const data = await response.json();
    if (data.user?.role) setUiPref(UI_KEYS.role, data.user.role);
    if (data.user?.email) setUiPref(UI_KEYS.email, data.user.email);
    if (data.user?.id) setUiPref(UI_KEYS.userId, String(data.user.id));
    return data;
  },

  async register(email: string, password: string, role: string) {
    const response = await fetch(`${BACKEND_URL}/api/auth/register`, {
      method: 'POST',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify({ email, password, role })
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || 'Registration failed');
    }
    const data = await response.json();
    setUiPref(UI_KEYS.role, data.role);
    setUiPref(UI_KEYS.email, data.email);
    if (data.id) setUiPref(UI_KEYS.userId, String(data.id));
    return data;
  },

  async pushProgramming(athleteId: string, template: string) {
    const response = await fetch(`${BACKEND_URL}/api/coach/push-program`, {
      method: 'POST',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify({ athleteId, template })
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || 'Failed to push program');
    }
    const data = await response.json();
    return {
      ...data,
      message: data.message || 'Push acknowledged. Create sessions on the athlete plan — demo programs are not auto-injected.',
    };
  },

  async fetchRoster() {
    const response = await fetch(`${BACKEND_URL}/api/coach/roster`, { headers: getHeaders(), credentials: 'include' });
    if (!response.ok) throw new Error('Failed to fetch roster');
    return await response.json();
  },

  /**
   * Triggers a fetch call to download the CSV export blob.
   */
  async downloadExportCSV(liftCategory?: string, tier?: string): Promise<Blob> {
    const baseUrl = BACKEND_URL || 'http://localhost:8000';
    let url = `${baseUrl}/api/export/csv`;
    const params = [];
    if (liftCategory) params.push(`lift_category=${encodeURIComponent(liftCategory)}`);
    if (tier) params.push(`tier=${encodeURIComponent(tier)}`);
    if (params.length > 0) url += `?${params.join('&')}`;

    const response = await fetch(url, { headers: getHeaders(), credentials: 'include' });
    if (!response.ok) throw new Error('CSV export download failed');
    return await response.blob();
  },

  /**
   * Triggers a fetch call to download the JSON export blob.
   */
  async downloadExportJSON(): Promise<Blob> {
    const baseUrl = BACKEND_URL || 'http://localhost:8000';
    const url = `${baseUrl}/api/export/json`;
    const response = await fetch(url, { headers: getHeaders(), credentials: 'include' });
    if (!response.ok) throw new Error('JSON export download failed');
    return await response.blob();
  },

  async logout() {
    try {
      await fetch(`${BACKEND_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch (err) {}
    removeUiPref(UI_KEYS.role);
    removeUiPref(UI_KEYS.email);
    removeUiPref(UI_KEYS.roleMode);
    removeUiPref(UI_KEYS.userId);
    removeUiPref(UI_KEYS.activeAthleteId);
  },

  async createCoachCode(): Promise<{ code: string; expires_at?: string }> {
    const response = await fetch(`${BACKEND_URL}/api/auth/coach-code`, {
      method: 'POST',
      headers: getHeaders(),
      credentials: 'include',
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || 'Failed to create coach code');
    }
    return await response.json();
  },

  async getCoachCodeStatus(): Promise<{ active: boolean; code?: string | null; expires_at?: string; hint?: string }> {
    const response = await fetch(`${BACKEND_URL}/api/auth/coach-code`, {
      headers: getHeaders(),
      credentials: 'include',
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || 'Failed to fetch coach code status');
    }
    return await response.json();
  },

  async linkAthlete(code: string): Promise<{ status: string; message?: string }> {
    const response = await fetch(`${BACKEND_URL}/api/auth/link-athlete`, {
      method: 'POST',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify({ code }),
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || 'Failed to link coach');
    }
    return await response.json();
  },

  async unlinkCoach(): Promise<{ status: string; message?: string }> {
    const response = await fetch(`${BACKEND_URL}/api/auth/link`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || 'Failed to unlink coach');
    }
    return await response.json();
  },

  async createSession(payload: {
    date: string;
    title?: string;
    blockLabel?: string | null;
    weekLabel?: string | null;
    athleteId?: string;
    microcycleId?: string;
    dayLabel?: string;
  }): Promise<WorkoutData & { microcycleId?: string }> {
    const response = await fetch(`${BACKEND_URL}/api/sessions`, {
      method: 'POST',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify({
        date: payload.date,
        title: payload.title,
        blockLabel: payload.blockLabel,
        weekLabel: payload.weekLabel,
        athleteId: payload.athleteId,
        microcycleId: payload.microcycleId,
        dayLabel: payload.dayLabel,
      }),
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(apiErrorMessage(errData, 'Failed to create session'));
    }
    return await response.json();
  },

  async updateSession(
    sessionId: string,
    payload: {
      date?: string;
      title?: string;
      dayLabel?: string;
      blockLabel?: string | null;
      weekLabel?: string | null;
      status?: string;
    }
  ): Promise<Partial<WorkoutData>> {
    const response = await fetch(`${BACKEND_URL}/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || 'Failed to update session');
    }
    return await response.json();
  },

  async bulkUpdateSessionLabels(payload: {
    sessionIds: string[];
    blockLabel?: string | null;
    weekLabel?: string | null;
    clearBlock?: boolean;
    clearWeek?: boolean;
    athleteId?: string;
  }): Promise<{ status: string; updated: string[] }> {
    const response = await fetch(`${BACKEND_URL}/api/sessions/labels`, {
      method: 'PATCH',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify({
        sessionIds: payload.sessionIds,
        blockLabel: payload.blockLabel,
        weekLabel: payload.weekLabel,
        clearBlock: payload.clearBlock,
        clearWeek: payload.clearWeek,
        athleteId: payload.athleteId,
      }),
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || 'Failed to update session labels');
    }
    return await response.json();
  },

  async copyWeek(payload: {
    sessionIds: string[];
    athleteId?: string;
    dateOffsetDays?: number;
    targetBlockLabel?: string | null;
    targetWeekLabel?: string | null;
    includeLogs?: boolean;
  }): Promise<{ status: string; copied: Array<{ id: string; date: string; title: string; blockLabel: string | null; weekLabel: string | null; sourceId: string }> }> {
    const response = await fetch(`${BACKEND_URL}/api/sessions/copy-week`, {
      method: 'POST',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify({
        sessionIds: payload.sessionIds,
        athleteId: payload.athleteId,
        dateOffsetDays: payload.dateOffsetDays ?? 7,
        targetBlockLabel: payload.targetBlockLabel,
        targetWeekLabel: payload.targetWeekLabel,
        includeLogs: payload.includeLogs === true,
      }),
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || 'Failed to copy week');
    }
    return await response.json();
  },

  async addSessionExercise(sessionId: string, payload: {
    title: string;
    variation?: string;
    tier?: 'Comp' | 'Variation' | 'Accessory';
    liftCategory?: 'Squat' | 'Bench' | 'Deadlift' | 'Other';
    plannedWeight?: number | null;
    plannedReps?: number | null;
    plannedRpe?: number | null;
  }): Promise<import('../types').ExerciseData> {
    const body: Record<string, unknown> = {
      title: payload.title,
      variation: payload.variation,
      tier: payload.tier,
      liftCategory: payload.liftCategory,
    };
    if (payload.plannedWeight != null) body.plannedWeight = payload.plannedWeight;
    if (payload.plannedReps != null) body.plannedReps = payload.plannedReps;
    if (payload.plannedRpe != null) body.plannedRpe = payload.plannedRpe;
    const response = await fetch(`${BACKEND_URL}/api/sessions/${sessionId}/exercises`, {
      method: 'POST',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || 'Failed to add lift');
    }
    return await response.json();
  },

  async replaceExerciseSets(
    sessionId: string,
    exerciseId: string,
    sets: Array<{
      id?: string;
      label?: string;
      plannedWeight?: number | null;
      plannedReps?: number | null;
      plannedRpe?: number | null;
      intensityType?: string | null;
      isAuto?: boolean;
      isTop?: boolean;
      actual?: number | null;
      reps?: number | null;
      executedRpe?: number | null;
    }>
  ): Promise<import('../types').ExerciseData> {
    const response = await fetch(`${BACKEND_URL}/api/sessions/${sessionId}/exercises/${exerciseId}/sets`, {
      method: 'PUT',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify({
        sets: sets.map((row) => ({
          id: row.id,
          label: row.label,
          plannedWeight: row.plannedWeight,
          plannedReps: row.plannedReps,
          plannedRpe: row.plannedRpe,
          intensityType: row.intensityType,
          isAuto: row.isAuto,
          isTop: row.isTop,
          actual: row.actual,
          reps: row.reps,
          executedRpe: row.executedRpe,
        })),
      }),
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || 'Failed to save sets');
    }
    return await response.json();
  },

  async updateSessionExercise(sessionId: string, exerciseId: string, payload: {
    variation?: string;
    title?: string;
    tier?: 'Comp' | 'Variation' | 'Accessory';
    move?: 'up' | 'down';
  }): Promise<import('../types').ExerciseData> {
    const response = await fetch(`${BACKEND_URL}/api/sessions/${sessionId}/exercises/${exerciseId}`, {
      method: 'PATCH',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || 'Failed to update lift');
    }
    return await response.json();
  },

  async removeSessionExercise(sessionId: string, exerciseId: string): Promise<{ status: string; id: string }> {
    const response = await fetch(`${BACKEND_URL}/api/sessions/${sessionId}/exercises/${exerciseId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || 'Failed to remove lift');
    }
    return await response.json();
  },

  async deleteSession(sessionId: string): Promise<{ status: string }> {
    const response = await fetch(`${BACKEND_URL}/api/sessions/${sessionId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || 'Failed to delete session');
    }
    return await response.json();
  },
};
