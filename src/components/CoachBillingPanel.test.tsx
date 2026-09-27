// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachBillingPanel } from './CoachBillingPanel';

const { state, api, navigation } = vi.hoisted(() => ({
  state: { current: null as any },
  api: {
    fetchBillingPlans: vi.fn(), createCheckoutSession: vi.fn(),
    createPortalSession: vi.fn(), fetchAccountAccess: vi.fn(),
  },
  navigation: vi.fn(),
}));
vi.mock('../contexts/AccessContext', () => ({ useAccountAccess: () => state.current }));
vi.mock('../services/api', () => ({ apiService: api }));
vi.mock('../services/billingNavigation', () => ({ openHostedBilling: navigation }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
const active = { workspace: { id: 'w1', name: 'Coach Coaching' }, membershipRole: 'OWNER',
  entitlements: { active: true, planKey: 'coach_beta' }, billingSubscription: null, canStartCheckout: true };

async function render() { await act(async () => { root.render(<CoachBillingPanel />); }); }

beforeEach(() => {
  window.history.replaceState(null, '', '/#/security');
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  state.current = { isCoach: true, status: 'resolved', access: active, refreshAccess: vi.fn().mockResolvedValue(undefined) };
  api.fetchBillingPlans.mockReset().mockResolvedValue([
    { planKey: 'coach_starter', name: 'Starter', unitAmount: 2900, currency: 'usd', interval: 'month', intervalCount: 1, maxActiveAthletes: 5 },
  ]);
  api.createCheckoutSession.mockReset().mockResolvedValue('https://checkout.stripe.com/c/pay/test');
  api.createPortalSession.mockReset().mockResolvedValue('https://billing.stripe.com/p/session/test');
  api.fetchAccountAccess.mockReset();
  navigation.mockReset();
});
afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); vi.useRealTimers(); });

describe('CoachBillingPanel', () => {
  it('renders server prices and starts a single owner checkout attempt', async () => {
    await render();
    expect(container.textContent).toContain('Starter');
    expect(container.textContent).toContain('$29.00 / month');
    expect(container.textContent).toContain('5 athletes');
    const button = [...container.querySelectorAll('button')].find(el => el.textContent?.includes('Choose Starter'))!;
    await act(async () => { button.click(); });
    expect(api.createCheckoutSession).toHaveBeenCalledOnce();
    expect(api.createCheckoutSession.mock.calls[0][0]).toBe('coach_starter');
    expect(api.createCheckoutSession.mock.calls[0][1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(navigation).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/test');
  });

  it('prevents double clicks while checkout is pending', async () => {
    api.createCheckoutSession.mockReturnValue(new Promise(() => {}));
    await render();
    const button = [...container.querySelectorAll('button')].find(el => el.textContent?.includes('Choose Starter'))!;
    await act(async () => { button.click(); button.click(); });
    expect(button.disabled).toBe(true);
    expect(api.createCheckoutSession).toHaveBeenCalledOnce();
  });

  it('reuses the request ID when a failed network request is retried', async () => {
    api.createCheckoutSession.mockRejectedValueOnce(new Error('Network unavailable'));
    await render();
    let button = [...container.querySelectorAll('button')].find(el => el.textContent?.includes('Choose Starter'))!;
    await act(async () => { button.click(); });
    expect(container.textContent).toContain('Network unavailable');
    button = [...container.querySelectorAll('button')].find(el => el.textContent?.includes('Choose Starter'))!;
    await act(async () => { button.click(); });
    expect(api.createCheckoutSession).toHaveBeenCalledTimes(2);
    expect(api.createCheckoutSession.mock.calls[1][1]).toBe(api.createCheckoutSession.mock.calls[0][1]);
  });

  it('explains when another plan already has an open checkout', async () => {
    api.createCheckoutSession.mockRejectedValueOnce({ code: 'BILLING_CHECKOUT_IN_PROGRESS' });
    await render();
    const button = [...container.querySelectorAll('button')].find(el => el.textContent?.includes('Choose Starter'))!;
    await act(async () => { button.click(); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('A checkout for another plan is already in progress');
    expect(navigation).not.toHaveBeenCalled();
  });

  it('shows existing paid subscription management and no new plan', async () => {
    state.current.access = { ...active, canStartCheckout: false,
      billingSubscription: { planKey: 'coach_pro', status: 'ACTIVE', currentPeriodEnd: '2026-11-26T00:00:00Z', cancelAtPeriodEnd: true } };
    await render();
    expect(container.textContent).toContain('Manage billing');
    expect(container.textContent).toContain('Cancels on');
    expect(container.textContent).not.toContain('Choose Starter');
    const manage = [...container.querySelectorAll('button')].find(el => el.textContent?.includes('Manage billing'))!;
    await act(async () => { manage.click(); });
    expect(navigation).toHaveBeenCalledWith('https://billing.stripe.com/p/session/test');
  });

  it('keeps billing mutations owner-only and hides billing for athletes', async () => {
    state.current.access = { ...active, membershipRole: 'STAFF' };
    await render();
    expect(container.textContent).toContain('Only the workspace owner');
    expect(api.fetchBillingPlans).not.toHaveBeenCalled();
    state.current.isCoach = false;
    await render();
    expect(container.textContent).toBe('');
  });

  it('refreshes paid access after checkout return without granting access itself', async () => {
    window.history.replaceState(null, '', '/?billing=success&session_id=cs_test#/security');
    api.fetchAccountAccess.mockResolvedValue({ ...active,
      billingSubscription: { planKey: 'coach_pro', status: 'ACTIVE' } });
    await render();
    expect(api.fetchAccountAccess).toHaveBeenCalled();
    expect(state.current.refreshAccess).toHaveBeenCalled();
    expect(container.textContent).toContain('Paid coaching access is now active');
    expect(container.textContent).not.toContain('Choose Starter');
    expect(window.location.search).toBe('');
  });

  it('shows a neutral state after bounded synchronization and handles cancellation', async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, '', '/?billing=success#/security');
    api.fetchAccountAccess.mockResolvedValue(active);
    await render();
    for (let i = 0; i < 5; i++) await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(api.fetchAccountAccess).toHaveBeenCalledTimes(6);
    expect(container.textContent).toContain('Access is still synchronizing');
    expect(container.textContent).not.toContain('Choose Starter');
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    vi.useRealTimers();
    window.history.replaceState(null, '', '/?billing=cancelled#/security');
    await render();
    expect(container.textContent).toContain('Checkout was cancelled');
  });

  it('refreshes after a portal return', async () => {
    window.history.replaceState(null, '', '/?billing=portal-return#/security');
    await render();
    expect(state.current.refreshAccess).toHaveBeenCalled();
    expect(window.location.search).toBe('');
  });
});
