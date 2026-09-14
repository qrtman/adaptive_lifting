import type { QueryResult } from '../types';

export function TableChart({ result }: { result: QueryResult }) {
  const rows = result.table;
  if (!rows || rows.length === 0) {
    return (
      <table className="w-full text-mini font-mono">
        <thead>
          <tr>
            <th className="text-left text-fg-muted font-normal">Label</th>
            {result.series.map((s) => (
              <th key={s.id} className="text-right text-fg-muted font-normal">{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.labels.map((label, i) => (
            <tr key={label} className="border-t border-border">
              <td className="py-1 text-fg-strong">{label}</td>
              {result.series.map((s) => (
                <td key={s.id} className="py-1 text-right text-fg-muted">{s.points[i] ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  const keys = Object.keys(rows[0]);
  return (
    <table className="w-full text-mini font-mono">
      <thead>
        <tr>
          {keys.map((key) => (
            <th key={key} className="text-left text-fg-muted font-normal">{key}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-t border-border">
            {keys.map((key) => (
              <td key={key} className="py-1 text-fg-strong">{row[key] ?? '—'}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
