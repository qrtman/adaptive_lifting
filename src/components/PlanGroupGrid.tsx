import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { EditablePerformanceCell } from './EditablePerformanceCell';
import { groupPlanRows, removePlanGroup, resizePlanGroup, type PlanGroup, type PlanLane } from '../features/plan/planGroups';
import { applySetDropPercent, parseDropPercent } from '../services/setPrescription';
import { trainingInt, trainingNumber } from '../services/numericTraining';
import type { CellMode, GridMove, MoveKind, SetGridBind } from '../services/sheetsCellKeyboard';

/**
 * Plan view of one lift (session sheet phase 3): Log columns hidden and identical consecutive
 * sets shown as one row ("3 sets", faint set numbers "2–4"). Editing a grouped row writes every
 * set in it; the Sets cell adds or removes sets. Records are unchanged — one per set.
 */

type Field = 'sets' | 'pct' | 'kg' | 'reps' | 'intensity';
const FIELDS: Field[] = ['sets', 'pct', 'kg', 'reps', 'intensity'];
type Cursor = { row: number; col: number; mode: CellMode; overwrite: boolean; seed?: string };

const text = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(v));
const newId = () => `s-${Math.random().toString(36).slice(2, 12)}`;

export function PlanGroupGrid({
  liftId,
  sets,
  planRows,
  readOnly,
  onChange,
  onNotice,
  enter,
  onExit,
}: {
  liftId: string;
  sets: any[];
  planRows: PlanLane[];
  readOnly: boolean;
  onChange: (next: any[]) => void;
  onNotice: (text: string | null) => void;
  /** Focus handed over from a neighbouring lift (session sheet phase 4). */
  enter?: { edge: 'first' | 'last'; col: number; n: number } | null;
  /** Up/down past the first/last row: let the previous/next lift take focus. */
  onExit?: (direction: 'up' | 'down', col: number) => boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const groups = useMemo(() => groupPlanRows(planRows, expanded), [planRows, expanded]);

  useEffect(() => {
    if (!enter || groups.length === 0) return;
    const row = enter.edge === 'first' ? 0 : groups.length - 1;
    const col = Math.min(Math.max(enter.col, 0), FIELDS.length - 1);
    setCursor({ row, col: !(FIELDS[col] === 'pct' && groups[row]?.start === 0) ? col : col + 1, mode: 'selected', overwrite: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enter?.n]);

  const leave = (row: number, col: number, direction: GridMove): boolean => {
    if (direction !== 'up' && direction !== 'down') return false;
    if (direction === 'down' ? row < groups.length - 1 : row > 0) return false;
    if (!onExit?.(direction, col)) return false;
    setCursor(null);
    return true;
  };

  // Drop % has no editor on the very first set of the lift.
  const editable = (row: number, col: number) => !(FIELDS[col] === 'pct' && groups[row]?.start === 0);

  const valueOf = (group: PlanGroup, field: Field): string => {
    const first = group.lanes[0].set;
    switch (field) {
      case 'sets': return group.lanes.length > 1 ? String(group.lanes.length) : '';
      case 'pct': {
        if (group.start === 0) return '';
        const drop = trainingInt(first.dropPercent) ?? 0;
        return drop ? String(drop) : '';
      }
      case 'kg': return text(first.plannedWeight);
      case 'reps': return text(first.plannedReps);
      case 'intensity': return text(first.target_value ?? first.plannedRpe);
    }
  };

  const write = (group: PlanGroup, field: Field, raw: string) => {
    if (readOnly) return;
    const value = raw.trim();
    if (field === 'sets') {
      const count = value === '' ? 1 : Number(value);
      const res = resizePlanGroup(sets, group, count, newId);
      if ('reason' in res) { onNotice(res.reason); return; }
      onNotice(null);
      onChange(res.sets);
      return;
    }
    if (field === 'pct') {
      const pct = value === '' ? 0 : parseDropPercent(value);
      onChange(group.lanes.reduce((acc, lane) => applySetDropPercent(acc, lane.index, pct), sets));
      return;
    }
    const n = value === '' ? null : trainingNumber(value);
    if (value !== '' && n === null) return;
    const patch = field === 'kg' ? { plannedWeight: n }
      : field === 'reps' ? { plannedReps: n === null ? null : Math.round(n) }
      : { target_value: n, plannedRpe: n };
    const next = [...sets];
    for (const lane of group.lanes) next[lane.index] = { ...next[lane.index], ...patch };
    onNotice(null);
    onChange(next);
  };

  const step = (row: number, col: number, direction: GridMove, kind: MoveKind): { row: number; col: number } => {
    const rows = groups.length;
    if (kind === 'tab' && (direction === 'right' || direction === 'left')) {
      const order: Array<{ row: number; col: number }> = [];
      for (let r = 0; r < rows; r += 1) for (let c = 0; c < FIELDS.length; c += 1) if (editable(r, c)) order.push({ row: r, col: c });
      const at = order.findIndex((cell) => cell.row === row && cell.col === col);
      const target = order[at + (direction === 'right' ? 1 : -1)];
      return target ?? { row, col };
    }
    let r = row;
    let c = col;
    if (direction === 'up') r = Math.max(0, row - 1);
    if (direction === 'down') r = Math.min(rows - 1, row + 1);
    if (direction === 'left') c = Math.max(0, col - 1);
    if (direction === 'right') c = Math.min(FIELDS.length - 1, col + 1);
    if (direction === 'rowStart') c = editable(row, 0) ? 0 : 1;
    if (direction === 'rowEnd') c = FIELDS.length - 1;
    if (!editable(r, c)) c = direction === 'left' ? Math.max(0, c - 1) : Math.min(FIELDS.length - 1, c + 1);
    return { row: r, col: c };
  };

  const bind = (row: number, col: number): SetGridBind => ({
    cellId: `${liftId}:g${row}:plan:${FIELDS[col]}`,
    row,
    col,
    isActive: cursor?.row === row && cursor?.col === col,
    mode: cursor?.row === row && cursor?.col === col ? cursor.mode : 'selected',
    editOverwrite: cursor?.overwrite ?? false,
    editSeed: cursor?.seed,
    tabStop: (cursor == null && row === 0 && col === 2) || (cursor?.row === row && cursor?.col === col),
    onSelect: (r, c) => setCursor({ row: r, col: c, mode: 'selected', overwrite: false }),
    onBeginEdit: (r, c, overwrite, seed) => setCursor({ row: r, col: c, mode: 'editing', overwrite, seed }),
    onCommit: (r, c, _value, move, kind) => {
      if (move && kind) {
        if (kind !== 'tab' && leave(r, c, move)) return;
        const next = step(r, c, move, kind);
        setCursor({ ...next, mode: 'selected', overwrite: false });
        return;
      }
      setCursor((prev) => (prev && (prev.row !== r || prev.col !== c) ? prev : { row: r, col: c, mode: 'selected', overwrite: false }));
    },
    onCancel: (r, c) => setCursor({ row: r, col: c, mode: 'selected', overwrite: false }),
    onMove: (r, c, direction, kind) => {
      if (kind !== 'tab' && leave(r, c, direction)) return;
      const next = step(r, c, direction, kind);
      setCursor({ ...next, mode: 'selected', overwrite: false });
    },
    onRangeCommand: () => false,
  });

  const toggle = (key: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const th = 'px-3 py-1.5 text-right text-xs font-normal text-[var(--cal-muted)] whitespace-nowrap';
  const widths: Record<Field, string> = { sets: 'w-20', pct: 'w-14', kg: 'w-[72px]', reps: 'w-14', intensity: 'w-[84px]' };
  const labels: Record<Field, string> = { sets: 'Sets', pct: 'Drop %', kg: 'kg', reps: 'Reps', intensity: 'Intensity' };

  return (
    <table role="grid" aria-label="Plan sets" data-testid={`plan-group-grid-${liftId}`} className="sheet-grid text-left w-max max-w-full">
      <thead>
        <tr className="border-b border-[var(--cal-hairline-soft)]">
          <th className={`${th} sheet-th w-12 text-center`}>#</th>
          {FIELDS.map((field) => <th key={field} className={`${th} sheet-th`}>{labels[field]}</th>)}
          <th className="w-16 p-0" aria-label="Group actions" />
        </tr>
      </thead>
      <tbody>
        {groups.length === 0 ? (
          <tr><td colSpan={7} className="sheet-td px-3 py-3 text-[13px] text-[var(--cal-muted)]">No sets programmed.</td></tr>
        ) : null}
        {groups.map((group, row) => {
          const label = group.start === group.end ? `${group.start + 1}` : `${group.start + 1}–${group.end + 1}`;
          const isGroup = group.lanes.length > 1;
          const first = group.lanes[0].set;
          const unit = first.intensity_type === 'PERCENT' ? '%' : 'RPE';
          return (
            <tr key={group.key} className="group" data-testid={`plan-group-${liftId}-${row}`}>
              <td className="sheet-td sheet-td--num w-12 px-2 text-center tnum text-[11px] text-[var(--cal-muted-soft)]" data-testid={`plan-group-${liftId}-${row}-index`}>
                {label}
              </td>
              {FIELDS.map((field, col) => (
                <td key={field} className="p-0 align-middle whitespace-nowrap sheet-td">
                  <EditablePerformanceCell
                    value={valueOf(group, field)}
                    onChange={(val) => write(group, field, val)}
                    placeholder=""
                    ghost={field === 'sets' && !isGroup ? '1' : null}
                    suffix={field === 'sets' ? 'sets' : field === 'intensity' ? unit : ''}
                    fieldKey={`${liftId}-g${row}-${field}`}
                    label={`Plan ${labels[field]}`}
                    widthClass={widths[field]}
                    readOnly={readOnly || !editable(row, col)}
                    step={field === 'kg' ? 2.5 : field === 'intensity' ? 0.5 : 1}
                    grid={bind(row, col)}
                  />
                </td>
              ))}
              <td className="w-16 whitespace-nowrap px-1 align-middle">
                <div className="flex items-center gap-0.5">
                  {isGroup || group.expandedFrom ? (
                    <button
                      type="button"
                      onClick={() => toggle(group.expandedFrom ?? group.key)}
                      aria-label={group.expandedFrom ? 'Group identical sets' : `Show sets ${label} one by one`}
                      data-testid={`plan-group-${liftId}-${row}-toggle`}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--cal-radius-md)] text-[var(--cal-muted)] hover:bg-[var(--cal-surface-strong)] hover:text-[var(--cal-ink)]"
                    >
                      {group.expandedFrom ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
                    </button>
                  ) : <span className="inline-block h-6 w-6" aria-hidden="true" />}
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => {
                      const res = removePlanGroup(sets, group);
                      if ('reason' in res) { onNotice(res.reason); return; }
                      onChange(res.sets);
                    }}
                    aria-label={`Delete sets ${label}`}
                    data-testid={`plan-group-${liftId}-${row}-delete`}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--cal-radius-md)] text-[var(--cal-muted)] opacity-0 hover:bg-[var(--cal-surface-strong)] hover:text-[var(--cal-ink)] focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 disabled:pointer-events-none"
                  >
                    <Trash2 size={12} aria-hidden="true" />
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
