import { NAME_COL_WIDTH, sheetColumns, sheetWidth, type SheetColumn, type SheetView } from '../features/plan/sheetColumns';

/** Fixed widths for one lift's table (polish pass 2), shared with the session column header. */
export function SheetColGroup({ columns }: { columns: readonly SheetColumn[] }) {
  return (
    <colgroup>
      {columns.map((col) => <col key={col.key} style={{ width: col.width }} />)}
    </colgroup>
  );
}

/**
 * One column header for the whole session (polish pass 2, mockup v2). Shown only on wide
 * screens, where each lift's name sits in its own first column and its table drops its header
 * (index.css `.sheet-head`). Narrow screens keep a header per lift.
 */
export function SessionSheetHeader({ view }: { view: SheetView }) {
  const columns = sheetColumns(view);
  return (
    <div className="sheet-head" data-testid="session-sheet-head" aria-hidden="true">
      <span className="sheet-head__name" style={{ width: NAME_COL_WIDTH }}>Lift</span>
      <table className="sheet-head__table" style={{ width: sheetWidth(columns) }}>
        <SheetColGroup columns={columns} />
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} title={col.title} className={col.gap ? 'sheet-head__gap' : col.align === 'center' ? 'text-center' : 'text-right'}>
                {col.label ?? ''}
              </th>
            ))}
          </tr>
        </thead>
      </table>
    </div>
  );
}
