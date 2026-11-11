// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionHeader } from './SessionHeader';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

const session = { title: 'Session', date: '2026-11-11', dayLabel: '1', weekLabel: '1', blockLabel: 'Hypertrophy', tonnage: 1250 };
const render = async (props: Partial<React.ComponentProps<typeof SessionHeader>> = {}) => {
  const all = {
    session, backLabel: 'Calendar', onBack: vi.fn(), onEdit: vi.fn(), canEdit: true,
    finished: false, locked: false, onComplete: vi.fn(), ...props,
  };
  await act(async () => root.render(<SessionHeader {...all} />));
  return all;
};
const q = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('SessionHeader', () => {
  it('shows name, date, labels and tonnage with real controls', async () => {
    const props = await render();
    expect(q('session-name')!.textContent).toBe('Day 1 · Week 1');
    expect(q('session-date')!.textContent).toMatch(/^Wed, 11 Nov/);
    expect(q('session-labels')!.textContent).toBe('Block Hypertrophy');
    expect(q('workout-tonnage')!.textContent).toBe('Tonnage 1,250 kg');
    const back = q('session-back')!;
    expect(back.getAttribute('aria-label')).toBe('Back');
    expect(back.textContent).toContain('Calendar');
    await act(async () => { back.click(); q('session-complete')!.click(); q('session-edit')!.click(); });
    expect(props.onBack).toHaveBeenCalled();
    expect(props.onComplete).toHaveBeenCalled();
    expect(props.onEdit).toHaveBeenCalled();
  });

  it('locks Complete and Edit when they are not allowed', async () => {
    await render({ locked: true, canEdit: false, editDisabledReason: 'No access' });
    expect((q('session-complete') as HTMLButtonElement).disabled).toBe(true);
    expect((q('session-edit') as HTMLButtonElement).disabled).toBe(true);
    expect(q('session-edit')!.getAttribute('title')).toBe('No access');
  });

  it('shows Finished instead of Complete', async () => {
    await render({ finished: true });
    expect(q('session-complete')).toBeNull();
    expect(q('session-finished-badge')!.textContent).toContain('Finished');
  });
});
