import { describe, expect, it } from 'vitest';
import { linePath } from './chartGeometry';

describe('linePath', () => {
  it('maps fixture series into svg coordinates', () => {
    const { d, dots } = linePath([10, 20, 30], 100, 50, { l: 0, r: 0, t: 0, b: 0 });
    expect(dots).toHaveLength(3);
    expect(dots[0].y).toBeGreaterThan(dots[2].y);
    expect(d.startsWith('M ')).toBe(true);
  });
});
