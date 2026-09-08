import { useState } from 'react';
import { Plus } from 'lucide-react';
import { ExerciseCard } from './ExerciseCard';
import { AccessoryLedger } from './AccessoryLedger';
import { AddExerciseDialog } from './AddExerciseDialog';
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
    addExercise,
    finishSession,
    activeWorkoutId,
    setActiveWorkoutId,
  } = usePeriodization();
  const { main, accessories } = splitWorkoutExercises(workout.exercises);
  const completed = isWorkoutCompleted(workout.status);
  const isActive = activeWorkoutId === workout.id;
  const [addingExercise, setAddingExercise] = useState(false);

  const completeControl = roleMode === 'coach' ? (
    <button
      type="button"
      data-testid={`session-complete-${workout.id}`}
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
  ) : null;

  return (
    <section
      id={`session-${workout.id}`}
      data-testid={`sessions-card-${workout.id}`}
      className="border-b-2 border-white/20 pb-2"
      onFocusCapture={() => {
        if (!isActive) setActiveWorkoutId(workout.id);
      }}
    >
      <div className="px-2 min-h-8 py-1 flex items-center justify-between gap-2 border-b border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm text-white truncate">
            {workout.title ? `${workout.dayLabel} · ${workout.title}` : workout.dayLabel}
          </h3>
          <span
            data-testid={`session-date-${workout.id}`}
            className="font-mono text-[11px] text-[#AEAEB2] shrink-0"
          >
            {workout.date}
          </span>
          <span className="text-[10px] text-[#AEAEB2] shrink-0">{workout.status}</span>
          <p
            data-testid={isActive ? 'workout-tonnage' : `workout-tonnage-${workout.id}`}
            className="text-[11px] font-mono text-[#AEAEB2] shrink-0"
          >
            {workout.tonnage}kg
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {roleMode === 'coach' && (
            completed ? (
              <span className="text-[10px] text-[#636366]">Reopen to add exercises</span>
            ) : (
              <button
                type="button"
                data-testid={`add-exercise-${workout.id}`}
                onClick={() => setAddingExercise(true)}
                className="h-7 px-2 text-[11px] text-[#AEAEB2] hover:text-white flex items-center gap-1"
              >
                <Plus size={12} />
                Exercise
              </button>
            )
          )}
        </div>
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

      <div
        data-testid={`session-end-${workout.id}`}
        className="px-2 min-h-8 mt-1 flex items-center justify-between gap-2"
      >
        <span className="text-[10px] uppercase tracking-wider text-[#636366]">
          End of {workout.dayLabel}
        </span>
        {completeControl}
      </div>

      <AddExerciseDialog
        open={addingExercise}
        onClose={() => setAddingExercise(false)}
        onAdd={(exercise) => addExercise(workout.id, microcycleId, exercise)}
      />
    </section>
  );
}
