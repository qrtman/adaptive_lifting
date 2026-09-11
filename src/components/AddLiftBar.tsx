import { useState } from 'react';
import { apiService } from '../services/api';

type LiftPreset = 'Squat' | 'Bench' | 'Deadlift' | 'Accessory';

const PRESETS: Record<Exclude<LiftPreset, 'Accessory'>, {
  title: string;
  variation: string;
  tier: 'Comp';
  liftCategory: 'Squat' | 'Bench' | 'Deadlift';
}> = {
  Squat: { title: 'Squat', variation: 'Competition', tier: 'Comp', liftCategory: 'Squat' },
  Bench: { title: 'Bench', variation: 'Competition', tier: 'Comp', liftCategory: 'Bench' },
  Deadlift: { title: 'Deadlift', variation: 'Competition', tier: 'Comp', liftCategory: 'Deadlift' },
};

export function AddLiftBar({
  sessionId,
  locked,
  onAdded,
}: {
  sessionId: string;
  locked: boolean;
  onAdded: () => Promise<void> | void;
}) {
  const [customTitle, setCustomTitle] = useState('');
  const [busy, setBusy] = useState<LiftPreset | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addLift = async (preset: LiftPreset) => {
    if (locked || busy) return;
    setBusy(preset);
    setError(null);
    try {
      const payload = preset === 'Accessory'
        ? {
            title: customTitle.trim() || 'Accessory',
            variation: 'Accessory',
            tier: 'Accessory' as const,
            liftCategory: 'Other' as const,
            plannedReps: 10,
            plannedRpe: 8,
          }
        : {
            ...PRESETS[preset],
            plannedReps: 5,
            plannedRpe: 8,
          };
      await apiService.addSessionExercise(sessionId, payload);
      await onAdded();
      if (preset === 'Accessory') setCustomTitle('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add lift';
      setError(message);
    } finally {
      setBusy(null);
    }
  };

  const btn = (preset: LiftPreset) => (
    <button
      type="button"
      data-testid={`add-lift-${preset.toLowerCase()}`}
      disabled={locked || busy !== null}
      onClick={() => void addLift(preset)}
      className="h-8 min-w-[44px] px-3 text-xs text-white bg-white/10 rounded disabled:opacity-40"
    >
      {busy === preset ? 'Adding…' : preset}
    </button>
  );

  return (
    <div className="px-2 py-3 border-t border-white/10">
      {locked ? (
        <p className="text-xs text-[#AEAEB2]">Session is locked. Re-open it to add lifts.</p>
      ) : (
        <>
          <p className="text-[10px] uppercase tracking-wider text-[#636366] mb-2">Add lift</p>
          <div className="flex flex-wrap items-center gap-2">
            {btn('Squat')}
            {btn('Bench')}
            {btn('Deadlift')}
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder="Accessory name"
              disabled={busy !== null}
              data-testid="add-lift-accessory-name"
              className="h-8 min-w-[140px] px-2 text-xs bg-black border border-white/10 rounded text-white"
            />
            {btn('Accessory')}
          </div>
        </>
      )}
      {error && (
        <p className="mt-2 text-xs text-[#FF453A]" data-testid="add-lift-error">{error}</p>
      )}
    </div>
  );
}
