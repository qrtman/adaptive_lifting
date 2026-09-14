import type { QueryResult, QuerySeries } from './types';

const SERIES_COLORS = [
  'var(--color-accent)',
  'var(--color-ok)',
  'var(--color-warn)',
  'var(--color-error)',
  'var(--color-series-4)',
  'var(--color-series-5)',
];

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

export function linePath(
  points: Array<number | null>,
  width: number,
  height: number,
  pad = { l: 36, r: 8, t: 12, b: 24 },
): { d: string; dots: Array<{ x: number; y: number; v: number }> } {
  const nums = points.filter((p): p is number => p != null);
  const max = Math.max(...nums, 1);
  const min = Math.min(...nums, 0);
  const span = max - min || 1;
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const n = Math.max(points.length - 1, 1);
  const dots: Array<{ x: number; y: number; v: number }> = [];
  let d = '';
  points.forEach((value, i) => {
    if (value == null) return;
    const x = pad.l + (i / n) * innerW;
    const y = pad.t + innerH - ((value - min) / span) * innerH;
    dots.push({ x, y, v: value });
    d += d ? ` L ${x} ${y}` : `M ${x} ${y}`;
  });
  return { d, dots };
}

export { SERIES_COLORS };
