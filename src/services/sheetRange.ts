/**
 * Range selection math for one lift's set grid (Sheets parity, no grid library).
 * Columns are the logical keyboard columns from `COLS` in sheetsCellKeyboard.ts
 * (0 Drop %, 1–3 Plan kg/reps/intensity, 4–6 Log kg/reps/RPE). Rows are set rows.
 * Everything here is pure: the card decides which cells are writable and applies writes.
 */

export type GridCell = { row: number; col: number };
export type GridRect = { top: number; left: number; bottom: number; right: number };
export type CellWrite = { row: number; col: number; raw: string };

export function rectOf(anchor: GridCell, end?: GridCell | null): GridRect {
  const other = end ?? anchor;
  return {
    top: Math.min(anchor.row, other.row),
    bottom: Math.max(anchor.row, other.row),
    left: Math.min(anchor.col, other.col),
    right: Math.max(anchor.col, other.col),
  };
}

export function rectHas(rect: GridRect, row: number, col: number): boolean {
  return row >= rect.top && row <= rect.bottom && col >= rect.left && col <= rect.right;
}

export function isSingleCell(rect: GridRect): boolean {
  return rect.top === rect.bottom && rect.left === rect.right;
}

export function cellsIn(rect: GridRect): GridCell[] {
  const cells: GridCell[] = [];
  for (let row = rect.top; row <= rect.bottom; row += 1) {
    for (let col = rect.left; col <= rect.right; col += 1) cells.push({ row, col });
  }
  return cells;
}

/** Move one corner of the range by one cell, clamped to the grid. */
export function extendEnd(
  end: GridCell,
  direction: 'left' | 'right' | 'up' | 'down',
  rowCount: number,
  colCount: number,
): GridCell {
  const lastRow = Math.max(0, rowCount - 1);
  const lastCol = Math.max(0, colCount - 1);
  switch (direction) {
    case 'left': return { row: end.row, col: Math.max(0, end.col - 1) };
    case 'right': return { row: end.row, col: Math.min(lastCol, end.col + 1) };
    case 'up': return { row: Math.max(0, end.row - 1), col: end.col };
    case 'down': return { row: Math.min(lastRow, end.row + 1), col: end.col };
    default: {
      const _exhaustive: never = direction;
      return _exhaustive;
    }
  }
}

/** Clipboard text from Sheets/Excel → rows of cells. Trailing newline ignored; CRLF ok. */
export function parseTsv(text: string): string[][] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (normalized === '') return [['']];
  return normalized.split('\n').map((line) => line.split('\t').map((cell) => cell.trim()));
}

/** One pasted cell → a plain number string ("8,5" → "8.5", "100 kg" → "100", "80%" → "80"). */
export function normalizePastedNumber(raw: string): string {
  const trimmed = raw.trim().replace(/\s*(kg|%)$/i, '');
  return /^-?\d+,\d+$/.test(trimmed) ? trimmed.replace(',', '.') : trimmed;
}

export function toTsv(rect: GridRect, read: (row: number, col: number) => string): string {
  const lines: string[] = [];
  for (let row = rect.top; row <= rect.bottom; row += 1) {
    const cells: string[] = [];
    for (let col = rect.left; col <= rect.right; col += 1) cells.push(read(row, col));
    lines.push(cells.join('\t'));
  }
  return lines.join('\n');
}

/**
 * Where a paste lands. A single value fills the whole selection (Sheets); otherwise the
 * block starts at the selection's top-left and is clipped at the last row and column.
 * Never adds rows: `clippedRows` tells the caller how many pasted rows did not fit.
 */
export function planPaste(
  selection: GridRect,
  matrix: string[][],
  rowCount: number,
  colCount: number,
): { writes: CellWrite[]; clippedRows: number; pastedRows: number } {
  const single = matrix.length === 1 && matrix[0].length === 1;
  if (single) {
    const raw = normalizePastedNumber(matrix[0][0]);
    return {
      writes: cellsIn(selection).map((cell) => ({ ...cell, raw })),
      clippedRows: 0,
      pastedRows: selection.bottom - selection.top + 1,
    };
  }
  const writes: CellWrite[] = [];
  let pastedRows = 0;
  matrix.forEach((line, r) => {
    const row = selection.top + r;
    if (row >= rowCount) return;
    pastedRows += 1;
    line.forEach((value, c) => {
      const col = selection.left + c;
      if (col >= colCount) return;
      writes.push({ row, col, raw: normalizePastedNumber(value) });
    });
  });
  return { writes, clippedRows: Math.max(0, matrix.length - pastedRows), pastedRows };
}

/**
 * Ctrl+D. A taller range copies its first row into the rows below; a one-row range
 * copies the row above it (Sheets). Returns nothing on row 0 with no row above.
 */
export function planFillDown(
  rect: GridRect,
  read: (row: number, col: number) => string,
): CellWrite[] {
  const sourceRow = rect.top === rect.bottom ? rect.top - 1 : rect.top;
  if (sourceRow < 0) return [];
  const firstTarget = rect.top === rect.bottom ? rect.top : rect.top + 1;
  const writes: CellWrite[] = [];
  for (let row = firstTarget; row <= rect.bottom; row += 1) {
    for (let col = rect.left; col <= rect.right; col += 1) {
      writes.push({ row, col, raw: read(sourceRow, col) });
    }
  }
  return writes;
}
