import { describe, expect, it } from 'vitest';
import { summarizeExerciseCard } from './ExerciseCard';

describe('summarizeExerciseCard', () => {
  it('uses planned repetitions and percentage-based intensity when no log exists', () => {
    expect(summarizeExerciseCard([
      { scope: 'both', plannedReps: 5, intensity_type: 'PERCENT', target_value: 80 },
      { scope: 'plan', plannedReps: 5, intensity_type: 'PERCENT', target_value: 70 },
    ])).toEqual({ intensityPct: 75, nl: 10 });
  });

  it('uses logged repetitions and performance intensity when a log exists', () => {
    expect(summarizeExerciseCard([
      { scope: 'both', actual: 100, reps: 5, executedRpe: 8, plannedReps: 5, target_value: 80 },
      { scope: 'both', actual: 90, reps: 5, executedRpe: 8, plannedReps: 5, target_value: 70 },
      { scope: 'plan', plannedReps: 12, target_value: 60 },
    ])).toEqual({ intensityPct: 82, nl: 10 });
  });

  it('falls back to planned intensity for logged sets without usable RPE', () => {
    expect(summarizeExerciseCard([
      { scope: 'both', actual: 100, reps: 5, executedRpe: null, plannedReps: 5, intensity_type: 'PERCENT', target_value: 80 },
    ])).toEqual({ intensityPct: 80, nl: 5 });
  });
});
