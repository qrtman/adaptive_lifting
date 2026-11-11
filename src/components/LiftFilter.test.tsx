// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_LIFT_FILTER, type LiftFilterState } from '../services/liftFilter';
import { LiftFilter, sentenceCase } from './LiftFilter';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

function Harness() {
  const [value, setValue] = useState<LiftFilterState>(EMPTY_LIFT_FILTER);
  return <LiftFilter value={value} onChange={setValue} emptyLabel="All lifts" />;
}
const q = (id: string) => document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
const click = async (id: string) => { await act(async () => { q(id)!.click(); }); };

beforeEach(async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('LiftFilter', () => {
  it('shows Any for an empty row and sentence-case pattern names', async () => {
    expect(sentenceCase('Knee Dominant')).toBe('Knee dominant');
    await click('lift-filter-open');
    expect(q('lift-filter-lift-All')!.textContent).toBe('Any');
    expect(q('lift-filter-lift-All')!.getAttribute('aria-pressed')).toBe('true');
    expect(q('lift-filter-pattern-Knee Dominant')!.textContent).toBe('Knee dominant');
    expect(q('lift-filter-clear-all')!.disabled).toBe(true);
  });

  it('marks the active filter on the toolbar and clears it from there or the dialog', async () => {
    await click('lift-filter-open');
    await click('lift-filter-lift-Squat');
    await click('lift-filter-lift-Bench');
    await click('lift-filter-pattern-Knee Dominant');
    expect(q('lift-filter-open')!.textContent).toBe('Squat, Bench · Knee dominant');
    expect(q('lift-filter-lift-All')!.getAttribute('aria-pressed')).toBe('false');
    await click('lift-filter-clear-all');
    expect(q('lift-filter-open')!.textContent).toBe('All lifts');
    await click('lift-filter-tier-Comp');
    expect(q('lift-filter-clear')).not.toBeNull();
    await click('lift-filter-clear');
    expect(q('lift-filter-clear')).toBeNull();
    expect(q('lift-filter-open')!.textContent).toBe('All lifts');
  });
});
