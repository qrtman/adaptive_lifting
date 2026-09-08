import {
  ExerciseData,
  MicrocycleData,
  SetData,
  WorkoutData,
  WorkoutStatus,
} from '../types';

/** One-time structured conversion of Zahar Block 3.1 (CSV weeks 3–6). Not a live CSV parser. */
export const ZAHAR_ATHLETE_ID = 'athlete-zahar';

type Executed = { kg: number; reps: number };

type Wave = {
  drop: number;
  plannedReps: number;
  rpe: number;
  executed?: Executed[];
};

type AccRow = { kg: number; reps: number; copies?: number };

function waveSets(prefix: string, waves: Wave[]): SetData[] {
  const sets: SetData[] = [];
  waves.forEach((wave, wi) => {
    const copies = wave.executed?.length ?? 1;
    for (let i = 0; i < copies; i += 1) {
      const logged = wave.executed?.[i];
      const last = wi === waves.length - 1 && i === copies - 1;
      sets.push({
        id: `${prefix}-s${wi + 1}-${i + 1}`,
        label: last ? 'Top' : `Set ${sets.length + 1}`,
        plannedWeight: null,
        plannedReps: wave.plannedReps,
        plannedRpe: wave.rpe,
        dropPercent: wave.drop,
        isTop: last,
        actual: logged?.kg ?? null,
        reps: logged?.reps ?? null,
        executedRpe: logged ? wave.rpe : null,
      });
    }
  });
  return sets;
}

function accSets(prefix: string, rows: AccRow[]): SetData[] {
  const sets: SetData[] = [];
  rows.forEach((row, ri) => {
    const copies = row.copies ?? 1;
    for (let i = 0; i < copies; i += 1) {
      sets.push({
        id: `${prefix}-s${ri + 1}-${i + 1}`,
        label: `Set ${sets.length + 1}`,
        plannedWeight: row.kg,
        plannedReps: row.reps,
        plannedRpe: 8,
        actual: null,
        reps: null,
        executedRpe: null,
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
  const top = [...sets].reverse().find((set) => (set.actual ?? 0) > 0) ?? sets[sets.length - 1];
  if (!top) return '—';
  const kg = top.actual ?? top.plannedWeight;
  const reps = top.reps ?? top.plannedReps;
  if (kg == null || reps == null) {
    return top.plannedRpe != null ? `RPE ${top.plannedRpe}` : '—';
  }
  return `${kg}kg x ${reps}`;
}

function main(
  id: string,
  title: string,
  variation: string,
  liftCategory: ExerciseData['liftCategory'],
  waves: Wave[],
): ExerciseData {
  const sets = waveSets(id, waves);
  return {
    id,
    title,
    variation,
    tier: variation.toLowerCase().includes('comp') ? 'Comp' : 'Variation',
    liftCategory,
    tags: [liftCategory ?? 'Other'],
    top: topLabel(sets),
    vol: `${volKg(sets).toLocaleString()}kg`,
    sets,
  };
}

function acc(id: string, title: string, rows: AccRow[]): ExerciseData {
  const sets = accSets(id, rows);
  return {
    id,
    title,
    variation: 'Accessory',
    tier: 'Accessory',
    liftCategory: 'Other',
    tags: ['Accessory'],
    top: '—',
    vol: `${volKg(sets).toLocaleString()}kg`,
    sets,
  };
}

function workout(
  id: string,
  date: string,
  dayLabel: string,
  title: string,
  status: WorkoutStatus,
  exercises: ExerciseData[],
): WorkoutData {
  const tonnage = exercises.reduce((sum, ex) => sum + volKg(ex.sets), 0);
  return {
    id,
    date,
    dayLabel,
    title,
    tonnage,
    delta: 0,
    color: status === 'COMPLETED' ? 'mac-green' : status === 'PLANNED' ? 'gray' : 'mac-blue',
    exercises,
    status,
  };
}

function week(
  id: string,
  weekName: string,
  focus: string,
  status: MicrocycleData['status'],
  workouts: WorkoutData[],
): MicrocycleData {
  return { id, weekName, focus, status, workouts };
}

const week3 = week('z-w3', 'Week 3', 'Block 3.1 volume', 'COMPLETED', [
  workout('z-w3-d1', '2026-10-06', 'D1', 'Sumo deadlift, Paused bench', 'COMPLETED', [
    main('z-w3-d1-dl', 'Sumo deadlift', 'Sumo', 'Deadlift', [
      { drop: 17, plannedReps: 4, rpe: 7, executed: [{ kg: 160, reps: 4 }, { kg: 160, reps: 4 }] },
      { drop: 10, plannedReps: 3, rpe: 8, executed: [{ kg: 172.5, reps: 3 }, { kg: 172.5, reps: 3 }] },
      { drop: 3, plannedReps: 1, rpe: 9, executed: [{ kg: 180, reps: 1 }] },
    ]),
    main('z-w3-d1-bp', 'Paused bench press', 'Competition pause', 'Bench', [
      { drop: 12, plannedReps: 4, rpe: 7, executed: [{ kg: 105, reps: 4 }, { kg: 105, reps: 4 }] },
      { drop: 7, plannedReps: 3, rpe: 8, executed: [{ kg: 110, reps: 3 }, { kg: 110, reps: 3 }] },
      { drop: 2, plannedReps: 1, rpe: 8.5, executed: [{ kg: 117.5, reps: 1 }] },
    ]),
    acc('z-w3-d1-is', 'Incline smith', [{ kg: 60, reps: 10, copies: 2 }, { kg: 62.5, reps: 8, copies: 2 }]),
    acc('z-w3-d1-tb', 'T-bar', [{ kg: 50, reps: 8, copies: 2 }, { kg: 52.5, reps: 8, copies: 2 }]),
    acc('z-w3-d1-pd', 'Pulldown', [{ kg: 77.5, reps: 8, copies: 2 }, { kg: 80, reps: 8, copies: 2 }]),
    acc('z-w3-d1-add', 'Hip adductor', [{ kg: 55, reps: 15, copies: 3 }]),
    acc('z-w3-d1-abd', 'Hip abductor', [{ kg: 55, reps: 15, copies: 3 }]),
    acc('z-w3-d1-hc', 'Seated hamstring curls', [{ kg: 40, reps: 15, copies: 4 }]),
  ]),
  workout('z-w3-d2', '2026-10-07', 'D2', 'Low bar squat, Larsen press', 'COMPLETED', [
    main('z-w3-d2-sq', 'Low Bar Squat', 'Low bar competition', 'Squat', [
      { drop: 17, plannedReps: 4, rpe: 7, executed: [{ kg: 140, reps: 4 }, { kg: 140, reps: 4 }] },
      { drop: 10, plannedReps: 3, rpe: 8, executed: [{ kg: 150, reps: 3 }, { kg: 150, reps: 3 }] },
      { drop: 3, plannedReps: 1, rpe: 9, executed: [{ kg: 160, reps: 1 }] },
    ]),
    main('z-w3-d2-bp', 'Larsen press', 'Larsen', 'Bench', [
      { drop: 12, plannedReps: 6, rpe: 7, executed: [{ kg: 80, reps: 6 }, { kg: 80, reps: 6 }] },
      { drop: 7, plannedReps: 4, rpe: 8, executed: [{ kg: 85, reps: 4 }, { kg: 85, reps: 4 }] },
      { drop: 2, plannedReps: 2, rpe: 8.5, executed: [{ kg: 90, reps: 2 }] },
    ]),
    acc('z-w3-d2-tb', 'T-bar', [{ kg: 50, reps: 8, copies: 2 }, { kg: 52.5, reps: 8, copies: 2 }]),
    acc('z-w3-d2-pd', 'Pulldown', [{ kg: 77.5, reps: 8, copies: 2 }, { kg: 80, reps: 8, copies: 2 }]),
    acc('z-w3-d2-add', 'Hip adductor', [{ kg: 55, reps: 15, copies: 3 }]),
    acc('z-w3-d2-abd', 'Hip abductor', [{ kg: 55, reps: 15, copies: 3 }]),
    acc('z-w3-d2-hc', 'Seated hamstring curls', [{ kg: 40, reps: 15, copies: 4 }]),
  ]),
  workout('z-w3-d3', '2026-10-09', 'D3', 'Paused bench, Paused sumo', 'COMPLETED', [
    main('z-w3-d3-bp', 'Paused bench press', 'Competition pause', 'Bench', [
      { drop: 12, plannedReps: 4, rpe: 7.5, executed: [{ kg: 110, reps: 4 }, { kg: 110, reps: 4 }] },
      { drop: 7, plannedReps: 3, rpe: 8.5, executed: [{ kg: 117.5, reps: 3 }, { kg: 117.5, reps: 3 }] },
      { drop: 2, plannedReps: 1, rpe: 9, executed: [{ kg: 122.5, reps: 1 }] },
    ]),
    main('z-w3-d3-dl', 'Paused sumo deadlift', 'Paused sumo', 'Deadlift', [
      { drop: 17, plannedReps: 3, rpe: 7.5, executed: [{ kg: 155, reps: 3 }, { kg: 155, reps: 3 }] },
      { drop: 10, plannedReps: 2, rpe: 8.5, executed: [{ kg: 167.5, reps: 2 }, { kg: 167.5, reps: 2 }] },
      { drop: 3, plannedReps: 1, rpe: 9.5, executed: [{ kg: 177.5, reps: 1 }] },
    ]),
    acc('z-w3-d3-is', 'Incline smith', [{ kg: 60, reps: 10, copies: 2 }, { kg: 62.5, reps: 8, copies: 2 }]),
    acc('z-w3-d3-tb', 'T-bar', [{ kg: 50, reps: 8, copies: 2 }, { kg: 52.5, reps: 8, copies: 2 }]),
    acc('z-w3-d3-pd', 'Pulldown', [{ kg: 77.5, reps: 8, copies: 2 }, { kg: 80, reps: 8, copies: 2 }]),
  ]),
  workout('z-w3-d4', '2026-10-10', 'D4', 'SSB high bar paused squat', 'COMPLETED', [
    main('z-w3-d4-sq', 'SSB High bar paused squat', 'SSB paused', 'Squat', [
      { drop: 12, plannedReps: 5, rpe: 7, executed: [{ kg: 100, reps: 5 }, { kg: 100, reps: 5 }] },
      { drop: 7, plannedReps: 4, rpe: 8, executed: [{ kg: 107.5, reps: 4 }, { kg: 107.5, reps: 4 }] },
      { drop: 2, plannedReps: 2, rpe: 8.5, executed: [{ kg: 115, reps: 2 }] },
    ]),
    acc('z-w3-d4-lp', 'Leg press', [{ kg: 140, reps: 10, copies: 2 }, { kg: 150, reps: 8, copies: 2 }]),
    acc('z-w3-d4-le', 'Leg extension', [{ kg: 50, reps: 12, copies: 3 }]),
    acc('z-w3-d4-add', 'Hip adductor', [{ kg: 55, reps: 15, copies: 3 }]),
    acc('z-w3-d4-abd', 'Hip abductor', [{ kg: 55, reps: 15, copies: 3 }]),
  ]),
]);

const week4 = week('z-w4', 'Week 4', 'Block 3.1 intensification', 'COMPLETED', [
  workout('z-w4-d1', '2026-10-13', 'D1', 'Sumo deadlift, Paused bench', 'COMPLETED', [
    main('z-w4-d1-dl', 'Sumo deadlift', 'Sumo', 'Deadlift', [
      { drop: 17, plannedReps: 3, rpe: 7, executed: [{ kg: 172.5, reps: 3 }, { kg: 172.5, reps: 3 }] },
      { drop: 10, plannedReps: 2, rpe: 8, executed: [{ kg: 185, reps: 2 }, { kg: 185, reps: 2 }] },
      { drop: 3, plannedReps: 1, rpe: 9, executed: [{ kg: 195, reps: 1 }] },
    ]),
    main('z-w4-d1-bp', 'Paused bench press', 'Competition pause', 'Bench', [
      { drop: 12, plannedReps: 3, rpe: 7, executed: [{ kg: 112.5, reps: 3 }, { kg: 112.5, reps: 3 }] },
      { drop: 7, plannedReps: 2, rpe: 8, executed: [{ kg: 117.5, reps: 2 }, { kg: 117.5, reps: 2 }] },
      { drop: 2, plannedReps: 1, rpe: 8.5, executed: [{ kg: 125, reps: 1 }] },
    ]),
    acc('z-w4-d1-is', 'Incline smith', [{ kg: 62.5, reps: 8, copies: 2 }, { kg: 65, reps: 6, copies: 2 }]),
    acc('z-w4-d1-tb', 'T-bar', [{ kg: 52.5, reps: 8, copies: 2 }, { kg: 55, reps: 8, copies: 2 }]),
    acc('z-w4-d1-pd', 'Pulldown', [{ kg: 80, reps: 8, copies: 2 }, { kg: 82.5, reps: 8, copies: 2 }]),
  ]),
  workout('z-w4-d2', '2026-10-14', 'D2', 'Low bar squat, Larsen press', 'COMPLETED', [
    main('z-w4-d2-sq', 'Low Bar Squat', 'Low bar competition', 'Squat', [
      { drop: 17, plannedReps: 3, rpe: 7, executed: [{ kg: 150, reps: 3 }, { kg: 150, reps: 3 }] },
      { drop: 10, plannedReps: 2, rpe: 8, executed: [{ kg: 162.5, reps: 2 }, { kg: 162.5, reps: 2 }] },
      { drop: 3, plannedReps: 1, rpe: 9, executed: [{ kg: 172.5, reps: 1 }] },
    ]),
    main('z-w4-d2-bp', 'Larsen press', 'Larsen', 'Bench', [
      { drop: 12, plannedReps: 5, rpe: 7, executed: [{ kg: 85, reps: 5 }, { kg: 85, reps: 5 }] },
      { drop: 7, plannedReps: 3, rpe: 8, executed: [{ kg: 90, reps: 3 }, { kg: 90, reps: 3 }] },
      { drop: 2, plannedReps: 1, rpe: 8.5, executed: [{ kg: 95, reps: 1 }] },
    ]),
    acc('z-w4-d2-tb', 'T-bar', [{ kg: 52.5, reps: 8, copies: 2 }, { kg: 55, reps: 8, copies: 2 }]),
    acc('z-w4-d2-pd', 'Pulldown', [{ kg: 80, reps: 8, copies: 2 }, { kg: 82.5, reps: 8, copies: 2 }]),
  ]),
  workout('z-w4-d3', '2026-10-16', 'D3', 'Paused bench, Paused sumo', 'COMPLETED', [
    main('z-w4-d3-bp', 'Paused bench press', 'Competition pause', 'Bench', [
      { drop: 12, plannedReps: 3, rpe: 7.5, executed: [{ kg: 117.5, reps: 3 }, { kg: 117.5, reps: 3 }] },
      { drop: 7, plannedReps: 2, rpe: 8.5, executed: [{ kg: 125, reps: 2 }, { kg: 125, reps: 2 }] },
      { drop: 2, plannedReps: 1, rpe: 9, executed: [{ kg: 130, reps: 1 }] },
    ]),
    main('z-w4-d3-dl', 'Paused sumo deadlift', 'Paused sumo', 'Deadlift', [
      { drop: 17, plannedReps: 2, rpe: 7.5, executed: [{ kg: 167.5, reps: 2 }, { kg: 167.5, reps: 2 }] },
      { drop: 10, plannedReps: 1, rpe: 8.5, executed: [{ kg: 180, reps: 1 }, { kg: 180, reps: 1 }] },
      { drop: 3, plannedReps: 1, rpe: 9.5, executed: [{ kg: 190, reps: 1 }] },
    ]),
    acc('z-w4-d3-is', 'Incline smith', [{ kg: 62.5, reps: 8, copies: 2 }, { kg: 65, reps: 6, copies: 2 }]),
  ]),
  workout('z-w4-d4', '2026-10-17', 'D4', 'SSB high bar paused squat', 'COMPLETED', [
    main('z-w4-d4-sq', 'SSB High bar paused squat', 'SSB paused', 'Squat', [
      { drop: 12, plannedReps: 4, rpe: 7, executed: [{ kg: 107.5, reps: 4 }, { kg: 107.5, reps: 4 }] },
      { drop: 7, plannedReps: 3, rpe: 8, executed: [{ kg: 115, reps: 3 }, { kg: 115, reps: 3 }] },
      { drop: 2, plannedReps: 1, rpe: 8.5, executed: [{ kg: 122.5, reps: 1 }] },
    ]),
    acc('z-w4-d4-lp', 'Leg press', [{ kg: 150, reps: 8, copies: 2 }, { kg: 160, reps: 6, copies: 2 }]),
    acc('z-w4-d4-le', 'Leg extension', [{ kg: 52.5, reps: 10, copies: 3 }]),
  ]),
]);

const week5 = week('z-w5', 'Week 5', 'Block 3.1 heavy week', 'COMPLETED', [
  workout('z-w5-d1', '2026-10-20', 'D1', 'Sumo deadlift, Paused bench', 'COMPLETED', [
    main('z-w5-d1-dl', 'Sumo deadlift', 'Sumo', 'Deadlift', [
      { drop: 17, plannedReps: 2, rpe: 7, executed: [{ kg: 185, reps: 2 }, { kg: 185, reps: 2 }] },
      { drop: 10, plannedReps: 1, rpe: 8, executed: [{ kg: 197.5, reps: 1 }, { kg: 197.5, reps: 1 }] },
      { drop: 3, plannedReps: 1, rpe: 9, executed: [{ kg: 210, reps: 1 }] },
    ]),
    main('z-w5-d1-bp', 'Paused bench press', 'Competition pause', 'Bench', [
      { drop: 12, plannedReps: 2, rpe: 7, executed: [{ kg: 117.5, reps: 2 }, { kg: 117.5, reps: 2 }] },
      { drop: 7, plannedReps: 1, rpe: 8, executed: [{ kg: 125, reps: 1 }, { kg: 125, reps: 1 }] },
      { drop: 2, plannedReps: 1, rpe: 8.5, executed: [{ kg: 132.5, reps: 1 }] },
    ]),
    acc('z-w5-d1-is', 'Incline smith', [{ kg: 65, reps: 6, copies: 2 }, { kg: 67.5, reps: 6, copies: 2 }]),
    acc('z-w5-d1-tb', 'T-bar', [{ kg: 55, reps: 6, copies: 2 }, { kg: 57.5, reps: 6, copies: 2 }]),
    acc('z-w5-d1-pd', 'Pulldown', [{ kg: 82.5, reps: 6, copies: 2 }, { kg: 85, reps: 6, copies: 2 }]),
  ]),
  workout('z-w5-d2', '2026-10-21', 'D2', 'Low bar squat, Larsen press', 'COMPLETED', [
    main('z-w5-d2-sq', 'Low Bar Squat', 'Low bar competition', 'Squat', [
      { drop: 17, plannedReps: 2, rpe: 7, executed: [{ kg: 162.5, reps: 2 }, { kg: 162.5, reps: 2 }] },
      { drop: 10, plannedReps: 1, rpe: 8, executed: [{ kg: 175, reps: 1 }, { kg: 175, reps: 1 }] },
      { drop: 3, plannedReps: 1, rpe: 9, executed: [{ kg: 185, reps: 1 }] },
    ]),
    main('z-w5-d2-bp', 'Larsen press', 'Larsen', 'Bench', [
      { drop: 12, plannedReps: 4, rpe: 7, executed: [{ kg: 90, reps: 4 }, { kg: 90, reps: 4 }] },
      { drop: 7, plannedReps: 2, rpe: 8, executed: [{ kg: 95, reps: 2 }, { kg: 95, reps: 2 }] },
      { drop: 2, plannedReps: 1, rpe: 8.5, executed: [{ kg: 100, reps: 1 }] },
    ]),
    acc('z-w5-d2-tb', 'T-bar', [{ kg: 55, reps: 6, copies: 2 }, { kg: 57.5, reps: 6, copies: 2 }]),
    acc('z-w5-d2-pd', 'Pulldown', [{ kg: 82.5, reps: 6, copies: 2 }, { kg: 85, reps: 6, copies: 2 }]),
  ]),
  workout('z-w5-d3', '2026-10-23', 'D3', 'Paused bench, Paused sumo', 'COMPLETED', [
    main('z-w5-d3-bp', 'Paused bench press', 'Competition pause', 'Bench', [
      { drop: 12, plannedReps: 2, rpe: 7.5, executed: [{ kg: 125, reps: 2 }, { kg: 125, reps: 2 }] },
      { drop: 7, plannedReps: 1, rpe: 8.5, executed: [{ kg: 132.5, reps: 1 }, { kg: 132.5, reps: 1 }] },
      { drop: 2, plannedReps: 1, rpe: 9, executed: [{ kg: 137.5, reps: 1 }] },
    ]),
    main('z-w5-d3-dl', 'Paused sumo deadlift', 'Paused sumo', 'Deadlift', [
      { drop: 17, plannedReps: 1, rpe: 7.5, executed: [{ kg: 180, reps: 1 }, { kg: 180, reps: 1 }] },
      { drop: 10, plannedReps: 1, rpe: 8.5, executed: [{ kg: 192.5, reps: 1 }, { kg: 192.5, reps: 1 }] },
      { drop: 3, plannedReps: 1, rpe: 9.5, executed: [{ kg: 202.5, reps: 1 }] },
    ]),
    acc('z-w5-d3-is', 'Incline smith', [{ kg: 65, reps: 6, copies: 2 }, { kg: 67.5, reps: 6, copies: 2 }]),
  ]),
  workout('z-w5-d4', '2026-10-24', 'D4', 'SSB high bar paused squat', 'COMPLETED', [
    main('z-w5-d4-sq', 'SSB High bar paused squat', 'SSB paused', 'Squat', [
      { drop: 12, plannedReps: 3, rpe: 7, executed: [{ kg: 115, reps: 3 }, { kg: 115, reps: 3 }] },
      { drop: 7, plannedReps: 2, rpe: 8, executed: [{ kg: 122.5, reps: 2 }, { kg: 122.5, reps: 2 }] },
      { drop: 2, plannedReps: 1, rpe: 8.5, executed: [{ kg: 130, reps: 1 }] },
    ]),
    acc('z-w5-d4-lp', 'Leg press', [{ kg: 160, reps: 6, copies: 2 }, { kg: 170, reps: 6, copies: 2 }]),
    acc('z-w5-d4-le', 'Leg extension', [{ kg: 55, reps: 8, copies: 3 }]),
  ]),
]);

const week6 = week('z-w6', 'Week 6', 'Block 3.1 pivot', 'ACTIVE', [
  workout('z-w6-d1', '2026-10-27', 'D1', 'Sumo deadlift, Paused bench', 'PLANNED', [
    main('z-w6-d1-dl', 'Sumo deadlift', 'Sumo', 'Deadlift', [
      { drop: 17, plannedReps: 1, rpe: 7 },
      { drop: 10, plannedReps: 1, rpe: 8 },
      { drop: 3, plannedReps: 1, rpe: 9 },
    ]),
    main('z-w6-d1-bp', 'Paused bench press', 'Competition pause', 'Bench', [
      { drop: 12, plannedReps: 1, rpe: 7 },
      { drop: 7, plannedReps: 1, rpe: 8 },
      { drop: 2, plannedReps: 1, rpe: 8.5 },
    ]),
    acc('z-w6-d1-is', 'Incline smith', [{ kg: 67.5, reps: 6, copies: 2 }, { kg: 70, reps: 5, copies: 2 }]),
    acc('z-w6-d1-tb', 'T-bar', [{ kg: 57.5, reps: 6, copies: 2 }, { kg: 60, reps: 6, copies: 2 }]),
    acc('z-w6-d1-pd', 'Pulldown', [{ kg: 85, reps: 6, copies: 2 }, { kg: 87.5, reps: 6, copies: 2 }]),
  ]),
  workout('z-w6-d2', '2026-10-28', 'D2', 'SSB squat, Close-grip bench', 'PLANNED', [
    main('z-w6-d2-sq', 'SSB squat', 'SSB', 'Squat', [
      { drop: 17, plannedReps: 3, rpe: 7 },
      { drop: 10, plannedReps: 2, rpe: 8 },
      { drop: 3, plannedReps: 1, rpe: 9 },
    ]),
    main('z-w6-d2-bp', 'Close-grip bench', 'Close grip', 'Bench', [
      { drop: 12, plannedReps: 4, rpe: 7 },
      { drop: 7, plannedReps: 3, rpe: 8 },
      { drop: 2, plannedReps: 2, rpe: 8.5 },
    ]),
    acc('z-w6-d2-tb', 'T-bar', [{ kg: 57.5, reps: 6, copies: 2 }, { kg: 60, reps: 6, copies: 2 }]),
    acc('z-w6-d2-pd', 'Pulldown', [{ kg: 85, reps: 6, copies: 2 }, { kg: 87.5, reps: 6, copies: 2 }]),
  ]),
  workout('z-w6-d3', '2026-10-30', 'D3', 'Low bar squat, Paused bench', 'PLANNED', [
    main('z-w6-d3-sq', 'Low Bar Squat', 'Low bar competition', 'Squat', [
      { drop: 17, plannedReps: 2, rpe: 7.5 },
      { drop: 10, plannedReps: 1, rpe: 8.5 },
      { drop: 3, plannedReps: 1, rpe: 9.5 },
    ]),
    main('z-w6-d3-bp', 'Paused bench press', 'Competition pause', 'Bench', [
      { drop: 12, plannedReps: 2, rpe: 7.5 },
      { drop: 7, plannedReps: 1, rpe: 8.5 },
      { drop: 2, plannedReps: 1, rpe: 9 },
    ]),
    acc('z-w6-d3-is', 'Incline smith', [{ kg: 67.5, reps: 6, copies: 2 }, { kg: 70, reps: 5, copies: 2 }]),
  ]),
  workout('z-w6-d4', '2026-10-31', 'D4', 'Paused sumo deadlift', 'PLANNED', [
    main('z-w6-d4-dl', 'Paused sumo deadlift', 'Paused sumo', 'Deadlift', [
      { drop: 17, plannedReps: 2, rpe: 7 },
      { drop: 10, plannedReps: 1, rpe: 8 },
      { drop: 3, plannedReps: 1, rpe: 9 },
    ]),
    acc('z-w6-d4-lp', 'Leg press', [{ kg: 170, reps: 6, copies: 2 }, { kg: 180, reps: 5, copies: 2 }]),
    acc('z-w6-d4-le', 'Leg extension', [{ kg: 57.5, reps: 8, copies: 3 }]),
  ]),
]);

export const ZAHAR_BLOCK_31: MicrocycleData[] = [week3, week4, week5, week6];

export function planForAthlete(athleteId: string): MicrocycleData[] | null {
  if (athleteId === ZAHAR_ATHLETE_ID) return ZAHAR_BLOCK_31;
  return null;
}

export function isImportedLocalPlan(microcycles: MicrocycleData[]): boolean {
  return microcycles.some((micro) => micro.id.startsWith('z-w'));
}
