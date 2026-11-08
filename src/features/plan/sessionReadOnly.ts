export type SessionReadOnlyReason = 'locked' | null;

/**
 * Finished sessions stay editable (owner decision, 2026-11-08). Only a session
 * the server reports as locked by another writer is read-only until the lock clears.
 */
export function sessionReadOnlyReason(
  workout: { id: string; status: string } | null | undefined,
  lockedWorkoutIds: readonly string[],
): SessionReadOnlyReason {
  if (!workout) return null;
  if (lockedWorkoutIds.includes(workout.id)) return 'locked';
  return null;
}
