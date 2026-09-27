// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachAccessStatus } from './CoachAccessStatus';

const { state } = vi.hoisted(() => ({ state: { current: null as any } }));
vi.mock('../contexts/AccessContext', () => ({ useAccountAccess: () => state.current }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

async function render() { await act(async () => { root.render(<CoachAccessStatus />); }); }

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('CoachAccessStatus', () => {
  it('shows active beta access and roster usage', async () => {
    state.current = {
      isCoach: true, status: 'resolved', error: null, refreshAccess: vi.fn(),
      access: {
        workspace: { id: 'w1', name: 'Coach Coaching' }, membershipRole: 'OWNER',
        entitlements: { active: true, planKey: 'coach_beta', maxActiveAthletes: 20, canProgram: true, canUseAnalytics: true, canUseIntegrations: true },
        grant: { source: 'beta', startsAt: '2026-01-01T00:00:00Z', expiresAt: '2026-11-26T00:00:00Z' },
        usage: { activeAthletes: 7, maxActiveAthletes: 20 },
      },
    };
    await render();
    expect(container.textContent).toContain('Beta access');
    expect(container.textContent).toContain('Coach Beta');
    expect(container.textContent).toContain('7 / 20 athletes');
    expect(container.textContent).toContain('Access until:');
  });

  it('shows unlimited founder access without inventing an expiry', async () => {
    state.current = {
      isCoach: true, status: 'resolved', error: null, refreshAccess: vi.fn(),
      access: {
        workspace: { id: 'w1', name: 'Founder Coaching' }, membershipRole: 'OWNER',
        entitlements: { active: true, planKey: 'coach_unlimited', maxActiveAthletes: null, canProgram: true, canUseAnalytics: true, canUseIntegrations: true },
        grant: { source: 'manual', startsAt: '2026-01-01T00:00:00Z', expiresAt: null },
        usage: { activeAthletes: 31, maxActiveAthletes: null },
      },
    };
    await render();
    expect(container.textContent).toContain('31 athletes · Unlimited');
    expect(container.textContent).toContain('Access has no scheduled expiry.');
    expect(container.textContent).not.toContain('Access until:');
  });

  it('shows normalized paid access without requiring provider details', async () => {
    state.current = {
      isCoach: true, status: 'resolved', error: null, refreshAccess: vi.fn(), access: {
        workspace: { id: 'w1', name: 'Coach Coaching' }, membershipRole: 'OWNER',
        entitlements: { active: true, planKey: 'coach_pro', maxActiveAthletes: 25, canProgram: true, canUseAnalytics: true, canUseIntegrations: true },
        grant: null,
        accessSource: { type: 'subscription', status: 'ACTIVE', currentPeriodEnd: '2026-10-27T00:00:00Z', cancelAtPeriodEnd: true },
        usage: { activeAthletes: 7, maxActiveAthletes: 25 },
      },
    };
    await render();
    expect(container.textContent).toContain('Coach Pro');
    expect(container.textContent).toContain('Status: Active');
    expect(container.textContent).toContain('Access until:');
    expect(container.textContent).not.toContain('provider');
  });

  it('labels effective voucher access as prepaid rather than a subscription', async () => {
    state.current = {
      isCoach: true, status: 'resolved', error: null, refreshAccess: vi.fn(), access: {
        workspace: { id: 'w1', name: 'Coach Coaching' }, membershipRole: 'OWNER',
        entitlements: { active: true, planKey: 'coach_pro', maxActiveAthletes: 25, canProgram: true, canUseAnalytics: true, canUseIntegrations: true },
        grant: { source: 'offline_payment', startsAt: '2026-09-28T00:00:00Z', expiresAt: '2026-12-27T00:00:00Z' },
        accessSource: { type: 'grant', status: 'ACTIVE', expiresAt: '2026-12-27T00:00:00Z' },
        usage: { activeAthletes: 3, maxActiveAthletes: 25 },
      },
    };
    await render();
    expect(container.textContent).toContain('Prepaid coaching access');
    expect(container.textContent).toContain('Coach Pro');
    expect(container.textContent).toContain('Access until:');
    expect(container.textContent).not.toContain('Stripe');
  });

  it('explains inactive access without replacing read-only coach access', async () => {
    state.current = { isCoach: true, status: 'resolved', error: null, refreshAccess: vi.fn(), access: {
      workspace: { id: 'w1', name: 'Coach Coaching' }, membershipRole: 'OWNER', entitlements: {
        active: false, planKey: null, maxActiveAthletes: null, canProgram: false, canUseAnalytics: false, canUseIntegrations: false,
      }, grant: null, usage: { activeAthletes: 3, maxActiveAthletes: null },
    } };
    await render();
    expect(container.textContent).toContain('Coaching access inactive');
    expect(container.textContent).toContain('You can still view your account and existing athletes');
  });

  it('does not show SaaS notices to athletes and does not treat a fetch error as inactive', async () => {
    state.current = { isCoach: false, status: 'resolved', error: null, refreshAccess: vi.fn(), access: {
      workspace: null, membershipRole: null, entitlements: null, grant: null, usage: null,
    } };
    await render();
    expect(container.textContent).toBe('');

    state.current = { isCoach: true, status: 'error', error: 'offline', refreshAccess: vi.fn(), access: null };
    await render();
    expect(container.textContent).toContain('Access status unavailable');
    expect(container.textContent).not.toContain('Coaching access inactive');
  });
});
