// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessProvider, useAccountAccess } from './AccessContext';
import type { WorkspaceAccess } from '../services/api';

const { auth, fetchAccess } = vi.hoisted(() => ({ auth: { current: null as any }, fetchAccess: vi.fn() }));
vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: auth.current }) }));
vi.mock('../services/api', () => ({ apiService: { fetchAccountAccess: fetchAccess } }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

function Probe() {
  const state = useAccountAccess();
  return <div data-testid="state" data-status={state.status} data-active={String(state.hasActiveCoachAccess)}
    data-program={String(state.canProgram)} data-analytics={String(state.canUseAnalytics)}>
    {state.access?.workspace?.id || 'no-workspace'}
  </div>;
}

async function render() {
  await act(async () => { root.render(<AccessProvider><Probe /></AccessProvider>); });
}

beforeEach(() => {
  fetchAccess.mockReset();
  auth.current = { id: 'coach-1', role: 'COACH' };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('AccessProvider', () => {
  it('loads coach capabilities from the account access response', async () => {
    const access: WorkspaceAccess = {
      workspace: { id: 'workspace-1', name: 'Coach Coaching' }, membershipRole: 'OWNER',
      entitlements: { active: true, planKey: 'coach_beta', maxActiveAthletes: 20, canProgram: true, canUseAnalytics: true, canUseIntegrations: true },
      grant: { source: 'beta', expiresAt: '2026-11-26T00:00:00Z' }, usage: { activeAthletes: 7, maxActiveAthletes: 20 },
    };
    fetchAccess.mockResolvedValue(access);
    await render();
    expect(container.querySelector('[data-testid="state"]')?.getAttribute('data-status')).toBe('resolved');
    expect(container.querySelector('[data-testid="state"]')?.getAttribute('data-active')).toBe('true');
    expect(container.querySelector('[data-testid="state"]')?.getAttribute('data-program')).toBe('true');
    expect(container.textContent).toBe('workspace-1');
  });

  it('accepts the normal athlete response with a null workspace', async () => {
    auth.current = { id: 'athlete-1', role: 'ATHLETE' };
    fetchAccess.mockResolvedValue({ workspace: null, membershipRole: null, entitlements: null, grant: null, usage: null });
    await render();
    expect(container.textContent).toBe('no-workspace');
    expect(container.querySelector('[data-testid="state"]')?.getAttribute('data-active')).toBe('null');
  });

  it('keeps access unknown when the request fails instead of declaring it inactive', async () => {
    fetchAccess.mockRejectedValue(new Error('offline'));
    await render();
    expect(container.querySelector('[data-testid="state"]')?.getAttribute('data-status')).toBe('error');
    expect(container.querySelector('[data-testid="state"]')?.getAttribute('data-active')).toBe('null');
    expect(container.querySelector('[data-testid="state"]')?.getAttribute('data-program')).toBe('null');
  });
});
