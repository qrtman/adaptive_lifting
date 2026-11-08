// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockTabs, formatBlockRange, sessionCountLabel } from './BlockTabs';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let node: HTMLDivElement;

beforeEach(() => {
  node = document.createElement('div');
  document.body.appendChild(node);
  root = createRoot(node);
});

afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});

describe('formatBlockRange', () => {
  it('formats one day, same month and cross month ranges from ISO dates', () => {
    expect(formatBlockRange('2026-11-03', '2026-11-03')).toBe('Nov 3');
    expect(formatBlockRange('2026-11-03', '2026-11-30')).toBe('Nov 3 – 30');
    expect(formatBlockRange('2026-11-28', '2026-12-21')).toBe('Nov 28 – Dec 21');
    expect(formatBlockRange('', '')).toBe('');
    expect(sessionCountLabel(1)).toBe('1 session');
    expect(sessionCountLabel(2)).toBe('2 sessions');
  });
});

describe('BlockTabs', () => {
  const tabs = [
    { key: 'block:1', label: 'Block 1', detail: 'Nov 3 – 30', count: 8 },
    { key: 'block:2', label: 'Block 2', detail: 'Dec 1 – 21', count: 6 },
    { key: 'unassigned', label: 'Unassigned', detail: '2 sessions', count: 2 },
  ];

  async function render(selectedKey: string, onSelect = vi.fn()) {
    await act(async () => root.render(<BlockTabs tabs={tabs} selectedKey={selectedKey} onSelect={onSelect} />));
    return onSelect;
  }

  it('shows every block with its dates and marks the current one', async () => {
    await render('block:2');
    const items = [...node.querySelectorAll('[role="tab"]')];
    expect(items.map((tab) => tab.textContent)).toEqual(['Block 1Nov 3 – 30', 'Block 2Dec 1 – 21', 'Unassigned2 sessions']);
    expect(items.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(items.map((tab) => tab.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    expect(node.querySelector('[role="tablist"]')?.getAttribute('data-value')).toBe('block:2');
  });

  it('selects on click and moves with arrow, Home and End keys', async () => {
    const onSelect = await render('block:2');
    await act(async () => node.querySelector<HTMLButtonElement>('[data-testid="sessions-block-tab-unassigned"]')!.click());
    expect(onSelect).toHaveBeenLastCalledWith('unassigned');
    const list = node.querySelector('[role="tablist"]')!;
    const press = (key: string) => act(async () => { list.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
    await press('ArrowLeft');
    expect(onSelect).toHaveBeenLastCalledWith('block:1');
    await press('ArrowRight');
    expect(onSelect).toHaveBeenLastCalledWith('unassigned');
    await press('Home');
    expect(onSelect).toHaveBeenLastCalledWith('block:1');
    await press('End');
    expect(onSelect).toHaveBeenLastCalledWith('unassigned');
  });
});
