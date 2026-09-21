import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { CATALOG_EXERCISES, filterCatalog, type CatalogExercise, type MovementPattern } from '../services/exerciseCatalog';
import { MovementPatternSelect } from './PrescriptionEditor';

const FIELD = 'h-8 px-2 rounded-[var(--cal-radius-md)] bg-[var(--cal-canvas)] border border-[var(--cal-hairline)] text-xs text-[var(--cal-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]';
const LABEL = 'text-[10px] uppercase tracking-wider text-[var(--cal-muted)]';
type LiftTier = 'Comp' | 'Variation' | 'Accessory';

export function LiftCatalogChoice({
  testPrefix, category, tier, movementPattern, search, exerciseName, customName,
  onCategoryChange, onTierChange, onMovementPatternChange, onSearchChange, onExerciseChange, onCustomNameChange,
}: {
  testPrefix: string;
  category: 'User Defined' | '';
  tier: LiftTier;
  movementPattern: MovementPattern;
  search: string;
  exerciseName: string;
  customName: string;
  onCategoryChange: (value: 'User Defined' | '') => void;
  onTierChange: (value: LiftTier) => void;
  onMovementPatternChange: (value: MovementPattern) => void;
  onSearchChange: (value: string) => void;
  onExerciseChange: (item: CatalogExercise) => void;
  onCustomNameChange: (value: string) => void;
}) {
  const userDefined = category === 'User Defined';
  const options = useMemo(() => filterCatalog('', search), [search]);
  const [highlightIndex, setHighlightIndex] = useState(0);

  useEffect(() => {
    const selectedIndex = options.findIndex((item) => item.name === exerciseName);
    setHighlightIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [options, exerciseName]);

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLDivElement>) => {
    if (userDefined) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightIndex((current) => Math.min(options.length - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightIndex((current) => Math.max(0, current - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = options[highlightIndex] ?? options[0];
      if (item) onExerciseChange(item);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Exercise source</span>
          <select data-testid={`${testPrefix}-category`} value={userDefined ? 'User Defined' : ''} onChange={(event) => onCategoryChange(event.target.value as 'User Defined' | '')} className={FIELD}>
            <option value="">Catalog exercise</option>
            <option value="User Defined">User Defined</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Tier</span>
          <select data-testid={`${testPrefix}-tier`} value={tier} onChange={(event) => onTierChange(event.target.value as LiftTier)} className={FIELD}>
            <option value="Comp">Main Lift</option>
            <option value="Variation">Variation</option>
            <option value="Accessory">Accessory</option>
          </select>
        </label>
      </div>
      {!userDefined ? (
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Search Exercises</span>
          <input data-testid={`${testPrefix}-search`} value={search} onChange={(event) => onSearchChange(event.target.value)} onKeyDown={onSearchKeyDown} placeholder="Search by exercise name" className={FIELD} />
        </label>
      ) : (
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Exercise name</span>
          <input data-testid={`${testPrefix}-custom-name`} value={customName} onChange={(event) => onCustomNameChange(event.target.value)} placeholder="e.g. Hamstring Curl" className={FIELD} />
        </label>
      )}
      {!userDefined ? (
        <div id={`${testPrefix}-results`} role="listbox" tabIndex={0} aria-label="Catalog exercises" data-testid={`${testPrefix}-results`} onKeyDown={onSearchKeyDown} className="max-h-48 overflow-y-auto cal-nested-card cal-nested-flush outline-none" data-elevated="true">
          {options.map((item, index) => (
            <button key={`${item.category}-${item.name}`} type="button" role="option" aria-selected={item.name === exerciseName} data-testid={`${testPrefix}-result-${item.name}`} onMouseEnter={() => setHighlightIndex(index)} onClick={() => onExerciseChange(item)} className={`w-full px-2 py-1.5 text-left ${index === highlightIndex ? 'bg-[var(--cal-surface-soft)] text-[var(--cal-ink)]' : 'text-[var(--cal-muted)] hover:text-[var(--cal-ink)]'}`}>
              <span className="block text-xs">{item.name}</span>
              <span className="block text-[10px] text-[var(--cal-muted-soft)]" aria-hidden="true">{item.movementPattern}</span>
            </button>
          ))}
        </div>
      ) : null}
      <MovementPatternSelect id={testPrefix} value={movementPattern} onChange={onMovementPatternChange} />
    </div>
  );
}

export function catalogExercise(name: string): CatalogExercise | null {
  return CATALOG_EXERCISES.find((item) => item.name === name) ?? null;
}
