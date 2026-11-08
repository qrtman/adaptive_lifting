/** Where the conflicting edit lives, resolved from the local plan snapshot. */
export interface ConflictTarget { sessionDate?: string; sessionTitle?: string; liftName?: string; setNumber?: number }

export function findConflictTarget(
  data: unknown,
  mutation: { entity_type: string; entity_id: string; workout_id?: string },
): ConflictTarget | null {
  if (!Array.isArray(data)) return null;
  for (const mc of data as any[]) {
    for (const workout of (Array.isArray(mc?.workouts) ? mc.workouts : [])) {
      const session = { sessionDate: workout?.date || undefined, sessionTitle: workout?.title || undefined };
      if (mutation.entity_type === 'Workout' && workout?.id === mutation.entity_id) return session;
      for (const exercise of (Array.isArray(workout?.exercises) ? workout.exercises : [])) {
        const lift = { ...session, liftName: exercise?.name || undefined };
        if (mutation.entity_type === 'Exercise' && exercise?.id === mutation.entity_id) return lift;
        if (mutation.entity_type === 'ExerciseSet' && Array.isArray(exercise?.sets)) {
          const index = exercise.sets.findIndex((set: any) => set?.id === mutation.entity_id);
          if (index >= 0) return { ...lift, setNumber: index + 1 };
        }
      }
    }
  }
  return null;
}

