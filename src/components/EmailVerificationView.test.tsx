// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmailVerificationView } from './EmailVerificationView';
const { verifyEmail, resendVerification } = vi.hoisted(() => ({ verifyEmail: vi.fn(), resendVerification: vi.fn() }));
vi.mock('../services/api', () => ({ apiService: { verifyEmail, resendVerification } }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let node: HTMLDivElement;
beforeEach(() => {
  verifyEmail.mockReset(); resendVerification.mockReset(); window.__emailVerification = { token: 'secret-token' };
  node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); delete window.__emailVerification; });
const render = async () => { await act(async () => root.render(<EmailVerificationView />)); };

it('requires explicit confirmation before POST and offers sign-in afterward', async () => {
  verifyEmail.mockResolvedValue({ message: 'verified' });
  await render(); expect(verifyEmail).not.toHaveBeenCalled();
  await act(async () => node.querySelector('button')?.click());
  expect(verifyEmail).toHaveBeenCalledWith('secret-token');
  expect(node.textContent).toContain('Email verified');
  expect(window.__emailVerification).toBeUndefined();
  expect(node.querySelector('a')?.getAttribute('href')).toBe('/');
});

it('provides recovery for expired links', async () => {
  verifyEmail.mockRejectedValue(new Error('Expired verification link.'));
  await render(); await act(async () => node.querySelector('button')?.click());
  expect(node.textContent).toContain('Link invalid or expired');
  expect(node.textContent).toContain('Request a new verification email');
});
