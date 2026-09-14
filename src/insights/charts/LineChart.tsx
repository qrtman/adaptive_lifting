import { linePath, seriesColor } from '../chartGeometry';
import type { QueryResult } from '../types';

export function LineChart({ result }: { result: QueryResult }) {
  const width = 640;
  const height = 220;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-48 motion-reduce:transition-none" role="img" aria-label="Line chart">
      {result.series.map((series, index) => {
        const { d, dots } = linePath(series.points, width, height);
        return (
          <g key={series.id}>
            <path d={d} fill="none" stroke={seriesColor(index)} strokeWidth="2" />
            {dots.map((dot, i) => (
              <circle key={i} cx={dot.x} cy={dot.y} r="2.5" fill="#0A0A0A" stroke={seriesColor(index)} />
            ))}
          </g>
        );
      })}
      {result.labels.map((label, i) => {
        const x = 36 + (i / Math.max(result.labels.length - 1, 1)) * (width - 44);
        return (
          <text key={label} x={x} y={height - 6} fill="#8E8E93" fontSize="9" textAnchor="middle">
            {label}
          </text>
        );
      })}
    </svg>
  );
}
