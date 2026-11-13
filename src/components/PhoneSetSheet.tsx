import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { trainingInt, trainingNumber } from '../services/numericTraining';

/**
 * Portrait phone set details (`.cursor/scopes/phone/PLAN.md`, M2). Tapping a row's Plan text
 * opens this sheet: the Plan prescription (editable with Plan rights), and the row's e1RM /
 * Δ / INOL that have no column in portrait. Nothing here is phone-only data; it is the same
 * set the desktop grid edits.
 */

export type PlanPatch = {
  plannedWeight: number | null;
  plannedReps: number | null;
  intensity_type: 'RPE' | 'PERCENT';
  target_value: number | null;
  plannedRpe: number | null;
  dropPercent?: number;
};

/** "150×3 @8" / "100×5 70%" / "—" — the Plan of one row as compact text. */
export function planBrief(set: Record<string, any> | undefined): string {
  if (!set) return '';
  const kg = trainingNumber(set.plannedWeight);
  const reps = trainingInt(set.plannedReps);
  const target = trainingNumber(set.target_value ?? set.plannedRpe);
  if (kg == null && reps == null && target == null) return '—';
  const shape = `${kg ?? '—'}×${reps ?? '—'}`;
  if (target == null) return shape;
  return set.intensity_type === 'PERCENT' ? `${shape} ${target}%` : `${shape} @${target}`;
}

const num = (text: string): number | null => {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function PhoneSetSheet({
  liftTitle,
  setNumber,
  plan,
  canEditPlan,
  showDrop,
  metrics,
  onSave,
  onClose,
  actions = [],
}: {
  /** Row tools (Copy plan → log, Copy, Delete): on a phone they live here, not over the row. */
  actions?: Array<{ label: string; testId: string; onClick: () => void; disabled?: boolean; danger?: boolean }>;
  liftTitle: string;
  setNumber: number;
  plan: Record<string, any> | undefined;
  canEditPlan: boolean;
  /** Drop % has no meaning on the lift's first set. */
  showDrop: boolean;
  metrics: { e1rm: string; delta: string; inol: string };
  onSave: (patch: PlanPatch) => void;
  onClose: () => void;
}) {
  const [kg, setKg] = useState(String(plan?.plannedWeight ?? ''));
  const [reps, setReps] = useState(String(plan?.plannedReps ?? ''));
  const [type, setType] = useState<'RPE' | 'PERCENT'>(plan?.intensity_type === 'PERCENT' ? 'PERCENT' : 'RPE');
  const [target, setTarget] = useState(String(plan?.target_value ?? plan?.plannedRpe ?? ''));
  const [drop, setDrop] = useState(String(trainingInt(plan?.dropPercent) || ''));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = () => {
    const value = num(target);
    onSave({
      plannedWeight: num(kg),
      plannedReps: num(reps) == null ? null : Math.round(num(reps)!),
      intensity_type: type,
      target_value: value,
      plannedRpe: value,
      ...(showDrop ? { dropPercent: Math.round(num(drop) ?? 0) } : {}),
    });
    onClose();
  };

  const field = 'h-12 w-full rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)] bg-[var(--cal-canvas)] px-3 text-right text-lg tnum text-[var(--cal-ink)] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--cal-accent)]';
  const label = 'flex flex-col gap-1 text-[12px] text-[var(--cal-muted)]';
  const readOnly = !canEditPlan || !plan;

  return (
    <div className="bottom-sheet-backdrop" onClick={onClose} data-testid="phone-set-sheet-backdrop">
      <section role="dialog" aria-modal="true" aria-label={`${liftTitle} set ${setNumber}`} data-testid="phone-set-sheet"
        className="bottom-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-[15px] font-semibold text-[var(--cal-ink)]">
            {liftTitle} <span className="font-normal text-[var(--cal-muted)]">· Set {setNumber}</span>
          </p>
          <button type="button" aria-label="Close" onClick={onClose}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--cal-radius-md)] text-[var(--cal-muted)] hover:bg-[var(--cal-surface-soft)]">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {plan ? (
          <div className="grid grid-cols-3 gap-2">
            <label className={label}>Plan kg
              <input data-testid="phone-set-kg" inputMode="decimal" className={field} value={kg} disabled={readOnly} onChange={(e) => setKg(e.target.value)} />
            </label>
            <label className={label}>Reps
              <input data-testid="phone-set-reps" inputMode="numeric" className={field} value={reps} disabled={readOnly} onChange={(e) => setReps(e.target.value)} />
            </label>
            <label className={label}>{type === 'PERCENT' ? '%1RM' : 'RPE'}
              <input data-testid="phone-set-target" inputMode="decimal" className={field} value={target} disabled={readOnly} onChange={(e) => setTarget(e.target.value)} />
            </label>
            <div role="group" aria-label="Intensity" className="col-span-2 flex h-11 rounded-[var(--cal-radius-md)] bg-[var(--cal-surface-soft)] p-0.5">
              {(['RPE', 'PERCENT'] as const).map((t) => (
                <button key={t} type="button" aria-pressed={type === t} disabled={readOnly} data-testid={`phone-set-type-${t}`}
                  onClick={() => setType(t)}
                  className={`flex-1 rounded-[calc(var(--cal-radius-md)-2px)] text-[13px] ${type === t ? 'bg-[var(--cal-surface-elevated)] font-semibold text-[var(--cal-ink)] shadow-sm' : 'text-[var(--cal-muted)]'}`}>
                  {t === 'RPE' ? 'RPE' : '% 1RM'}
                </button>
              ))}
            </div>
            {showDrop ? (
              <label className={label}>Drop %
                <input data-testid="phone-set-drop" inputMode="numeric" className={field} value={drop} disabled={readOnly} onChange={(e) => setDrop(e.target.value)} />
              </label>
            ) : null}
          </div>
        ) : (
          <p className="text-[13px] text-[var(--cal-muted)]">No Plan for this set — logged beyond the plan.</p>
        )}
        <dl className="grid grid-cols-3 gap-2 text-center tnum" data-testid="phone-set-metrics">
          {([['e1RM', metrics.e1rm], ['Δ%', metrics.delta], ['INOL', metrics.inol]] as const).map(([k, v]) => (
            <div key={k} className="rounded-[var(--cal-radius-md)] bg-[var(--cal-surface-soft)] px-2 py-2">
              <dt className="text-[11px] text-[var(--cal-muted)]">{k}</dt>
              <dd className="text-[15px] text-[var(--cal-ink)]">{v}</dd>
            </div>
          ))}
        </dl>
        {actions.length ? (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <button key={action.testId} type="button" data-testid={action.testId} disabled={action.disabled}
                onClick={() => { action.onClick(); onClose(); }}
                className={`h-11 flex-1 whitespace-nowrap rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)] px-3 text-[13px] disabled:opacity-40 ${action.danger ? 'text-[var(--cal-error)]' : 'text-[var(--cal-ink)]'}`}>
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
        {plan && canEditPlan ? (
          <button type="button" data-testid="phone-set-save" onClick={save}
            className="h-12 rounded-[var(--cal-radius-md)] bg-[var(--cal-primary)] text-[15px] font-medium text-[var(--cal-on-primary)]">
            Save plan
          </button>
        ) : null}
      </section>
    </div>
  );
}
