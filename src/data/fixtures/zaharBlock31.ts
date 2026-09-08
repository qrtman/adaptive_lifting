import payload from './zaharBlock31.json';
import type { ImportedPlan } from '../athletePlans';
import {
  ExerciseData,
  LocalAthlete,
  MicrocycleData,
  SetData,
  WorkoutData,
  WorkoutStatus,
} from '../../types';

/**
 * Fixture: one real athlete's block, converted offline by
 * `scripts/convert-zahar-block.py`. This is sample data, not specification —
 * nothing outside this directory may branch on the athlete or the block name.
 */
export const ZAHAR_ATHLETE_ID = 'athlete-zahar';

type CsvSet = {
  copies: number;
  plannedReps: number | null;
  repsNote: string | null;
  plannedRpe: number | null;
  plannedWeight: number | null;
  weightNote: string | null;
  dropPercent: number | null;
  actual: number | null;
  reps: number | null;
  executedRpe: number | null;
};

type CsvExercise = {
  title: string;
  variation: string;
  accessory: boolean;
  sets: CsvSet[];
};

type CsvDay = {
  dayLabel: string;
  exercises: CsvExercise[];
};

type CsvWeek = {
  id: string;
  weekName: string;
  focus: string;
  days: CsvDay[];
};

function noteFor(row: CsvSet): string | undefined {
  const parts = [row.repsNote, row.weightNote].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

function expandSets(prefix: string, rows: CsvSet[], accessory: boolean): SetData[] {
  const sets: SetData[] = [];
  rows.forEach((row, ri) => {
    const copies = Math.max(1, row.copies || 1);
    for (let i = 0; i < copies; i += 1) {
      const index = sets.length;
      sets.push({
        id: `${prefix}-s${ri + 1}-${i + 1}`,
        label: !accessory && index === 0 ? 'Top' : `Set ${index + 1}`,
        plannedWeight: row.plannedWeight,
        plannedReps: row.plannedReps,
        plannedRpe: row.plannedRpe,
        dropPercent: row.dropPercent ?? undefined,
        isTop: !accessory && index === 0,
        actual: row.actual,
        reps: row.reps,
        executedRpe: row.executedRpe,
        note: noteFor(row),
      });
    }
  });
  return sets;
}

function volKg(sets: SetData[]): number {
  return sets.reduce((sum, set) => {
    const kg = set.actual ?? set.plannedWeight ?? 0;
    const reps = set.reps ?? set.plannedReps ?? 0;
    return sum + kg * reps;
  }, 0);
}

function topLabel(sets: SetData[]): string {
  const top = sets.find((set) => set.isTop) ?? sets[0];
  if (!top) return '—';
  const kg = top.actual ?? top.plannedWeight;
  const reps = top.reps ?? top.plannedReps;
  if (kg == null || reps == null) return '—';
  return `${kg}kg x ${reps}`;
}

function liftCategory(title: string, variation: string): ExerciseData['liftCategory'] {
  const blob = `${title} ${variation}`.toLowerCase();
  if (blob.includes('squat')) return 'Squat';
  if (blob.includes('bench') || blob.includes('larsen')) return 'Bench';
  if (blob.includes('dead')) return 'Deadlift';
  return 'Other';
}

function displayNames(ex: CsvExercise): { title: string; variation: string } {
  const title = ex.title.toLowerCase();
  const variation = ex.variation.toLowerCase();
  if (ex.accessory) {
    const cleaned = ex.title
      .replace(/humstring/i, 'Hamstring')
      .replace(/extesion/i, 'extension');
    return { title: cleaned, variation: 'Accessory' };
  }
  if (title.includes('deadlift') && variation.includes('paused')) {
    return { title: 'Paused sumo deadlift', variation: ex.variation || 'Paused sumo' };
  }
  if (title.includes('deadlift')) {
    return { title: 'Sumo deadlift', variation: ex.variation || 'Sumo' };
  }
  if (title.includes('bench') && variation.includes('larsen')) {
    return { title: 'Larsen press', variation: 'Larsen' };
  }
  if (title.includes('bench') && variation.includes('closer')) {
    return { title: 'Close-grip bench', variation: ex.variation };
  }
  if (title.includes('bench')) {
    return { title: 'Paused bench press', variation: ex.variation || 'Competition pause' };
  }
  if (title.includes('squat') && variation.includes('ssb')) {
    return { title: 'SSB High bar paused squat', variation: ex.variation };
  }
  if (title.includes('squat')) {
    return { title: 'Low Bar Squat', variation: ex.variation || 'Low bar' };
  }
  return { title: ex.title, variation: ex.variation || ex.title };
}

function toExercise(weekId: string, dayLabel: string, index: number, ex: CsvExercise): ExerciseData {
  const id = `${weekId}-${dayLabel.toLowerCase()}-e${index + 1}`;
  const names = displayNames(ex);
  const sets = expandSets(id, ex.sets, ex.accessory);
  return {
    id,
    title: names.title,
    variation: names.variation,
    tier: ex.accessory ? 'Accessory' : 'Comp',
    liftCategory: liftCategory(ex.title, ex.variation),
    tags: [ex.accessory ? 'Accessory' : liftCategory(ex.title, ex.variation) ?? 'Other'],
    top: topLabel(sets),
    vol: `${volKg(sets).toLocaleString()}kg`,
    sets,
  };
}

function dayTitle(exercises: ExerciseData[]): string {
  const mains = exercises.filter((ex) => ex.tier !== 'Accessory').map((ex) => ex.title);
  return mains.slice(0, 2).join(', ');
}

function dayStatus(exercises: ExerciseData[]): WorkoutStatus {
  const logged = exercises.some((ex) => ex.sets.some((set) => (set.actual ?? 0) > 0));
  return logged ? 'COMPLETED' : 'PLANNED';
}

function toWorkout(weekId: string, day: CsvDay): WorkoutData {
  const exercises = day.exercises.map((ex, i) => toExercise(weekId, day.dayLabel, i, ex));
  const status = dayStatus(exercises);
  return {
    id: `${weekId}-${day.dayLabel.toLowerCase()}`,
    date: '',
    dayLabel: day.dayLabel,
    title: dayTitle(exercises),
    tonnage: exercises.reduce((sum, ex) => sum + volKg(ex.sets), 0),
    delta: 0,
    color: status === 'COMPLETED' ? 'mac-green' : 'gray',
    exercises,
    status,
  };
}

function toMicrocycle(week: CsvWeek): MicrocycleData {
  const workouts = week.days.map((day) => toWorkout(week.id, day));
  const allDone = workouts.length > 0 && workouts.every((w) => w.status === 'COMPLETED');
  return {
    id: week.id,
    weekName: week.weekName,
    focus: week.focus,
    status: allDone ? 'COMPLETED' : 'ACTIVE',
    workouts,
  };
}

const MICROCYCLES: MicrocycleData[] = (payload as { weeks: CsvWeek[] }).weeks.map(toMicrocycle);

export const ZAHAR_BLOCK_31: ImportedPlan = {
  athleteId: ZAHAR_ATHLETE_ID,
  blockName: 'Block 3.1',
  microcycles: MICROCYCLES,
};

/** Week 5 executed top singles, as numeric e1RM rather than parsed Rx text. */
export const ZAHAR_ATHLETE: LocalAthlete = {
  id: ZAHAR_ATHLETE_ID,
  name: 'Zahar',
  email: null,
  currentBlock: ZAHAR_BLOCK_31.blockName,
  activeMicrocycles: 1,
  peakE1RM: {
    squat: 191.1,
    bench: 135.6,
    deadlift: 231.5,
  },
  linked: false,
};
