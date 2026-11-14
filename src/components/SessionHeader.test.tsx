// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionHeader } from './SessionHeader';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

const session = { title: 'Session', date: '2026-11-11', dayLabel: '1', weekLabel: '1', blockLabel: 'Hypertrophy' };
const render = async (props: Partial<React.ComponentProps<typeof SessionHeader>> = {}) => {
  const all = {
    session, setCount: 17, backLabel: 'Calendar', onBack: vi.fn(), onEdit: vi.fn(), canEdit: true,
    ...props,
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
  it('leads with the Day; Week · Block and the set count are meta; no tonnage', async () => {
    const props = await render();
    expect(q('session-name')!.textContent).toBe('Day 1');
    expect(q('session-title-sub')).toBeNull();
    expect(q('session-date')!.textContent).toMatch(/^Wed, 11 Nov/);
    expect(q('session-labels')!.textContent).toBe('Week 1 · Block Hypertrophy');
    expect(q('session-set-count')!.textContent).toBe('17 sets');
    expect(q('workout-tonnage')).toBeNull();
    expect(q('session-day-note')).toBeNull();
    const back = q('session-back')!;
    expect(back.getAttribute('aria-label')).toBe('Back');
    expect(back.textContent).toContain('Calendar');
    await act(async () => { back.click(); q('session-edit')!.click(); });
    expect(props.onBack).toHaveBeenCalled();
    expect(props.onEdit).toHaveBeenCalled();
  });

  it('in Both / Log shows logged of planned sets instead (phase 7); no plan → plain count', async () => {
    await render({ logged: { logged: 4, planned: 14 } });
    expect(q('session-set-count')!.textContent).toBe('Logged 4 / 14 sets');
    await render({ setCount: 2, logged: { logged: 2, planned: 0 } });
    expect(q('session-set-count')!.textContent).toBe('2 sets');
  });

  it('shows the Name as a small subtitle next to the Day, and the day note', async () => {
    await render({ session: { ...session, title: 'Lower + Push' }, dayNote: 'Gym closes at 20:00' });
    expect(q('session-name')!.textContent).toBe('Day 1');
    expect(q('session-title-sub')!.textContent).toBe('Lower + Push');
    expect(q('session-day-note')!.textContent).toContain('Gym closes at 20:00');
  });

  it('without a Day, the Name leads (or the Week when unnamed)', async () => {
    await render({ session: { ...session, dayLabel: '2026-11-11', title: 'Squat' }, setCount: 1 });
    expect(q('session-name')!.textContent).toBe('Squat');
    expect(q('session-labels')!.textContent).toBe('Week 1 · Block Hypertrophy');
    expect(q('session-set-count')!.textContent).toBe('1 set');
    await render({ session: { ...session, dayLabel: '2026-11-11' } });
    expect(q('session-name')!.textContent).toBe('Week 1');
    expect(q('session-labels')!.textContent).toBe('Block Hypertrophy');
  });

  it('locks Edit when it is not allowed', async () => {
    await render({ canEdit: false, editDisabledReason: 'No access' });
    expect((q('session-edit') as HTMLButtonElement).disabled).toBe(true);
    expect(q('session-edit')!.getAttribute('title')).toBe('No access');
  });

  it('has no Complete session button or Finished badge', async () => {
    await render();
    expect(q('session-complete')).toBeNull();
    expect(q('session-finished-badge')).toBeNull();
  });
});
