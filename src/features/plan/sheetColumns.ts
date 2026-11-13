/**
 * Fixed column widths of the session sheet (polish pass 2). Every lift's table uses the same
 * widths, so one column header at the top of the session lines up with all lifts.
 * Widths were measured from the auto-sized grid before it was fixed.
 */

export type SheetColumn = { key: string; width: number; label?: string; title?: string; gap?: boolean; align?: 'left' | 'right' | 'center' };

export type SheetView = 'plan' | 'both' | 'log';

/** Lift name column on wide screens (the shared header's "Lift"). */
export const NAME_COL_WIDTH = 140;

const NUM: SheetColumn = { key: 'num', width: 40, label: '#', align: 'center' };
const GAP = (key: string): SheetColumn => ({ key, width: 10, gap: true });
const logColumns = (kgLabel: string): SheetColumn[] => [
  { key: 'logKg', width: 73, label: kgLabel },
  { key: 'logReps', width: 57, label: 'Reps' },
  { key: 'logRpe', width: 57, label: 'RPE' },
  GAP('gapMetric'),
  { key: 'e1rm', width: 64, label: 'e1RM' },
  { key: 'delta', width: 64, label: 'Δ%' },
  { key: 'inol', width: 64, label: 'INOL' },
  // Logged ✓ at rest; the row tools open over the metric cells on hover.
  { key: 'tools', width: 24 },
];

export const BOTH_COLUMNS: SheetColumn[] = [
  NUM,
  { key: 'pct', width: 68, label: 'Drop %' },
  { key: 'planKg', width: 73, label: 'kg' },
  { key: 'planReps', width: 57, label: 'Reps' },
  { key: 'planTarget', width: 86, label: 'Intensity' },
  GAP('gapPlan'),
  ...logColumns('Log kg'),
];

/** Log view: the Plan cells are hidden (display: none), so they take no column. */
export const LOG_COLUMNS: SheetColumn[] = [NUM, ...logColumns('kg')];

export const PLAN_COLUMNS: SheetColumn[] = [
  { key: 'num', width: 48, label: '#', align: 'center' },
  { key: 'sets', width: 81, label: 'Sets' },
  { key: 'pct', width: 67, label: 'Drop %' },
  { key: 'kg', width: 73, label: 'kg' },
  { key: 'reps', width: 57, label: 'Reps' },
  { key: 'intensity', width: 85, label: 'Intensity' },
  { key: 'nl', width: 56, label: 'NL', title: 'Number of lifts: planned reps of this lift' },
  { key: 'volume', width: 96, label: 'Volume', title: 'Planned volume of this lift' },
  { key: 'int', width: 56, label: 'Int', title: 'Average planned intensity of this lift, %1RM' },
  { key: 'tools', width: 64 },
];

export const sheetColumns = (view: SheetView): SheetColumn[] =>
  view === 'plan' ? PLAN_COLUMNS : view === 'log' ? LOG_COLUMNS : BOTH_COLUMNS;

export const sheetWidth = (columns: readonly SheetColumn[]) => columns.reduce((sum, col) => sum + col.width, 0);
