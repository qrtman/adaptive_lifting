import { seriesColor } from '../chartGeometry';
import type { QueryResult } from '../types';

export function BarChart({ result }: { result: QueryResult }) {
  const width = 640;
  const height = 220;
  if (result.series.length === 0) return <p className="text-mini text-fg-muted">No series</p>;
  const nums = result.series.flatMap((s) => s.points.filter((p): p is number => p != null));
  const max = Math.max(...nums, 1);
  const n = Math.max(result.labels.length, result.series[0].points.length, 1);
  const group = (width - 48) / n;
  const barW = group / Math.max(result.series.length, 1) * 0.7;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-48 motion-reduce:transition-none" role="img" aria-label="Bar chart">
      {result.series.map((series, sIdx) =>
        series.points.map((value, i) => {
          const h = value == null ? 0 : (value / max) * (height - 40);
          return (
            <rect
              key={`${series.id}-${i}`}
              x={40 + i * group + sIdx * barW + group * 0.1}
              y={height - 24 - h}
              width={barW}
              height={h}
              fill={seriesColor(sIdx)}
              fillOpacity={0.85}
            />
          );
        }),
      )}
    </svg>
  );
}
