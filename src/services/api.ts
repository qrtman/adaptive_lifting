import { MicrocycleData, INITIAL_MICROCYCLES, AICoachResponse, isWorkoutCompleted, isWorkoutInProgress } from '../types';
import { getSnapshot, saveSnapshot } from './db';
import { UI_KEYS, removeUiPref, setUiPref } from '../storage/uiPrefs';
import { calculateE1RM } from './mathEngine';
import { trainingInt, trainingIntOrZero, trainingNumber, trainingOrZero } from './numericTraining';

const BACKEND_URL = (import.meta as any).env.VITE_BACKEND_URL || '';

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
  return INITIAL_MICROCYCLES;
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

// --- Dual-Driver Service Layer Exports ---

export const apiService = {
  /**
   * Fetches the complete microcycle training data.
   */
  async fetchMicrocycles(): Promise<MicrocycleData[]> {
    if (BACKEND_URL) {
      try {
        const response = await fetch(`${BACKEND_URL}/api/microcycles`, { headers: getHeaders(), credentials: 'include' });
        if (!response.ok) throw new Error('API server returned error status');
        return await response.json();
      } catch (err) {
        console.warn('Backend server unavailable. Falling back to IndexedDB snapshot.', err);
        return getOfflineMicrocycles();
      }
    }
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
        if (!response.ok) throw new Error('API set log request failed');
        return await response.json();
      } catch (err) {
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
    await saveOfflineMicrocycles(INITIAL_MICROCYCLES);
    return INITIAL_MICROCYCLES;
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
    if (!response.ok) throw new Error('Login failed');
    const data = await response.json();
    setUiPref(UI_KEYS.role, data.user.role);
    setUiPref(UI_KEYS.email, data.user.email);
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
    return await response.json();
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
  }
};
