import { describe, expect, it } from 'vitest';
import { matchComboOptions } from './ComboBox';

describe('matchComboOptions', () => {
  it('lists all options when the query is empty', () => {
    expect(matchComboOptions('', ['Meet prep', 'Day 1'], { allowCreate: true }).map((row) => row.value)).toEqual([
      'Meet prep',
      'Day 1',
    ]);
  });

  it('typeaheads and offers create when the query is new', () => {
    const rows = matchComboOptions('Meet', ['Meet prep', 'Day 1'], { allowCreate: true });
    expect(rows.map((row) => row.value)).toEqual(['Meet prep', 'Meet']);
    expect(rows[1]?.create).toBe(true);
  });

  it('includes an empty None row for optional labels', () => {
    const rows = matchComboOptions('', ['Hypertrophy'], { allowEmpty: true, emptyLabel: 'None' });
    expect(rows[0]).toEqual({ value: '', label: 'None' });
  });
});
