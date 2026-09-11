import { ExerciseCard } from './ExerciseCard';
import { ExerciseData } from '../types';

export const AccessoryLedger = ({
  exercises,
  onUpdateSets,
  onUpdateMeta,
  onRemove,
  locked = false,
  roleMode = 'athlete'
}: {
  exercises: ExerciseData[],
  onUpdateSets: (exerciseId: string, sets: ExerciseData['sets']) => void,
  onUpdateMeta?: (exerciseId: string, patch: { variation: string; tier: 'Comp' | 'Variation' }) => void | Promise<void>,
  onRemove?: (exerciseId: string) => void | Promise<void>,
  locked?: boolean,
  roleMode?: 'coach' | 'athlete'
}) => {
  if (exercises.length === 0) return null;

  const pendingCount = exercises.filter((exercise) =>
    exercise.sets.some((set) => set.actual == null || Number(set.actual) <= 0)
  ).length;

  return (
    <div>
      <p className="px-1 h-5 flex items-center text-[10px] text-[#AEAEB2]">
        Acc · {pendingCount} open
      </p>
      {exercises.map((exercise) => (
        <ExerciseCard
          key={exercise.id}
          id={exercise.id}
          title={exercise.title}
          variation={exercise.variation}
          tags={exercise.tags}
          tier={exercise.tier}
          liftCategory={exercise.liftCategory}
          initialSets={exercise.sets}
          onUpdateSets={(updatedSets) => onUpdateSets(exercise.id, updatedSets)}
          onUpdateMeta={onUpdateMeta ? (patch) => onUpdateMeta(exercise.id, patch) : undefined}
          onRemove={onRemove ? () => onRemove(exercise.id) : undefined}
          locked={locked}
          roleMode={roleMode}
        />
      ))}
    </div>
  );
};
