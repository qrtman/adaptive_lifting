import { useMemo, useState } from 'react';
import { apiService } from '../services/api';
import { CATALOG_EXERCISES, type CatalogExercise, type MovementPattern } from '../services/exerciseCatalog';
import { compileVariation, defaultModifiers } from '../services/liftVariation';
import { CenteredDialog, NestedCard } from './CenteredDialog';
import { LiftCatalogChoice } from './LiftCatalogChoice';
import { LiftVariationPicker } from './LiftVariationPicker';

type LiftTier = 'Comp' | 'Variation' | 'Accessory';

export function AddLiftBar({ sessionId, onAdded }: { sessionId: string; onAdded: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<'User Defined' | ''>('');
  const [tier, setTier] = useState<LiftTier>('Comp');
  const [movementPattern, setMovementPattern] = useState<MovementPattern>('Misc');
  const [search, setSearch] = useState('');
  const [exerciseName, setExerciseName] = useState('');
  const [customName, setCustomName] = useState('');
  const [variation, setVariation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo<CatalogExercise | null>(() => {
    if (source === 'User Defined') {
      const name = customName.trim();
      return name ? { name, category: 'User Defined', movementPattern, liftCategory: 'Other', tier } : null;
    }
    return exerciseName ? (CATALOG_EXERCISES.find((item) => item.name === exerciseName) ?? null) : null;
  }, [source, customName, movementPattern, tier, exerciseName]);

  const reset = () => {
    setSource('');
    setTier('Comp');
    setMovementPattern('Misc');
    setSearch('');
    setExerciseName('');
    setCustomName('');
    setVariation('');
    setError(null);
  };

  const selectCatalogExercise = (item: CatalogExercise) => {
    setSource('');
    setExerciseName(item.name);
    setMovementPattern(item.movementPattern);
    setTier(item.tier);
    setVariation(item.tier === 'Comp' ? compileVariation(item.name, defaultModifiers(item.liftCategory)) : item.name);
  };

  const addLift = async () => {
    if (busy || !selected) return;
    setBusy(true);
    setError(null);
    try {
      await apiService.addSessionExercise(sessionId, {
        title: selected.name,
        variation: variation || selected.name,
        tier,
        liftCategory: selected.liftCategory,
        movementPattern: selected.movementPattern,
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
    <div className="px-2 py-3 border-t border-[var(--cal-hairline)]">
      <button type="button" data-testid="add-lift" onClick={() => { reset(); setOpen(true); }} className="h-8 px-3 text-xs text-[var(--cal-on-primary)] bg-[var(--cal-primary)] rounded-[var(--cal-radius-md)] hover:bg-[var(--cal-primary-active)]">
        Add lift
      </button>
      {open ? (
        <CenteredDialog
          title="Select Exercise & Modifiers"
          subtitle="Choose an exercise, configure its tier and modifiers, then confirm."
          onClose={() => setOpen(false)}
          testId="add-lift-dialog"
          footer={(
            <>
              <button type="button" data-testid="add-lift-cancel" onClick={() => setOpen(false)} className="h-8 px-3 text-xs text-[var(--cal-ink)] hover:bg-[var(--cal-surface-soft)] rounded-[var(--cal-radius-md)]">Cancel</button>
              <button type="button" data-testid="add-lift-confirm" disabled={busy || !selected} onClick={() => void addLift()} className="h-8 px-3 text-xs text-[var(--cal-on-primary)] bg-[var(--cal-primary)] rounded-[var(--cal-radius-md)] disabled:opacity-40">{busy ? 'Adding…' : 'Confirm'}</button>
            </>
          )}
        >
          <div className="flex flex-col gap-2">
            <NestedCard testId="add-lift-exercise-card">
              <LiftCatalogChoice
                testPrefix="add-lift"
                category={source}
                tier={tier}
                movementPattern={movementPattern}
                search={search}
                exerciseName={exerciseName}
                customName={customName}
                onCategoryChange={(next) => {
                  setSource(next);
                  setSearch('');
                  setExerciseName('');
                  setVariation('');
                  if (next === 'User Defined') setTier('Accessory');
                }}
                onTierChange={setTier}
                onMovementPatternChange={setMovementPattern}
                onSearchChange={setSearch}
                onExerciseChange={selectCatalogExercise}
                onCustomNameChange={(next) => { setCustomName(next); setVariation(next.trim()); }}
              />
            </NestedCard>
            {selected ? (
              <NestedCard testId="add-lift-modifiers-card">
                <LiftVariationPicker
                  title={selected.name}
                  variation={variation || compileVariation(selected.name, defaultModifiers(selected.liftCategory))}
                  liftCategory={selected.liftCategory}
                  onChange={(next) => { setVariation(next.variation); setTier((current) => current === 'Accessory' ? 'Accessory' : next.tier); }}
                />
              </NestedCard>
            ) : <p className="text-xs text-[var(--cal-muted)]">Choose a catalog exercise or select User Defined and enter a name.</p>}
            {error ? <p className="text-xs text-[var(--cal-error)]" data-testid="add-lift-error">{error}</p> : null}
          </div>
        </CenteredDialog>
      ) : null}
    </div>
  );
}
