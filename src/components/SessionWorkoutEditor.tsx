import { ExerciseCard } from './ExerciseCard';
import { AccessoryLedger } from './AccessoryLedger';
import {
  WorkoutData,
  isWorkoutCompleted,
  splitWorkoutExercises,
} from '../types';
import { usePeriodization } from '../contexts/PeriodizationContext';

export function SessionWorkoutEditor({
  workout,
  microcycleId,
  roleMode = 'coach',
}: {
  workout: WorkoutData;
  microcycleId: string;
  roleMode?: 'coach' | 'athlete';
}) {
  const {
    updateExerciseSets,
    finishSession,
    activeWorkoutId,
    setActiveWorkoutId,
  } = usePeriodization();
  const { main, accessories } = splitWorkoutExercises(workout.exercises);
  const completed = isWorkoutCompleted(workout.status);
  const isActive = activeWorkoutId === workout.id;

  return (
    <section
      id={`session-${workout.id}`}
      data-testid={`sessions-card-${workout.id}`}
      className="border-b border-white/10"
      onFocusCapture={() => {
        if (!isActive) setActiveWorkoutId(workout.id);
      }}
    >
      <div className="px-2 h-8 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm text-white truncate">
            {workout.dayLabel} · {workout.title}
          </h3>
          <span className="text-[10px] text-[#AEAEB2] shrink-0">{workout.status}</span>
          <p
            data-testid={isActive ? 'workout-tonnage' : `workout-tonnage-${workout.id}`}
            className="text-[11px] font-mono text-[#AEAEB2] shrink-0"
          >
            {workout.tonnage}kg
          </p>
        </div>
        {roleMode === 'coach' && (
          <button
            type="button"
            onClick={() =>
              finishSession(completed ? 'IN_PROGRESS' : 'COMPLETED', {
                workoutId: workout.id,
                microcycleId,
              })
            }
            className={`h-7 px-2 text-[11px] rounded shrink-0 ${
              completed
                ? 'text-[#AEAEB2] hover:text-white'
                : 'bg-[#34C759] text-black'
            }`}
          >
            {completed ? 'Reopen' : 'Complete'}
          </button>
        )}
      </div>

      {main.length === 0 && accessories.length === 0 ? (
        <p className="px-2 py-3 text-xs text-[#636366]">No exercises programmed.</p>
      ) : (
        <>
          {main.map((ex) => (
            <ExerciseCard
              key={ex.id}
              id={ex.id}
              title={ex.title}
              variation={ex.variation}
              tags={ex.tags}
              tier={ex.tier}
              initialSets={ex.sets}
              onUpdateSets={(updatedSets) =>
                updateExerciseSets(ex.id, updatedSets, {
                  workoutId: workout.id,
                  microcycleId,
                })
              }
              roleMode={roleMode}
            />
          ))}
          <AccessoryLedger
            exercises={accessories}
            onUpdateSets={(exerciseId, updatedSets) =>
              updateExerciseSets(exerciseId, updatedSets, {
                workoutId: workout.id,
                microcycleId,
              })
            }
            roleMode={roleMode}
          />
        </>
      )}
    </section>
  );
}
