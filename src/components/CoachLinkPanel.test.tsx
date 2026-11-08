// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachLinkPanel } from './CoachLinkPanel';

const { auth, api } = vi.hoisted(() => ({
  auth: { user: null as { role: string } | null },
  api: { getCoachCodeStatus: vi.fn(), createCoachCode: vi.fn(), linkAthlete: vi.fn(), unlinkCoach: vi.fn() },
}));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../contexts/AccessContext', () => ({ useAccountAccess: () => ({ canProgram: true, athleteLimitReached: false }) }));
vi.mock('../services/api', () => ({ apiService: api, ApiRequestError: class ApiRequestError extends Error {} }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

async function render() { await act(async () => { root.render(<CoachLinkPanel />); }); }
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
async function click(id: string) { await act(async () => { byId(id)!.click(); }); }
async function type(id: string, value: string) {
  const input = byId(id) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  Object.values(api).forEach((fn) => fn.mockReset());
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
});

describe('CoachLinkPanel', () => {
  it('shows the grouped coach code with its 15-minute single-use expiry, then retires it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-11-08T12:00:00Z'));
    auth.user = { role: 'COACH' };
    api.getCoachCodeStatus.mockResolvedValue({ active: false, code: null });
    api.createCoachCode.mockResolvedValue({ code: 'ABCDE-FGHJK', expires_at: '2026-11-08T12:15:00.000000' });
    await render();
    expect(byId('coach-code-empty')).not.toBeNull();
    await click('coach-code-generate');
    expect(byId('coach-code-value')!.textContent).toBe('ABCDE-FGHJK');
    expect(byId('coach-code-expiry')!.textContent).toMatch(/Expires at .+\. Single use\./);
    expect(byId('coach-code-success')!.textContent).toContain('15 minutes');
    expect(container.textContent).toContain('expires 15 minutes after you generate it');

    await act(async () => { vi.advanceTimersByTime(15 * 60 * 1000 + 1); });
    expect(byId('coach-code-value')).toBeNull();
    expect(byId('coach-code-expired')).not.toBeNull();
    expect(byId('coach-code-generate')!.textContent).toBe('Generate code');
  });

  it('links with generic success copy and never echoes server identity details', async () => {
    auth.user = { role: 'ATHLETE' };
    api.linkAthlete.mockResolvedValue({ status: 'success', message: 'Successfully linked to coach coach@example.test' });
    await render();
    expect((byId('athlete-link-input') as HTMLInputElement).placeholder).toBe('XXXXX-XXXXX');
    await type('athlete-link-input', 'abcde-fghjk');
    await click('athlete-link-submit');
    expect(api.linkAthlete).toHaveBeenCalledWith('ABCDE-FGHJK');
    expect(byId('athlete-link-success')!.textContent).toBe('Linked to your coach.');
    expect(container.textContent).not.toContain('@');
  });

  it('shows one recovery message for an invalid, expired, or rate-limited code', async () => {
    auth.user = { role: 'ATHLETE' };
    api.linkAthlete.mockRejectedValue(new Error('Invalid or expired code'));
    await render();
    await type('athlete-link-input', 'ZZZZZ-ZZZZZ');
    await click('athlete-link-submit');
    expect(byId('athlete-link-error')!.textContent).toBe('Invalid or expired code. Ask your coach for a new one.');
  });
});
