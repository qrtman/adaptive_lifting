import { expect, it } from 'vitest';
import { findConflictTarget } from './conflictTarget';

const plan = [{ workouts: [{ id: 'w1', date: '2026-11-03', title: 'Squat day', exercises: [
  { id: 'e1', name: 'Back Squat', sets: [{ id: 's1' }, { id: 's2' }] },
] }] }];

it('resolves session, lift and set number from the local plan snapshot', () => {
  expect(findConflictTarget(plan, { entity_type: 'ExerciseSet', entity_id: 's2' }))
    .toEqual({ sessionDate: '2026-11-03', sessionTitle: 'Squat day', liftName: 'Back Squat', setNumber: 2 });
  expect(findConflictTarget(plan, { entity_type: 'Exercise', entity_id: 'e1' })?.liftName).toBe('Back Squat');
  expect(findConflictTarget(plan, { entity_type: 'Workout', entity_id: 'w1' })?.sessionTitle).toBe('Squat day');
  expect(findConflictTarget(plan, { entity_type: 'ExerciseSet', entity_id: 'missing' })).toBeNull();
  expect(findConflictTarget(null, { entity_type: 'ExerciseSet', entity_id: 's1' })).toBeNull();
});
