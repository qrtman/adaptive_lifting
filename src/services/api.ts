import { MicrocycleData, INITIAL_MICROCYCLES, AICoachResponse } from '../types';

const STORAGE_KEY = 'iron_box_microcycles';
const BACKEND_URL = (import.meta as any).env.VITE_BACKEND_URL || '';

// --- Powerlifting RTS & Progression Computations ---

/**
 * Calculates Estimated 1RM (e1RM) using an RPE-compensated Brzycki formula.
 * In RTS, executing a set at less than RPE 10 acts like doing additional reps.
 * e.g., 5 reps at RPE 9 is fatigue-equivalent to a 6-rep max.
 */
export function calculateE1RM(weight: number, reps: number, rpe: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  // If no RPE or full RPE 10, calculate standard Brzycki
  const rpeValue = rpe > 0 ? rpe : 10;
  const effectiveReps = reps + (10 - rpeValue);
  
  if (effectiveReps >= 37) return weight; // Prevent division by zero or negative ratio
  const e1rm = weight / (1.0278 - (0.0278 * effectiveReps));
  return Math.round(e1rm * 10) / 10;
}

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
      const weight = parseFloat(set.actual || set.plannedWeight || '0');
      const reps = parseInt(set.reps || set.plannedReps || '0');
      const rpe = parseFloat(set.executedRpe || set.plannedRpe || '0');

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

  // Include accessory work in tonnage if logged
  if (workout.accessories) {
    workout.accessories.forEach((acc: any) => {
      const weight = parseFloat(acc.weight || '0');
      const reps = parseInt(acc.reps || '0');
      if (acc.status === 'Done' && weight > 0 && reps > 0) {
        totalTonnage += weight * reps;
      }
    });
  }

  workout.tonnage = totalTonnage;
  workout.delta = previousWorkoutTonnage > 0 ? totalTonnage - previousWorkoutTonnage : 0;
}

// --- LocalStorage Driver ---

function getLocalData(): MicrocycleData[] {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_MICROCYCLES));
    return INITIAL_MICROCYCLES;
  }
  try {
    return JSON.parse(data);
  } catch {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_MICROCYCLES));
    return INITIAL_MICROCYCLES;
  }
}

function saveLocalData(data: MicrocycleData[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
        console.warn('Backend server unavailable. Falling back to LocalStorage.', err);
        return getLocalData();
      }
    }
    return getLocalData();
  },

  /**
   * Logs or updates a set inside a specific workout and exercise.
   */
  async logSet(
    workoutId: string,
    exerciseId: string,
    setId: string,
    weight: string,
    reps: string,
    rpe: string,
    note?: string,
    velocity?: string,
    readiness?: string,
    hrv?: string
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
        console.warn('Backend server save failed. Syncing to LocalStorage.', err);
      }
    }

    // LocalStorage Fallback Mutation
    const data = getLocalData();
    
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
        set.actual = weight;
        set.reps = reps;
        set.executedRpe = rpe;
        if (note !== undefined) set.note = note;
        if (velocity !== undefined) set.velocity = velocity;
        if (readiness !== undefined) set.readiness = readiness;
        if (hrv !== undefined) set.hrv = hrv;
      }
    }

    // 3. Recalculate training volumes and progression delta
    recalculateWorkoutMetrics(workoutObj, prevWorkoutTonnage);
    
    saveLocalData(data);
    return data;
  },

  /**
   * Logs or updates an accessory exercise inside a workout.
   */
  async logAccessory(
    workoutId: string,
    accessoryId: string,
    weight: string,
    reps: string,
    rpe: string,
    status: 'Pending' | 'Done'
  ): Promise<MicrocycleData[]> {
    if (BACKEND_URL) {
      try {
        const response = await fetch(`${BACKEND_URL}/api/accessories/log`, {
          method: 'POST',
          headers: getHeaders(),
          credentials: 'include',
          body: JSON.stringify({ workoutId, accessoryId, weight, reps, rpe, status })
        });
        if (!response.ok) throw new Error('API accessory log request failed');
        return await response.json();
      } catch (err) {
        console.warn('Backend server save failed. Syncing to LocalStorage.', err);
      }
    }

    const data = getLocalData();
    let workoutObj: any = null;
    let prevWorkoutTonnage = 0;

    data.forEach((mc, mcIdx) => {
      mc.workouts.forEach((w) => {
        if (w.id === workoutId) {
          workoutObj = w;
          if (mcIdx > 0) {
            const prevMC = data[mcIdx - 1];
            const prevW = prevMC.workouts.find((pw) => pw.dayLabel === w.dayLabel);
            if (prevW) prevWorkoutTonnage = prevW.tonnage;
          }
        }
      });
    });

    if (workoutObj && workoutObj.accessories) {
      const acc = workoutObj.accessories.find((a: any) => a.id === accessoryId);
      if (acc) {
        acc.weight = weight;
        acc.reps = reps;
        acc.executedRpe = rpe;
        acc.status = status;
      }
      recalculateWorkoutMetrics(workoutObj, prevWorkoutTonnage);
      saveLocalData(data);
    }

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
        console.warn('Backend server reset unavailable. Resetting LocalStorage.', err);
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_MICROCYCLES));
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
        if (w.status === 'Completed' || w.status === 'Today') {
          w.exercises.forEach((e) => {
            e.sets.forEach((s) => {
              const weightVal = parseFloat(s.actual || s.plannedWeight || '0');
              const repsVal = parseInt(s.reps || s.plannedReps || '0');
              const rpeVal = parseFloat(s.executedRpe || s.plannedRpe || '0');
              
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
    localStorage.setItem('iron_box_role', data.user.role);
    localStorage.setItem('iron_box_email', data.user.email);
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
    localStorage.setItem('iron_box_role', data.role);
    localStorage.setItem('iron_box_email', data.email);
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
    localStorage.removeItem('iron_box_role');
    localStorage.removeItem('iron_box_email');
    localStorage.removeItem('obsidian_role_mode');
  }
};
