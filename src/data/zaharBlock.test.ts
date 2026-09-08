import { describe, expect, it } from 'vitest';
import { ZAHAR_ATHLETE_ID, ZAHAR_BLOCK_31, isImportedLocalPlan, planForAthlete } from './zaharBlock';

describe('Zahar Block 3.1', () => {
  it('is four structured microcycles with numeric set values', () => {
    expect(ZAHAR_BLOCK_31.map((week) => week.id)).toEqual(['z-w3', 'z-w4', 'z-w5', 'z-w6']);
    const week5d1 = ZAHAR_BLOCK_31[2].workouts[0];
    expect(week5d1.exercises[0].title).toBe('Sumo deadlift');
    const top = week5d1.exercises[0].sets.find((set) => set.isTop);
    expect(top?.actual).toBe(210);
    expect(top?.reps).toBe(1);
    expect(top?.plannedRpe).toBe(9);
    expect(typeof top?.actual).toBe('number');
  });

  it('maps only Zahar to that plan', () => {
    expect(planForAthlete(ZAHAR_ATHLETE_ID)?.length).toBe(4);
    expect(planForAthlete('athlete-other')).toBeNull();
    expect(isImportedLocalPlan(ZAHAR_BLOCK_31)).toBe(true);
  });
});
