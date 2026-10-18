import { describe, expect, it } from 'vitest';
import { ApiError } from '../../supabase/functions/_shared/errors/mod.ts';
import { parseExercisePatchInput } from '../../supabase/functions/_shared/updateExerciseRoute.ts';

describe('Exercise PATCH request contract', () => {
  it('treats missing and null fields as unchanged and accepts an empty order', () => {
    expect(parseExercisePatchInput({})).toEqual({
      variation: null,
      title: null,
      tier: null,
      liftCategory: null,
      movementPattern: null,
      liftNote: null,
      move: null,
      order: null,
    });
    expect(parseExercisePatchInput({ title: null, order: [] }).order).toEqual([]);
  });

  it('rejects malformed optional string fields and order element types', () => {
    for (const key of ['title', 'variation', 'tier', 'liftCategory', 'movementPattern', 'liftNote', 'move']) {
      expect(() => parseExercisePatchInput({ [key]: 17 })).toThrow(ApiError);
    }
    expect(() => parseExercisePatchInput({ order: 'e-1' })).toThrow(ApiError);
    expect(() => parseExercisePatchInput({ order: ['e-1', 2] })).toThrow(ApiError);
  });

  it('preserves supplied strings and full order as-is for route semantics', () => {
    expect(parseExercisePatchInput({ title: ' Squat ', movementPattern: '', move: ' Down ', order: ['e-2', 'e-1'] })).toEqual({
      variation: null,
      title: ' Squat ',
      tier: null,
      liftCategory: null,
      movementPattern: '',
      liftNote: null,
      move: ' Down ',
      order: ['e-2', 'e-1'],
    });
  });
});
