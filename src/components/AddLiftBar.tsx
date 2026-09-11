import { useState } from 'react';
import { apiService } from '../services/api';
import { compileVariation, defaultModifiers, type LiftCategory } from '../services/liftVariation';
import { CenteredDialog } from './CenteredDialog';
import { LiftVariationPicker } from './LiftVariationPicker';

type LiftPreset = 'Squat' | 'Bench' | 'Deadlift' | 'Accessory';

const PRESETS: Record<Exclude<LiftPreset, 'Accessory'>, {
  title: string;
  liftCategory: 'Squat' | 'Bench' | 'Deadlift';
}> = {
  Squat: { title: 'Squat', liftCategory: 'Squat' },
  Bench: { title: 'Bench', liftCategory: 'Bench' },
  Deadlift: { title: 'Deadlift', liftCategory: 'Deadlift' },
};

function categoryFor(preset: LiftPreset): LiftCategory {
  return preset === 'Accessory' ? 'Other' : preset;
}

function titleFor(preset: LiftPreset, accessoryName: string): string {
  if (preset === 'Accessory') return accessoryName.trim() || 'Accessory';
  return PRESETS[preset].title;
}

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
  const [preset, setPreset] = useState<LiftPreset>('Squat');
  const [accessoryName, setAccessoryName] = useState('');
  const [variation, setVariation] = useState(() => compileVariation('Squat', defaultModifiers('Squat')));
  const [tier, setTier] = useState<'Comp' | 'Variation'>('Comp');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyPreset = (next: LiftPreset) => {
    setPreset(next);
    const title = titleFor(next, accessoryName);
    const mods = defaultModifiers(categoryFor(next));
    setVariation(compileVariation(title, mods));
    setTier(next === 'Accessory' ? 'Variation' : 'Comp');
  };

  const addLift = async () => {
    if (locked || busy) return;
    setBusy(true);
    setError(null);
    const title = titleFor(preset, accessoryName);
    try {
      if (preset === 'Accessory') {
        await apiService.addSessionExercise(sessionId, {
          title,
          variation: variation || 'Accessory',
          tier: 'Accessory',
          liftCategory: 'Other',
        });
      } else {
        await apiService.addSessionExercise(sessionId, {
          title,
          variation,
          tier,
          liftCategory: PRESETS[preset].liftCategory,
        });
      }
      await onAdded();
      setOpen(false);
      setAccessoryName('');
      applyPreset('Squat');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add lift');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-2 py-3 border-t border-white/10">
      {locked ? (
        <p className="text-xs text-[#AEAEB2]">Finished. Tap Open to edit.</p>
      ) : (
        <button
          type="button"
          data-testid="add-lift"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          className="h-8 px-3 text-xs text-white bg-white/10 rounded"
        >
          Add lift
        </button>
      )}
      {open && (
        <CenteredDialog
          title="Add lift"
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
                disabled={busy}
                onClick={() => void addLift()}
                className="h-8 px-3 text-xs text-white bg-[#007AFF] rounded disabled:opacity-40"
              >
                {busy ? 'Adding…' : 'Add'}
              </button>
            </>
          )}
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {(['Squat', 'Bench', 'Deadlift', 'Accessory'] as LiftPreset[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  data-testid={`add-lift-${item.toLowerCase()}`}
                  onClick={() => applyPreset(item)}
                  className={`h-8 px-3 text-xs rounded ${preset === item ? 'bg-white/15 text-white' : 'text-[#AEAEB2]'}`}
                >
                  {item}
                </button>
              ))}
            </div>
            {preset === 'Accessory' && (
              <input
                type="text"
                value={accessoryName}
                onChange={(event) => {
                  setAccessoryName(event.target.value);
                  setVariation(compileVariation(event.target.value.trim() || 'Accessory', defaultModifiers('Other')));
                }}
                placeholder="Accessory name"
                data-testid="add-lift-accessory-name"
                className="h-8 min-w-[140px] px-2 text-xs bg-black border border-white/10 rounded text-white"
              />
            )}
            <LiftVariationPicker
              title={titleFor(preset, accessoryName)}
              variation={variation}
              liftCategory={categoryFor(preset)}
              onChange={(patch) => {
                setVariation(patch.variation);
                setTier(patch.tier);
              }}
            />
            {error && (
              <p className="text-xs text-[#FF453A]" data-testid="add-lift-error">{error}</p>
            )}
          </div>
        </CenteredDialog>
      )}
    </div>
  );
}
