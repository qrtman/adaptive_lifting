import { MicrocycleData, AICoachResponse, isWorkoutCompleted, isWorkoutInProgress, WorkoutData } from '../types';
import { getSnapshot, saveSnapshot, clearSnapshot, microcycleSnapshotKey } from './db';
import { UI_KEYS, removeUiPref, setUiPref } from '../storage/uiPrefs';
import { calculateE1RM } from './mathEngine';
import { trainingInt, trainingIntOrZero, trainingNumber, trainingOrZero } from './numericTraining';
import type { AnalyticsCatalog, CardConfig, QueryResult, SavedCard } from '../insights/types';
import type { CopyMode } from '../features/plan/copyClipboard';
import { API_BASE_URL } from './apiBase';

const BACKEND_URL = API_BASE_URL;

export type RosterAthlete = {
  id: string;
  email: string;
  displayName?: string | null;
  activeMicrocycles: number;
};

export type PastAthlete = {
  relationshipId: number;
  athleteId: string;
  email: string;
  displayName?: string | null;
  linkedAt: string | null;
  endedAt: string | null;
  archiveAvailable: boolean;
};

export type CoachingHistorySnapshot = {
  relationshipId: number;
  fromDate: string;
  throughDate: string;
  athlete: { id: string; email: string; displayName?: string | null };
  microcycles: MicrocycleData[];
};

export class ApiRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiRequestError';
  }
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

async function getOfflineMicrocycles(ownerId?: string): Promise<MicrocycleData[]> {
  try {
    if (ownerId) {
      const cached = await getSnapshot(microcycleSnapshotKey(ownerId));
      if (cached && Array.isArray(cached) && cached.length > 0 && cached[0]?.workouts) {
        return cached;
      }
      return [];
    }
    const cached = await getSnapshot('microcycles');
    if (cached && Array.isArray(cached) && cached.length > 0 && cached[0]?.workouts) {
      return cached;
    }
  } catch (err) {
    console.warn('IndexedDB snapshot read failed.', err);
  }
  return [];
}

async function saveOfflineMicrocycles(data: MicrocycleData[], ownerId?: string): Promise<void> {
  try {
    await saveSnapshot(ownerId ? microcycleSnapshotKey(ownerId) : 'microcycles', data);
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
        if (!response.ok) {
          if (response.status === 403 && athleteId) {
            await clearSnapshot(microcycleSnapshotKey(athleteId)).catch(() => undefined);
          }
          const errData = await response.json().catch(() => ({}));
          throw new ApiRequestError(apiErrorMessage(errData, 'Could not load this athlete plan.'), response.status);
        }
        const data = await response.json();
        if (athleteId) {
          await saveOfflineMicrocycles(data, athleteId);
        }
        return data;
      } catch (err) {
        if (err instanceof ApiRequestError && (err.status === 401 || err.status === 403)) throw err;
        if (!allowOffline) {
          throw err instanceof Error ? err : new Error('Failed to load plan');
        }
        console.warn('Backend server unavailable. Falling back to IndexedDB snapshot.', err);
        return getOfflineMicrocycles(athleteId);
      }
    }
    if (!allowOffline) throw new Error('Failed to load plan');
    return getOfflineMicrocycles(athleteId);
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
        if (set.scope === 'plan') set.scope = 'both';
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
    if (data.user.displayName) setUiPref(UI_KEYS.displayName, data.user.displayName);
    else removeUiPref(UI_KEYS.displayName);
    if (data.user?.id) setUiPref(UI_KEYS.userId, String(data.user.id));
    return data;
  },

  async developmentLogin(role: 'COACH' | 'ATHLETE') {
    const response = await fetch(`${BACKEND_URL}/api/dev/login/${role.toLowerCase()}`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) throw new Error('Development login is unavailable');
    const data = await response.json();
    setUiPref(UI_KEYS.role, data.user.role);
    setUiPref(UI_KEYS.email, data.user.email);
    if (data.user.displayName) setUiPref(UI_KEYS.displayName, data.user.displayName);
    else removeUiPref(UI_KEYS.displayName);
    setUiPref(UI_KEYS.userId, String(data.user.id));
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
    if (data.user?.displayName) setUiPref(UI_KEYS.displayName, data.user.displayName);
    else removeUiPref(UI_KEYS.displayName);
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
    setUiPref(UI_KEYS.role, data.role || data.user?.role);
    setUiPref(UI_KEYS.email, data.email || data.user?.email);
    if (data.displayName || data.user?.displayName) setUiPref(UI_KEYS.displayName, data.displayName || data.user?.displayName);
    else removeUiPref(UI_KEYS.displayName);
    const userId = data.id || data.user?.id;
    if (userId) setUiPref(UI_KEYS.userId, String(userId));
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

  async fetchRoster(): Promise<RosterAthlete[]> {
    const response = await fetch(`${BACKEND_URL}/api/coach/roster`, { headers: getHeaders(), credentials: 'include' });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new ApiRequestError(errData.detail || 'Failed to fetch roster', response.status);
    }
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  },

  async updateProfile(displayName: string): Promise<{ id: string; email: string; role: string; displayName: string | null }> {
    const response = await fetch(`${BACKEND_URL}/api/auth/profile`, {
      method: 'PATCH',
      headers: { ...getHeaders(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ displayName }),
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new ApiRequestError(errData.detail || 'Failed to update profile', response.status);
    }
    return response.json();
  },

  async unlinkAthlete(athleteId: string): Promise<{ status: string; message: string; cacheCleared: boolean }> {
    const response = await fetch(`${BACKEND_URL}/api/auth/link/${encodeURIComponent(athleteId)}`, {
      method: 'DELETE', credentials: 'include', headers: getHeaders(),
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new ApiRequestError(errData.detail || 'Failed to unlink athlete', response.status);
    }
    const data = await response.json();
    let cacheCleared = true;
    try {
      await clearSnapshot(microcycleSnapshotKey(athleteId));
    } catch {
      cacheCleared = false;
    }
    window.dispatchEvent(new CustomEvent('coach-athlete-unlinked', { detail: { athleteId } }));
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('adaptive-lifting-access');
      channel.postMessage({ type: 'coach-athlete-unlinked', athleteId });
      channel.close();
    }
    return { ...data, cacheCleared };
  },

  async fetchPastAthletes(): Promise<PastAthlete[]> {
    const response = await fetch(`${BACKEND_URL}/api/coach/roster/history`, { headers: getHeaders(), credentials: 'include' });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new ApiRequestError(errData.detail || 'Failed to load past athletes', response.status);
    }
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  },

  async fetchCoachingHistory(relationshipId: number): Promise<CoachingHistorySnapshot> {
    const response = await fetch(`${BACKEND_URL}/api/coach/roster/history/${relationshipId}`, { headers: getHeaders(), credentials: 'include' });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new ApiRequestError(errData.detail || 'Failed to load workout history', response.status);
    }
    return response.json();
  },

  /**
   * Triggers a fetch call to download the CSV export blob.
   */
  async downloadExportCSV(liftCategory?: string, tier?: string): Promise<Blob> {
    const baseUrl = BACKEND_URL;
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
    const baseUrl = BACKEND_URL;
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
    copyMode?: CopyMode;
    includeLogs?: boolean;
    preserveWeekLabel?: boolean;
  }): Promise<{ status: string; copied: Array<{ id: string; date: string; title: string; blockLabel: string | null; weekLabel: string | null; sourceId: string }> }> {
    const body: Record<string, unknown> = {
      sessionIds: payload.sessionIds,
      athleteId: payload.athleteId,
      dateOffsetDays: payload.dateOffsetDays ?? 7,
      copyMode: payload.copyMode ?? (payload.includeLogs === true ? 'logs' : payload.includeLogs === false ? 'plan' : 'logs'),
      preserveWeekLabel: payload.preserveWeekLabel === true,
    };
    if (payload.targetBlockLabel !== undefined) body.targetBlockLabel = payload.targetBlockLabel;
    if (payload.targetWeekLabel !== undefined) body.targetWeekLabel = payload.targetWeekLabel;
    const response = await fetch(`${BACKEND_URL}/api/sessions/copy-week`, {
      method: 'POST',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || 'Failed to copy week');
    }
    return await response.json();
  },

  async fetchDayNotes(athleteId?: string | null): Promise<import('../types').DayNote[]> {
    const query = athleteId ? `?athlete_id=${encodeURIComponent(athleteId)}` : '';
    const response = await fetch(`${BACKEND_URL}/api/day-notes${query}`, {
      headers: getHeaders(),
      credentials: 'include',
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(apiErrorMessage(errData, 'Failed to load notes'));
    }
    const data = await response.json();
    return Array.isArray(data?.notes) ? data.notes : [];
  },

  async upsertDayNote(payload: {
    date: string;
    body: string;
    athleteId?: string | null;
  }): Promise<{ id: string | null; date: string; body: string | null; ownerId?: string }> {
    const response = await fetch(`${BACKEND_URL}/api/day-notes`, {
      method: 'PUT',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify({
        date: payload.date,
        body: payload.body,
        athleteId: payload.athleteId || undefined,
      }),
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(apiErrorMessage(errData, 'Failed to save note'));
    }
    return await response.json();
  },

  async addSessionExercise(sessionId: string, payload: {
    title: string;
    variation?: string;
    tier?: 'Comp' | 'Variation' | 'Accessory';
    liftCategory?: 'Squat' | 'Bench' | 'Deadlift' | 'Other';
    movementPattern?: string;
    liftNote?: string;
    plannedWeight?: number | null;
    plannedReps?: number | null;
    plannedRpe?: number | null;
  }): Promise<import('../types').ExerciseData> {
    const body: Record<string, unknown> = {
      title: payload.title,
      variation: payload.variation,
      tier: payload.tier,
      liftCategory: payload.liftCategory,
      movementPattern: payload.movementPattern,
      liftNote: payload.liftNote,
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
      scope?: 'both' | 'plan' | 'log';
      plannedWeight?: number | null;
      plannedReps?: number | null;
      plannedRpe?: number | null;
      intensityType?: string | null;
      dropPercent?: number | null;
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
          scope: row.scope ?? 'both',
          plannedWeight: row.plannedWeight,
          plannedReps: row.plannedReps,
          plannedRpe: row.plannedRpe,
          intensityType: row.intensityType,
          dropPercent: row.dropPercent ?? 0,
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
    liftCategory?: 'Squat' | 'Bench' | 'Deadlift' | 'Other';
    movementPattern?: string;
    liftNote?: string;
    move?: 'up' | 'down';
    order?: string[];
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

  async fetchAnalyticsCatalog(): Promise<AnalyticsCatalog> {
    const response = await fetch(`${BACKEND_URL}/api/analytics/catalog`, { headers: getHeaders(), credentials: 'include' });
    if (!response.ok) throw new Error('Failed to load analytics catalog');
    return await response.json() as AnalyticsCatalog;
  },

  async queryInsightCard(config: CardConfig, athleteId?: string | null): Promise<QueryResult> {
    const response = await fetch(`${BACKEND_URL}/api/analytics/query`, {
      method: 'POST',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify({ config, athlete_id: athleteId || undefined }),
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(apiErrorMessage(errData, 'Analytics query failed'));
    }
    return await response.json() as QueryResult;
  },

  async fetchInsightCards(): Promise<SavedCard[]> {
    const response = await fetch(`${BACKEND_URL}/api/insight-cards`, { headers: getHeaders(), credentials: 'include' });
    if (!response.ok) throw new Error('Failed to load insight cards');
    return await response.json() as SavedCard[];
  },

  async saveInsightCard(card: SavedCard): Promise<SavedCard> {
    const putUrl = `${BACKEND_URL}/api/insight-cards/${card.id}`;
    const postUrl = `${BACKEND_URL}/api/insight-cards`;
    let response = await fetch(putUrl, {
      method: 'PUT',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify(card),
    });
    if (response.status === 404) {
      response = await fetch(postUrl, {
        method: 'POST',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify(card),
      });
    }
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(apiErrorMessage(errData, 'Failed to save card'));
    }
    return await response.json() as SavedCard;
  },

  async deleteInsightCard(cardId: string): Promise<void> {
    const response = await fetch(`${BACKEND_URL}/api/insight-cards/${cardId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!response.ok) throw new Error('Failed to delete card');
  },
};
