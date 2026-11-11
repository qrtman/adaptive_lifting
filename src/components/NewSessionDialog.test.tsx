// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createSession = vi.hoisted(() => vi.fn(async () => ({ id: 'w-1' })));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'coach-1', email: 'coach@example.com', role: 'COACH' } }),
}));
vi.mock('../contexts/PeriodizationContext', () => ({ usePeriodization: () => ({ microcycles: [] }) }));
vi.mock('../services/api', () => ({ apiService: { createSession } }));
vi.mock('../storage/uiPrefs', () => ({
  UI_KEYS: { role: 'role' }, getUiPref: () => null,
  getRecentBlock: () => null, getRecentDay: () => null, getRecentWeek: () => null,
  setRecentBlock: () => {}, setRecentDay: () => {}, setRecentName: () => {}, setRecentWeek: () => {},
}));

import { NewSessionDialog } from './NewSessionDialog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  createSession.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe('New session for a coach', () => {
  it('creates on the coach\'s own plan when My training is selected', async () => {
    await act(async () => { root.render(<NewSessionDialog date="2026-11-12" athleteId="coach-1" onClose={() => {}} onCreated={() => {}} />); });
    expect(q('new-session-need-athlete')).toBeNull();
    await act(async () => { q('new-session-create')!.click(); });
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-11-12', athleteId: 'coach-1' }));
  });

  it('still asks for a plan when nothing is selected', async () => {
    await act(async () => { root.render(<NewSessionDialog date="2026-11-12" athleteId={null} onClose={() => {}} onCreated={() => {}} />); });
    expect(q('new-session-need-athlete')).not.toBeNull();
    await act(async () => { q('new-session-create')!.click(); });
    expect(createSession).not.toHaveBeenCalled();
  });
});
