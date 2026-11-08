// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ForgotPasswordForm, PasswordResetView, passwordPolicyError } from './PasswordResetView';

const { resetPassword, forgotPassword, clearAuthorization } = vi.hoisted(() => ({
  resetPassword: vi.fn(), forgotPassword: vi.fn(), clearAuthorization: vi.fn(async () => undefined),
}));
vi.mock('../services/api', () => ({ apiService: { resetPassword, forgotPassword } }));
vi.mock('../services/authAuthorization', () => ({ clearAuthorization }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root; let node: HTMLDivElement;
beforeEach(() => {
  resetPassword.mockReset(); forgotPassword.mockReset(); clearAuthorization.mockClear();
  window.__passwordReset = { token: 'reset-token' };
  node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); delete window.__passwordReset; });

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit(form: HTMLFormElement | null) {
  await act(async () => { form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
}
const passwords = () => [...node.querySelectorAll<HTMLInputElement>('input[type="password"]')];

it('mirrors the server password policy', () => {
  expect(passwordPolicyError('short')).toMatch(/at least 8/);
  expect(passwordPolicyError('é'.repeat(37))).toMatch(/72 bytes/);
  expect(passwordPolicyError('long enough')).toBeNull();
});

it('resets the password, scrubs the token, clears offline authorization and offers sign-in', async () => {
  let resolve!: (value: unknown) => void;
  resetPassword.mockReturnValue(new Promise(r => { resolve = r; }));
  await act(async () => root.render(<PasswordResetView />));
  expect(node.textContent).toContain('Choose a new password');
  const [next, confirm] = passwords();
  await type(next, 'new password 1'); await type(confirm, 'new password 1');
  await submit(node.querySelector('form'));
  expect(node.textContent).toContain('Saving…');
  expect(node.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  await act(async () => resolve({ message: 'ok' }));
  expect(resetPassword).toHaveBeenCalledWith('reset-token', 'new password 1');
  expect(clearAuthorization).toHaveBeenCalled();
  expect(window.__passwordReset).toBeUndefined();
  expect(node.textContent).toContain('Password updated');
  expect(node.querySelector('a')?.getAttribute('href')).toBe('/');
});

it('validates locally before calling the API', async () => {
  await act(async () => root.render(<PasswordResetView />));
  const [next, confirm] = passwords();
  await type(next, 'short'); await type(confirm, 'short');
  await submit(node.querySelector('form'));
  expect(node.querySelector('[role="alert"]')?.textContent).toMatch(/at least 8/);
  await type(next, 'new password 1'); await type(confirm, 'new password 2');
  await submit(node.querySelector('form'));
  expect(node.querySelector('[role="alert"]')?.textContent).toMatch(/do not match/);
  expect(resetPassword).not.toHaveBeenCalled();
});

it('shows recovery with a new-link request when the token is rejected', async () => {
  resetPassword.mockRejectedValue(Object.assign(new Error('invalid'), { status: 400 }));
  await act(async () => root.render(<PasswordResetView />));
  const [next, confirm] = passwords();
  await type(next, 'new password 1'); await type(confirm, 'new password 1');
  await submit(node.querySelector('form'));
  expect(node.textContent).toContain('Link invalid or expired');
  expect(node.textContent).toContain('Send reset link');
});

it('keeps the form and shows the error for a non-token failure', async () => {
  resetPassword.mockRejectedValue(Object.assign(new Error('Password reset is temporarily unavailable'), { status: 503 }));
  await act(async () => root.render(<PasswordResetView />));
  const [next, confirm] = passwords();
  await type(next, 'new password 1'); await type(confirm, 'new password 1');
  await submit(node.querySelector('form'));
  expect(node.querySelector('[role="alert"]')?.textContent).toContain('temporarily unavailable');
  expect(passwords()).toHaveLength(2);
});

it('opens directly in recovery when there is no token', async () => {
  delete window.__passwordReset;
  await act(async () => root.render(<PasswordResetView />));
  expect(node.textContent).toContain('Link invalid or expired');
});

it('forgot form shows loading, then the same generic confirmation', async () => {
  let resolve!: (value: unknown) => void;
  forgotPassword.mockReturnValue(new Promise(r => { resolve = r; }));
  const onCancel = vi.fn();
  await act(async () => root.render(<ForgotPasswordForm initialEmail=" coach@example.com " onCancel={onCancel} />));
  await submit(node.querySelector('form'));
  expect(node.textContent).toContain('Sending…');
  await act(async () => resolve({ message: 'generic' }));
  expect(forgotPassword).toHaveBeenCalledWith('coach@example.com');
  expect(node.querySelector('[role="status"]')?.textContent).toContain('If an account exists for coach@example.com');
});

it('forgot form surfaces service errors', async () => {
  forgotPassword.mockRejectedValue(new Error('Password reset is temporarily unavailable'));
  await act(async () => root.render(<ForgotPasswordForm initialEmail="coach@example.com" />));
  await submit(node.querySelector('form'));
  expect(node.querySelector('[role="alert"]')?.textContent).toContain('temporarily unavailable');
});
