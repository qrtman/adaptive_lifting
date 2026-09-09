import { useEffect, useMemo, useState } from 'react';
import { CatalogCategory, CatalogEntry, CatalogTier, EXERCISE_CATALOG, catalogMatches } from '../data/exerciseCatalog';
import { ExerciseData, SetData } from '../types';

const TIERS: Array<CatalogTier | 'All'> = ['All', 'Comp', 'Variation', 'Accessory'];
const CATEGORIES: CatalogCategory[] = ['Squat', 'Bench', 'Deadlift', 'Other'];

function newEntityId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function blankSet(exerciseId: string): SetData {
  return {
    id: `${exerciseId}-s1`,
    label: 'Set 1',
    plannedWeight: null,
    plannedReps: null,
    plannedRpe: null,
    actual: null,
    reps: null,
    executedRpe: null,
  };
}

export function AddExerciseDialog({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (exercise: ExerciseData) => void;
}) {
  const [query, setQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<CatalogTier | 'All'>('All');
  const [selectedId, setSelectedId] = useState<string | 'custom' | null>(null);
  const [title, setTitle] = useState('');
  const [variation, setVariation] = useState('');
  const [tier, setTier] = useState<CatalogTier>('Variation');
  const [liftCategory, setLiftCategory] = useState<CatalogCategory>('Squat');
  const [error, setError] = useState<string | null>(null);

  const matches = useMemo(() => {
    return EXERCISE_CATALOG.filter((entry) => {
      if (tierFilter !== 'All' && entry.tier !== tierFilter) return false;
      return catalogMatches(entry, query);
    });
  }, [query, tierFilter]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setTierFilter('All');
    setSelectedId(null);
    setTitle('');
    setVariation('');
    setTier('Variation');
    setLiftCategory('Squat');
    setError(null);
  }, [open]);

  const applyEntry = (entry: CatalogEntry) => {
    setSelectedId(entry.id);
    setTitle(entry.title);
    setVariation(entry.variation);
    setTier(entry.tier);
    setLiftCategory(entry.liftCategory);
    setError(null);
  };

  const startCustom = () => {
    const name = query.trim() || 'Custom Lift';
    setSelectedId('custom');
    setTitle(name);
    setVariation(name);
    setTier('Variation');
    setLiftCategory('Other');
    setError(null);
  };

  const add = () => {
    const heading = (tier === 'Accessory' ? title : variation || title).trim();
    if (!heading) {
      setError('Name the lift before adding.');
      return;
    }
    const id = newEntityId('ex');
    const exercise: ExerciseData = {
      id,
      title: title.trim() || heading,
      variation: variation.trim() || (tier === 'Accessory' ? 'Accessory' : heading),
      tier,
      liftCategory,
      tags: [tier, liftCategory],
      top: '—',
      vol: '—',
      sets: [blankSet(id)],
    };
    onAdd(exercise);
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        add();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2">
      <div
        role="dialog"
        aria-labelledby="add-exercise-title"
        data-testid="add-exercise-dialog"
        className="w-[90vw] max-w-[1200px] h-[85dvh] max-md:w-full max-md:h-full bg-[#131313] border border-white/10 flex flex-col"
      >
        <div className="h-10 px-3 flex items-center justify-between border-b border-white/10 shrink-0">
          <h2 id="add-exercise-title" className="text-sm text-white">
            Add Exercise
          </h2>
          <button type="button" onClick={onClose} className="h-7 px-2 text-[11px] text-[#AEAEB2] hover:text-white">
            Esc
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2">
          <div className="min-h-0 flex flex-col border-b md:border-b-0 md:border-r border-white/10">
            <div className="p-2 flex flex-col gap-2 shrink-0">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search catalog"
                data-testid="add-exercise-search"
                className="h-10 px-2 bg-[#161616] border border-white/10 text-sm text-white placeholder:text-[#636366]"
              />
              <div className="flex gap-1 flex-wrap">
                {TIERS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTierFilter(t)}
                    className={`h-7 px-2 text-[11px] ${tierFilter === t ? 'text-white' : 'text-[#AEAEB2] hover:text-white'}`}
                  >
                    {t === 'Variation' ? 'Variations' : t === 'All' ? 'All' : t === 'Comp' ? 'Comp Lifts' : 'Accessories'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {matches.length === 0 ? (
                <p className="px-3 py-4 text-xs text-[#636366]">No catalog match.</p>
              ) : (
                matches.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => applyEntry(entry)}
                    data-testid={`catalog-${entry.id}`}
                    className={`w-full text-left px-3 py-2 border-b border-white/5 ${
                      selectedId === entry.id ? 'bg-white/5' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <span className="text-sm text-white">{entry.variation === 'Accessory' ? entry.title : entry.variation}</span>
                    <span className="ml-2 text-[10px] text-[#636366]">
                      {entry.liftCategory} · {entry.tier}
                    </span>
                  </button>
                ))
              )}
              <button
                type="button"
                onClick={startCustom}
                data-testid="create-custom-exercise"
                className="w-full text-left px-3 py-2 text-xs text-[#AEAEB2] hover:text-white"
              >
                + Create Custom{query.trim() ? ` “${query.trim()}”` : ''}
              </button>
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-[#636366]">
              Base name
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-8 px-2 bg-[#161616] border border-white/10 text-sm text-white normal-case tracking-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-[#636366]">
              Variation
              <input
                value={variation}
                onChange={(e) => setVariation(e.target.value)}
                className="h-8 px-2 bg-[#161616] border border-white/10 text-sm text-white normal-case tracking-normal"
              />
            </label>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#636366] mb-1">Category</p>
              <div className="flex gap-1 flex-wrap">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setLiftCategory(c)}
                    className={`h-7 px-2 text-[11px] ${liftCategory === c ? 'text-white' : 'text-[#AEAEB2] hover:text-white'}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#636366] mb-1">Tier</p>
              <div className="flex gap-1">
                {(['Comp', 'Variation', 'Accessory'] as CatalogTier[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTier(t)}
                    className={`h-7 px-2 text-[11px] ${tier === t ? 'text-white' : 'text-[#AEAEB2] hover:text-white'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            {error ? (
              <p role="alert" className="text-xs text-[#FF453A]">
                {error}
              </p>
            ) : (
              <p className="text-xs text-[#636366]">Sets, kg, reps, and RPE are edited on the exercise card after adding.</p>
            )}
          </div>
        </div>

        <div className="shrink-0 p-3 flex justify-end gap-2 border-t border-white/10">
          <button type="button" onClick={onClose} className="h-8 px-3 text-[11px] text-[#AEAEB2] hover:text-white">
            Cancel
          </button>
          <button
            type="button"
            data-testid="add-exercise-confirm"
            onClick={add}
            className="h-8 px-3 text-[11px] bg-[#007AFF] text-white"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
