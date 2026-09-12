import { useMemo, useState } from 'react';
import { apiService } from '../services/api';
import {
  CATALOG_EXERCISES,
  EXERCISE_CATEGORIES,
  filterCatalog,
  type CatalogExercise,
  type ExerciseCategory,
} from '../services/exerciseCatalog';
import { compileVariation, defaultModifiers } from '../services/liftVariation';
import { CenteredDialog } from './CenteredDialog';
import { LiftVariationPicker } from './LiftVariationPicker';

export function AddLiftBar({
  sessionId,
  locked,
  onAdded,
}: {
  sessionId: string;
  locked: boolean;
  onAdded: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ExerciseCategory | ''>('');
  const [search, setSearch] = useState('');
  const [exerciseName, setExerciseName] = useState('');
  const [customName, setCustomName] = useState('');
  const [variation, setVariation] = useState('');
  const [tier, setTier] = useState<'Comp' | 'Variation' | 'Accessory'>('Comp');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(() => filterCatalog(category, search), [category, search]);
  const selected: CatalogExercise | null = useMemo(() => {
    if (category === 'User Defined') {
      const name = customName.trim() || 'Accessory';
      return { name, category: 'User Defined', liftCategory: 'Other', tier: 'Accessory' };
    }
    return CATALOG_EXERCISES.find((item) => item.name === exerciseName) ?? null;
  }, [category, customName, exerciseName]);

  const reset = () => {
    setCategory('');
    setSearch('');
    setExerciseName('');
    setCustomName('');
    setVariation('');
    setTier('Comp');
    setError(null);
  };

  const pickExercise = (name: string) => {
    setExerciseName(name);
    const item = CATALOG_EXERCISES.find((row) => row.name === name);
    if (!item) return;
    if (!category) setCategory(item.category);
    setVariation(compileVariation(item.name, defaultModifiers(item.liftCategory)));
    setTier(item.tier);
  };

  const addLift = async () => {
    if (locked || busy || !selected) return;
    setBusy(true);
    setError(null);
    try {
      await apiService.addSessionExercise(sessionId, {
        title: selected.name,
        variation: variation || selected.name,
        tier: selected.tier === 'Accessory' ? 'Accessory' : tier,
        liftCategory: selected.liftCategory,
      });
      await onAdded();
      setOpen(false);
      reset();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add lift');
    } finally {
      setBusy(false);
    }
  };

  if (locked) return null;

  return (
    <div className="px-2 py-3 border-t border-white/10">
      <button
          type="button"
          data-testid="add-lift"
          onClick={() => {
            reset();
            setOpen(true);
          }}
          className="h-8 px-3 text-xs text-white bg-white/10 rounded"
        >
          Add lift
        </button>
      {open && (
        <CenteredDialog
          title="Select Exercise & Modifiers"
          subtitle="Choose an exercise, configure its modifiers, then confirm."
          onClose={() => setOpen(false)}
          testId="add-lift-dialog"
          footer={(
            <>
              <button
                type="button"
                data-testid="add-lift-cancel"
                onClick={() => setOpen(false)}
                className="h-8 px-3 text-xs text-[#AEAEB2] hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="add-lift-confirm"
                disabled={busy || !selected}
                onClick={() => void addLift()}
                className="h-8 px-3 text-xs text-white bg-[#007AFF] rounded disabled:opacity-40"
              >
                {busy ? 'Adding…' : 'Confirm'}
              </button>
            </>
          )}
        >
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-[#636366]">Category</span>
                <select
                  data-testid="add-lift-category"
                  value={category}
                  onChange={(event) => {
                    const next = event.target.value as ExerciseCategory | '';
                    setCategory(next);
                    setExerciseName('');
                    setVariation('');
                  }}
                  className="h-8 px-2 rounded bg-[#0A0A0A] border border-white/10 text-xs text-white"
                >
                  <option value="">—</option>
                  {EXERCISE_CATEGORIES.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-[#636366]">Search Exercises</span>
                <input
                  data-testid="add-lift-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search"
                  className="h-8 px-2 rounded bg-[#0A0A0A] border border-white/10 text-xs text-white"
                />
              </label>
            </div>
            {category === 'User Defined' ? (
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-[#636366]">Exercise</span>
                <input
                  data-testid="add-lift-custom-name"
                  value={customName}
                  onChange={(event) => {
                    setCustomName(event.target.value);
                    setVariation(compileVariation(event.target.value.trim() || 'Accessory', defaultModifiers('Other')));
                    setTier('Accessory');
                  }}
                  placeholder="Name this lift"
                  className="h-8 px-2 rounded bg-[#0A0A0A] border border-white/10 text-xs text-white"
                />
              </label>
            ) : (
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-[#636366]">Exercise</span>
                <select
                  data-testid="add-lift-exercise"
                  value={exerciseName}
                  onChange={(event) => pickExercise(event.target.value)}
                  className="h-8 px-2 rounded bg-[#0A0A0A] border border-white/10 text-xs text-white"
                >
                  <option value="">Select exercise</option>
                  {options.map((item) => (
                    <option key={`${item.category}-${item.name}`} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {selected ? (
              <LiftVariationPicker
                title={selected.name}
                variation={variation || compileVariation(selected.name, defaultModifiers(selected.liftCategory))}
                liftCategory={selected.liftCategory}
                onChange={(patch) => {
                  setVariation(patch.variation);
                  if (selected.tier !== 'Accessory') setTier(patch.tier);
                }}
              />
            ) : (
              <p className="text-xs text-[#AEAEB2]">Select an exercise to configure modifiers.</p>
            )}
            {error && (
              <p className="text-xs text-[#FF453A]" data-testid="add-lift-error">{error}</p>
            )}
          </div>
        </CenteredDialog>
      )}
    </div>
  );
}
