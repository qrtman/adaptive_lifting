import { describe, expect, it } from 'vitest';
import { ZAHAR_ATHLETE_ID, ZAHAR_BLOCK_31, isImportedLocalPlan, planForAthlete } from './zaharBlock';

function setsOf(weekId: string, day: string, title: string) {
  const week = ZAHAR_BLOCK_31.find((micro) => micro.id === weekId);
  const workout = week?.workouts.find((row) => row.dayLabel === day);
  const exercise = workout?.exercises.find((row) => row.title === title);
  return exercise?.sets ?? [];
}

describe('Zahar Block 3.1 CSV conversion', () => {
  it('uses week 3 D1 executed kg/reps/RPE from the CSV, not invented waves', () => {
    const dl = setsOf('z-w3', 'D1', 'Sumo deadlift');
    expect(dl.map((set) => set.actual)).toEqual([185, 157.5, 150, 150]);
    expect(dl.map((set) => set.reps)).toEqual([1, 4, 4, 4]);
    expect(dl.map((set) => set.executedRpe)).toEqual([6, 6, 5, 5]);
    expect(dl.map((set) => set.plannedWeight)).toEqual([185, 157.5, 152.5, 152.5]);
    expect(dl.map((set) => set.plannedRpe)).toEqual([6, 5.5, 5, 5]);
    expect(dl[0]?.isTop).toBe(true);
    const squat = setsOf('z-w3', 'D2', 'Low Bar Squat');
    expect(squat[0]?.actual).toBe(165);
    expect(squat[0]?.executedRpe).toBe(6);
  });

  it('uses week 5 D1 deadlift top single 210 × 1 @ 7.5', () => {
    const top = setsOf('z-w5', 'D1', 'Sumo deadlift')[0];
    expect(top?.actual).toBe(210);
    expect(top?.reps).toBe(1);
    expect(top?.executedRpe).toBe(7.5);
    expect(top?.plannedWeight).toBe(195);
    expect(top?.plannedRpe).toBe(8);
    expect(top?.note).toBe('195~200');
  });

  it('keeps 10-12 as a rep-range note, not a calendar date', () => {
    const week = ZAHAR_BLOCK_31.find((micro) => micro.id === 'z-w3');
    for (const workout of week?.workouts ?? []) {
      expect(workout.date).toBe('');
    }
    const rows = week?.workouts[0].exercises.find((ex) => ex.title === 'horizontal pull/t bar row')?.sets;
    expect(rows?.length).toBe(3);
    expect(rows?.[0].plannedReps).toBe(10);
    expect(rows?.[0].plannedRpe).toBe(9);
    expect(rows?.[0].plannedWeight).toBeNull();
    expect(rows?.[0].note).toBe('10-12');
  });

  it('includes week 6 executed logs from the pivot columns', () => {
    const dl = setsOf('z-w6', 'D1', 'Sumo deadlift');
    expect(dl.map((set) => set.actual)).toEqual([190, 177.5, 150, 150]);
    expect(dl.map((set) => set.executedRpe)).toEqual([7, 6, 5, 5]);
  });

  it('maps only Zahar to that plan', () => {
    expect(planForAthlete(ZAHAR_ATHLETE_ID)?.length).toBe(4);
    expect(planForAthlete('athlete-other')).toBeNull();
    expect(isImportedLocalPlan(ZAHAR_BLOCK_31)).toBe(true);
  });
});
