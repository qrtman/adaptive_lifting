// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let resolveSession!: (value: any) => void;
let offlineUser: any = null;
vi.mock('../services/api', () => ({
  ApiRequestError: class ApiRequestError extends Error { status = 401; },
  apiService: {
    session: vi.fn(() => new Promise((resolve) => { resolveSession = resolve; })),
    logout: vi.fn(async () => undefined),
  },
}));
vi.mock('../services/authAuthorization', () => ({
  authorizationExpiresAt: () => Date.now() / 1000 + 3600,
  clearAuthorization: vi.fn(async () => undefined),
  rememberOfflineGrant: vi.fn(async () => undefined),
  restoreOfflineAuthorization: vi.fn(async () => offlineUser),
  setOnlineAuthorization: vi.fn(),
}));

const { AuthProvider, useAuth } = await import('./AuthContext');

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let node: HTMLDivElement;
function Probe() {
  const { user, checking } = useAuth();
  return <span>{checking ? 'checking' : user ? `user:${user.id}` : 'sign-in'}</span>;
}

beforeEach(() => {
  offlineUser = null;
  node = document.createElement('div');
  document.body.appendChild(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});

it('stays in "checking" (no sign-in form) until the session check answers', async () => {
  await act(async () => root.render(<AuthProvider><Probe /></AuthProvider>));
  expect(node.textContent).toBe('checking');
  await act(async () => resolveSession({ user: { id: 'u1', role: 'ATHLETE' }, sessionExpiresAt: new Date(Date.now() + 3600e3).toISOString(), scopes: ['u1'] }));
  expect(node.textContent).toBe('user:u1');
});

it('opens straight into the app with a valid offline grant while the check runs', async () => {
  offlineUser = { id: 'u1', role: 'ATHLETE' };
  await act(async () => root.render(<AuthProvider><Probe /></AuthProvider>));
  expect(node.textContent).toBe('user:u1');
});
