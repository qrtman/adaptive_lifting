import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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
  onAdded,
}: {
  sessionId: string;
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
  const [highlightIndex, setHighlightIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const customRef = useRef<HTMLInputElement>(null);

  const userDefined = category === 'User Defined';
  const options = useMemo(() => filterCatalog(category, search), [category, search]);
  const selected: CatalogExercise | null = useMemo(() => {
    if (userDefined) {
      const name = customName.trim() || 'Accessory';
      return { name, category: 'User Defined', movementPattern: 'Misc', liftCategory: 'Other', tier: 'Accessory' };
    }
    if (!exerciseName || !options.some((item) => item.name === exerciseName)) return null;
    return CATALOG_EXERCISES.find((item) => item.name === exerciseName) ?? null;
  }, [userDefined, customName, exerciseName, options]);

  useEffect(() => {
    if (userDefined) return;
    if (exerciseName && !options.some((item) => item.name === exerciseName)) {
      setExerciseName('');
      setVariation('');
    }
  }, [userDefined, exerciseName, options]);

  useEffect(() => {
    setHighlightIndex((current) => {
      if (options.length === 0) return 0;
      const selectedIndex = options.findIndex((item) => item.name === exerciseName);
      if (selectedIndex >= 0) return selectedIndex;
      return Math.min(current, options.length - 1);
    });
  }, [options, exerciseName]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      if (userDefined) customRef.current?.focus();
      else searchRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, userDefined]);

  const reset = () => {
    setCategory('');
    setSearch('');
    setExerciseName('');
    setCustomName('');
    setVariation('');
    setTier('Comp');
    setError(null);
    setHighlightIndex(0);
  };

  const pickExercise = (name: string) => {
    setExerciseName(name);
    const item = CATALOG_EXERCISES.find((row) => row.name === name);
    if (!item) return;
    if (!category) setCategory(item.category);
    setVariation(compileVariation(item.name, defaultModifiers(item.liftCategory)));
    setTier(item.tier);
    const nextIndex = options.findIndex((row) => row.name === name);
    if (nextIndex >= 0) setHighlightIndex(nextIndex);
  };

  const pickHighlighted = () => {
    const item = options[highlightIndex] ?? options[0];
    if (item) pickExercise(item.name);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLDivElement>) => {
    if (userDefined) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (options.length === 0) return;
      setHighlightIndex((current) => Math.min(options.length - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (options.length === 0) return;
      setHighlightIndex((current) => Math.max(0, current - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pickHighlighted();
    }
  };

  const addLift = async () => {
    if (busy || !selected) return;
    setBusy(true);
    setError(null);
    try {
      await apiService.addSessionExercise(sessionId, {
        title: selected.name,
        variation: variation || selected.name,
        tier: selected.tier === 'Accessory' ? 'Accessory' : tier,
        liftCategory: selected.liftCategory,
        movementPattern: selected.category === 'User Defined' ? 'Misc' : selected.movementPattern,
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
                    setHighlightIndex(0);
                  }}
                  className="h-8 px-2 rounded bg-[#0A0A0A] border border-white/10 text-xs text-white"
                >
                  <option value="">—</option>
                  {EXERCISE_CATEGORIES.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-[#636366]">Search Exercises</span>
                <div className="relative">
                  <input
                    ref={searchRef}
                    data-testid="add-lift-search"
                    value={search}
                    disabled={userDefined}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setHighlightIndex(0);
                    }}
                    onKeyDown={onSearchKeyDown}
                    placeholder="Search"
                    autoFocus
                    aria-controls="add-lift-results"
                    aria-autocomplete="list"
                    className="w-full h-8 px-2 pr-7 rounded bg-[#0A0A0A] border border-white/10 text-xs text-white disabled:opacity-40"
                  />
                  {search && !userDefined ? (
                    <button
                      type="button"
                      aria-label="Clear search"
                      onClick={() => {
                        setSearch('');
                        setHighlightIndex(0);
                        searchRef.current?.focus();
                      }}
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 text-[#AEAEB2] hover:text-white"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
                {userDefined ? (
                  <p className="text-[11px] text-[#AEAEB2]">Catalog search does not apply. Name this lift.</p>
                ) : null}
              </div>
            </div>
            {userDefined ? (
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-[#636366]">Exercise</span>
                <input
                  ref={customRef}
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
            ) : options.length === 0 ? (
              <p className="text-xs text-[#AEAEB2]" data-testid="add-lift-no-results">
                No catalog matches. Clear search, change category, or pick User Defined to name a custom lift.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-[#636366]">Exercise</span>
                <div
                  id="add-lift-results"
                  role="listbox"
                  tabIndex={0}
                  aria-label="Catalog exercises"
                  data-testid="add-lift-results"
                  onKeyDown={onSearchKeyDown}
                  className="max-h-48 overflow-y-auto border border-white/10 rounded bg-[#0A0A0A] outline-none"
                >
                  {options.map((item, index) => {
                    const active = index === highlightIndex;
                    const isSelected = item.name === exerciseName;
                    return (
                      <button
                        key={`${item.category}-${item.name}`}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        aria-label={item.name}
                        data-testid={`add-lift-result-${item.name}`}
                        onMouseEnter={() => setHighlightIndex(index)}
                        onClick={() => pickExercise(item.name)}
                        className={`w-full px-2 py-1.5 text-left ${
                          active ? 'bg-white/10 text-white' : 'text-[#AEAEB2] hover:text-white'
                        }`}
                      >
                        <span className="block text-xs">{item.name}</span>
                        <span className="block text-[10px] text-[#636366]" aria-hidden="true">
                          {item.movementPattern}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
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
