import { describe, expect, it } from 'vitest';
import { VISUALIZATION_REGISTRY } from './index';
import type { QueryResult } from '../types';

const fixture: QueryResult = {
  math_version: 'linear-decay-v1',
  labels: ['W1', 'W2'],
  series: [{ id: 's1', label: 'e1rm', metric: 'e1rm', unit: 'kg', points: [150, 155] }],
  units: { e1rm: 'kg' },
  matrix: {
    rows: ['Knee Dominant'],
    cols: ['Mon', 'Tue'],
    cells: { 'Knee Dominant': { Mon: 4, Tue: 0 } },
    metric: 'set_count',
  },
  table: [{ week: 'W1', spacing: 2, e1rm: 150, e1rm_change: null }],
};

describe('visualization registry', () => {
  it('has one component per visualization', () => {
    expect(Object.keys(VISUALIZATION_REGISTRY).sort()).toEqual(
      ['bar', 'heatmap', 'line', 'table', 'weekday_matrix'].sort(),
    );
    for (const Chart of Object.values(VISUALIZATION_REGISTRY)) {
      expect(typeof Chart).toBe('function');
      expect(Chart({ result: fixture })).toBeTruthy();
    }
  });
});
