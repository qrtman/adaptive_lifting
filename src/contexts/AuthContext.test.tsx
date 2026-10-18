// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';
import { ApiRequestError } from '../services/api';

const { session, clearSnapshot, snapshots } = vi.hoisted(() => ({ session: vi.fn(), clearSnapshot: vi.fn(), snapshots: new Map() }));
vi.mock('../services/api', async original => ({ ...await original<typeof import('../services/api')>(), apiService: { session, logout: vi.fn() } }));
vi.mock('../services/db', () => ({ clearSnapshot, getSnapshot: vi.fn(async key => snapshots.get(key)), saveSnapshot: vi.fn(), microcycleSnapshotKey: (id: string) => `microcycles:${id}` }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let node: HTMLDivElement;
let auth: ReturnType<typeof useAuth>;
function Probe() { auth = useAuth(); return <span>{auth.user?.id || 'signed-out'}</span>; }
const render = async () => { await act(async () => root.render(<AuthProvider><Probe /></AuthProvider>)); };
beforeEach(() => {
  session.mockReset(); clearSnapshot.mockReset().mockResolvedValue(undefined); snapshots.clear(); localStorage.clear();
  node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });

it('never trusts profile fields or unsigned cached profiles during offline boot', async () => {
  localStorage.setItem('al_role', 'ATHLETE'); localStorage.setItem('al_user_id', 'pending');
  snapshots.set('auth:offline-grant', JSON.stringify({ user: { id: 'pending', role: 'ATHLETE' } }));
  session.mockRejectedValue(new TypeError('offline'));
  await render();
  expect(node.textContent).toBe('signed-out');
});

it('restores only a backend-authorized session and preserves training on denial', async () => {
  session.mockResolvedValue({ user: { id: 'verified', role: 'ATHLETE' }, sessionExpiresAt: new Date(Date.now() + 60000).toISOString() });
  await render();
  expect(node.textContent).toBe('verified');
  await act(async () => window.dispatchEvent(new Event('auth-access-denied')));
  expect(node.textContent).toBe('signed-out');
  expect(clearSnapshot.mock.calls.every(([key]) => key === 'auth:offline-grant')).toBe(true);
});

it('profile objects cannot independently sign in an unverified account', async () => {
  session.mockRejectedValue(new ApiRequestError('Verify your email.', 403, 'EMAIL_VERIFICATION_REQUIRED'));
  await render();
  await expect(auth.signIn({ id: 'pending', role: 'ATHLETE' })).rejects.toThrow('Verify your email.');
  expect(node.textContent).toBe('signed-out');
});
