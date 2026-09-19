import { linePath } from '../chartGeometry';
import type { QueryResult, QuerySeries } from '../types';

const PALETTE = [
  'var(--cal-accent)',
  'var(--cal-success)',
  'var(--cal-warning)',
  'var(--cal-error)',
  'var(--cal-badge-dl)',
  'var(--cal-badge-bp)',
];

function seriesStroke(series: QuerySeries, index: number): string {
  const label = series.label.toLowerCase();
  if (label.includes('squat')) return 'var(--cal-badge-sq)';
  if (label.includes('bench')) return 'var(--cal-badge-bp)';
  if (label.includes('dead')) return 'var(--cal-badge-dl)';
  return PALETTE[index % PALETTE.length];
}

export function LineChart({ result }: { result: QueryResult }) {
  const width = 640;
  const height = 220;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-48 motion-reduce:transition-none" role="img" aria-label="Line chart">
      {result.series.map((series, index) => {
        const stroke = seriesStroke(series, index);
        const { d, dots } = linePath(series.points, width, height);
        return (
          <g key={series.id}>
            <path d={d} fill="none" stroke={stroke} strokeWidth="2" />
            {dots.map((dot, i) => (
              <circle key={i} cx={dot.x} cy={dot.y} r="2.5" fill="var(--cal-canvas)" stroke={stroke} />
            ))}
          </g>
        );
      })}
      {result.labels.map((label, i) => {
        const x = 36 + (i / Math.max(result.labels.length - 1, 1)) * (width - 44);
        return (
          <text key={label} x={x} y={height - 6} fill="var(--cal-muted)" fontSize="9" textAnchor="middle">
            {label}
          </text>
        );
      })}
    </svg>
  );
}
