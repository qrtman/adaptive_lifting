import type { QueryResult } from '../types';

const FILLS = [
  'bg-[var(--cal-surface-soft)]',
  'bg-[color-mix(in_srgb,var(--cal-accent)_12%,transparent)]',
  'bg-[color-mix(in_srgb,var(--cal-accent)_28%,transparent)]',
  'bg-[color-mix(in_srgb,var(--cal-accent)_48%,transparent)]',
  'bg-[color-mix(in_srgb,var(--cal-accent)_72%,transparent)]',
];

function fillFor(value: number, max: number): string {
  if (!value || max <= 0) return FILLS[0];
  const idx = Math.min(FILLS.length - 1, Math.ceil((value / max) * (FILLS.length - 1)));
  return FILLS[idx];
}

export function WeekdayMatrix({ result }: { result: QueryResult }) {
  const matrix = result.matrix;
  if (!matrix) return <p className="text-[11px] text-[var(--cal-muted)]">No matrix</p>;
  const max = Math.max(1, ...matrix.rows.flatMap((row) => matrix.cols.map((col) => matrix.cells[row]?.[col] || 0)));
  return (
    <div className="overflow-x-auto" role="img" aria-label="Weekday matrix">
      <table className="w-full text-[10px] font-mono">
        <thead>
          <tr>
            <th className="text-left text-[var(--cal-muted)] font-normal pr-2">Pattern</th>
            {matrix.cols.map((col) => (
              <th key={col} className="text-[var(--cal-muted)] font-normal px-1">{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row) => (
            <tr key={row}>
              <td className="text-[var(--cal-muted)] pr-2 whitespace-nowrap">{row}</td>
              {matrix.cols.map((col) => {
                const value = matrix.cells[row]?.[col] || 0;
                return (
                  <td key={col} className={`px-1 py-1 text-center text-[var(--cal-ink)] ${fillFor(value, max)}`}>
                    {value ? Math.round(value) : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
