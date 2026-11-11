import React from 'react';
import { AlertCircle, Check, Download, Upload } from 'lucide-react';
import type { ConflictTarget } from '../services/conflictTarget';
import { setListsMatch } from '../services/setSyncShape';

interface ConflictReviewCardProps {
  mutationId: string;
  entityType: string;
  entityId: string;
  reason: string;
  serverFields?: Record<string, unknown>;
  target?: ConflictTarget | null;
  clientFields: Record<string, unknown>;
  onKeepServer: () => void;
  onExport: () => void;
  /** Re-send this edit on top of the server version, replacing what the server has. */
  onUseMine?: () => void;
}

// Server conflict payloads use camelCase training fields (al_exercise_sets_snapshot)
// or a raw exercise_sets row (to_jsonb), so both shapes are labelled here.
const FIELD_LABELS: Record<string, string> = {
  plannedWeight: 'Planned weight', plannedReps: 'Planned reps', plannedRpe: 'Planned RPE',
  actual: 'Logged weight', reps: 'Logged reps', executedRpe: 'Logged RPE',
  velocity: 'Velocity', readiness: 'Readiness', hrv: 'HRV', note: 'Note', notes: 'Notes', label: 'Set label',
  scope: 'Applies to', isTop: 'Top set', isAuto: 'Auto set', intensityType: 'Intensity type', intensity_type: 'Intensity type',
  dropPercent: 'Drop %', sets: 'Sets', name: 'Lift', title: 'Title', date: 'Date', status: 'Status',
};
const HIDDEN_FIELDS = new Set([
  'id', 'revision', 'exercise_id', 'exerciseId', 'workout_id', 'workoutId', 'lexo_rank', 'lexoRank',
  'created_at', 'createdAt', 'updated_at', 'updatedAt', 'deleted_at', 'deletedAt', 'client_updated_at',
]);
const ENTITY_LABELS: Record<string, string> = {
  ExerciseSet: 'set', Exercise: 'lift', Workout: 'session', Microcycle: 'week',
};

function reasonCopy(reason: string, thing: string): string {
  const kept = 'Your edit is still saved on this device and has not been applied.';
  switch (reason) {
    case 'TOMBSTONE_CONFLICT': return `This ${thing} was deleted on the server. ${kept}`;
    case 'STALE_REVISION': return `This ${thing} changed on the server after you started editing. ${kept} Review what changed below, then keep the server version or use your edit.`;
    case 'BASELINE_REQUIRED': return `This edit was made before this device had the latest copy of the ${thing}, so it could not be checked safely. ${kept} Review the server version below.`;
    case 'OVERLAPPING_BATCH_PATCH': return `Two edits from this device to the same ${thing} were sent together, so the later one was held back. ${kept} Use your edit to apply it, or keep the server version.`;
    default: return `The server version of this ${thing} changed before your edit could sync. ${kept} Review below.`;
  }
}

function fieldLabel(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Distinct values must render distinctly: missing vs blank text, flat vs nested lists,
// numbers vs number-looking text.
function display(value: unknown): string {
  if (value === undefined || value === null) return 'not set';
  if (value === '') return 'blank';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return /^\s*-?\d+(\.\d+)?\s*$|^\s|\s$/.test(value) ? `"${value}" (text)` : value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'none';
    return value.map(item => (Array.isArray(item) || (item && typeof item === 'object')) ? `(${display(item)})` : display(item)).join(', ');
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([k]) => !HIDDEN_FIELDS.has(k));
  if (entries.length === 0) return 'not set';
  return entries.map(([k, v]) => `${fieldLabel(k)}: ${display(v)}`).join(', ');
}

function targetLine(target: ConflictTarget | null | undefined, entityType: string, entityId: string, thing: string): string {
  const parts = [
    [target?.sessionDate, target?.sessionTitle].filter(Boolean).join(' · '),
    target?.liftName,
    target?.setNumber ? `Set ${target.setNumber}` : undefined,
  ].filter(Boolean);
  if (parts.length) return parts.join(' — ');
  const label = thing === 'item' ? entityType : thing.charAt(0).toUpperCase() + thing.slice(1);
  return `${label} ${entityId.slice(0, 8)}`;
}

type SetLike = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** One line per set in coach language: "Set 1: Plan 100 kg × 5 @ RPE 8 · Log 105 × 5". */
export function describeSet(set: SetLike, index: number): string {
  const part = (weight: unknown, reps: unknown, rpe: unknown, percent = false) => {
    const w = num(weight), r = num(reps), e = num(rpe);
    if (w === null && r === null && e === null) return null;
    let out = w !== null ? `${w} kg` : '—';
    if (r !== null) out += ` × ${r}`;
    if (e !== null) out += percent ? ` @ ${e}%` : ` @ RPE ${e}`;
    return out;
  };
  const scope = set.scope === 'plan' || set.scope === 'log' ? set.scope : 'both';
  const plan = part(set.plannedWeight, set.plannedReps, set.target_value ?? set.plannedRpe, (set.intensity_type ?? set.intensityType) === 'PERCENT');
  const log = part(set.actual, set.reps, set.executedRpe);
  const pieces: string[] = [];
  // A log-only row has no plan to report, and a plan-only row has no log.
  if (scope !== 'log') pieces.push(plan ? `Plan ${plan}` : 'Plan not set');
  if (scope !== 'plan' && log) pieces.push(`Log ${log.replace(' kg', '')}`);
  if (scope === 'log' && !log) pieces.push('Log not set');
  return `Set ${index + 1}: ${pieces.join(' · ')}`;
}

function lines(key: string, value: unknown): string[] {
  if (key === 'sets' && Array.isArray(value)) {
    return value.length ? value.map((set, i) => describeSet((set ?? {}) as SetLike, i)) : ['No sets'];
  }
  return [display(value)];
}

const same = (key: string, a: unknown, b: unknown) => (key === 'sets' && Array.isArray(a) && Array.isArray(b)
  ? setListsMatch(a, b)
  : JSON.stringify(a ?? null) === JSON.stringify(b ?? null));

export const ConflictReviewCard: React.FC<ConflictReviewCardProps> = ({
  mutationId, entityType, entityId, reason, serverFields = {}, clientFields, target, onKeepServer, onExport, onUseMine,
}) => {
  const thing = ENTITY_LABELS[entityType] || 'item';
  // Show only fields the queued edit touched (falling back to server fields),
  // without bookkeeping columns or values that already match.
  const source = Object.keys(clientFields).length ? Object.keys(clientFields) : Object.keys(serverFields);
  const keys = source.filter(key => !HIDDEN_FIELDS.has(key) && !same(key, serverFields[key], clientFields[key]));
  return (
    <section className="bg-[color-mix(in_srgb,var(--cal-error)_10%,var(--cal-surface-elevated))] border border-[color-mix(in_srgb,var(--cal-error)_30%,transparent)] rounded-[var(--cal-radius-lg)] p-4 mb-4" aria-label={`Sync conflict: ${targetLine(target, entityType, entityId, thing)}`}>
      <div className="flex items-start gap-3">
        <AlertCircle className="text-[var(--cal-error)] shrink-0 mt-0.5" size={20} />
        <div className="flex-1 min-w-0">
          <h4 className="text-[var(--cal-error)] font-semibold text-sm tracking-tight mb-1">Sync conflict needs review</h4>
          <p className="text-xs font-medium text-[var(--cal-ink)] mb-1 tnum" data-testid="conflict-target">{targetLine(target, entityType, entityId, thing)}</p>
          <p className="text-xs text-[var(--cal-body)] mb-1 leading-relaxed" data-testid="conflict-reason">
            {reasonCopy(reason, thing)}
          </p>
          <p className="text-[10px] text-[var(--cal-muted)] mb-3 tnum">Code: {reason}</p>
          {keys.length === 0 && <p className="text-xs text-[var(--cal-muted)] mb-3">No field differences to show.</p>}
          <div className="space-y-2 mb-4" data-testid="conflict-changes">
            {keys.map(key => (
              <div key={key}>
                <div className="text-[10px] text-[var(--cal-muted)] uppercase tracking-wider mb-1">{fieldLabel(key)}</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="cal-nested-card p-[var(--cal-space-xs)] min-w-0">
                    <div className="text-[10px] text-[var(--cal-muted)] mb-1">Server has</div>
                    {lines(key, serverFields[key]).map((line, i) => <p key={i} className="text-xs tnum text-[var(--cal-ink)] break-words">{line}</p>)}
                  </div>
                  <div className="cal-nested-card p-[var(--cal-space-xs)] min-w-0" data-elevated="true">
                    <div className="text-[10px] text-[var(--cal-accent)] mb-1">Your edit</div>
                    {lines(key, clientFields[key]).map((line, i) => <p key={i} className="text-xs tnum text-[var(--cal-ink)] break-words">{line}</p>)}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={onKeepServer} aria-label={`Keep server version for ${targetLine(target, entityType, entityId, thing)}`} className="flex items-center justify-center gap-1.5 flex-1 basis-[7.5rem] py-2 bg-[var(--cal-primary)] hover:bg-[var(--cal-primary-active)] text-[var(--cal-on-primary)] text-xs font-medium rounded-[var(--cal-radius-md)]">
              <Check size={14} /> Keep server version
            </button>
            {onUseMine && (reason === 'STALE_REVISION' || reason === 'OVERLAPPING_BATCH_PATCH') ? (
              <button onClick={onUseMine} data-testid="conflict-use-mine" aria-label={`Use my edit for ${targetLine(target, entityType, entityId, thing)}`} className="flex items-center justify-center gap-1.5 flex-1 basis-[7.5rem] py-2 border border-[var(--cal-border)] text-[var(--cal-ink)] text-xs font-medium rounded-[var(--cal-radius-md)]">
                <Upload size={14} /> Use my edit
              </button>
            ) : null}
            <button onClick={onExport} aria-label={`Export edit ${mutationId}`} className="flex items-center justify-center gap-1.5 flex-1 basis-[7.5rem] py-2 border border-[var(--cal-border)] text-[var(--cal-ink)] text-xs font-medium rounded-[var(--cal-radius-md)]">
              <Download size={14} /> Export my edit
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
