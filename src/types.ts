export interface SetData {
  id: string;
  label: string;
  plannedWeight: number | null;
  plannedReps: number | null;
  plannedRpe: number | null;
  dropPercent?: number;
  isAuto?: boolean;
  actual?: number | null;
  reps?: number | null;
  executedRpe?: number | null;
  isTop?: boolean;
  note?: string;
  velocity?: number | null;
  readiness?: number | null;
  hrv?: number | null;

  intensity_type?: 'RPE' | 'PERCENT';
  target_value?: number;
  adjustment_pct?: number;
  baseline_e1rm?: number;
}

export interface ExerciseData {
  id: string;
  title: string;
  variation: string;
  tier?: 'Comp' | 'Variation' | 'Accessory';
  liftCategory?: 'Squat' | 'Bench' | 'Deadlift' | 'Other';
  tags: string[];
  top: string;
  vol: string;
  sets: SetData[];
}

export function isAccessoryExercise(exercise: ExerciseData): boolean {
  return exercise.tier === 'Accessory';
}

export function splitWorkoutExercises(exercises: ExerciseData[]): {
  main: ExerciseData[];
  accessories: ExerciseData[];
} {
  const main: ExerciseData[] = [];
  const accessories: ExerciseData[] = [];
  for (const exercise of exercises) {
    if (isAccessoryExercise(exercise)) accessories.push(exercise);
    else main.push(exercise);
  }
  return { main, accessories };
}

export type MesocycleStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED';
export type MicrocycleStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED';
export type WorkoutStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'MISSED';

export function isWorkoutCompleted(status: string): boolean {
  return status === 'COMPLETED' || status === 'Completed';
}

export function isWorkoutInProgress(status: string): boolean {
  return status === 'IN_PROGRESS' || status === 'Today';
}

export function isMicrocycleCompleted(status: string): boolean {
  return status === 'COMPLETED' || status === 'Verified';
}

export function isMicrocycleActive(status: string): boolean {
  return status === 'ACTIVE' || status === 'In Progress';
}

export interface WorkoutData {
  id: string;
  date: string; // YYYY-MM-DD
  dayLabel: string; // e.g. "D1"
  title: string;
  athleteBw?: number;
  tonnage: number;
  delta: number;
  color: 'mac-green' | 'mac-blue' | 'orange' | 'gray';
  exercises: ExerciseData[];
  status: WorkoutStatus;
}

export interface MicrocycleData {
  id: string;
  weekName: string; // "Microcycle 01"
  focus: string;
  status: MicrocycleStatus;
  active?: boolean;
  workouts: WorkoutData[];
}

export interface MesocycleData {
  id: string;
  name: string;
  status: MesocycleStatus;
  color: string; // css classes or raw colors, e.g. "border-mac-blue text-mac-blue"
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

export { INITIAL_MESOCYCLE, INITIAL_MICROCYCLES, ZAHAR_ATHLETE } from './data/zaharAthleteProfile';

export interface AICoachResponse {
  cns_readiness: {
    status: 'Functional Adaptation' | 'Neural Fatigue Suppression' | 'Detraining';
    score: number; // 0-100 neural score
    analysis: string; // Exactly two sentences explaining the ACWR ratio
  };
  movement_diagnostics: {
    squat_fatigue: { status: 'Optimal' | 'Caution' | 'Danger'; inol: number; warning: string };
    bench_fatigue: { status: 'Optimal' | 'Caution' | 'Danger'; inol: number; warning: string };
    deadlift_fatigue: { status: 'Optimal' | 'Caution' | 'Danger'; inol: number; warning: string };
  };
  microcycle_prescription: {
    loading_strategy: 'Maintain Baseline' | 'Escalate Tonnage (+10%)' | 'Load Drop Downsets (-5%)' | 'Deload Decompression (-20%)';
    tactical_guidance: string; // Actionable RTS periodization guidelines
    suggested_rpe_cap: number; // e.g. 8.0, 8.5, 9.0
  };
  attempt_feedback: {
    opener_feasibility: 'Conservative' | 'Optimal' | 'High-Risk';
    coaching_notes: string; // Analysis of attempt jumps
  };
}

