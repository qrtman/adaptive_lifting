// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChangePasswordPanel } from './ChangePasswordPanel';

const { changePassword, clearAuthorization, signOut } = vi.hoisted(() => ({
  changePassword: vi.fn(), clearAuthorization: vi.fn(async () => undefined), signOut: vi.fn(),
}));
vi.mock('../services/api', () => ({ apiService: { changePassword } }));
vi.mock('../services/authAuthorization', () => ({ clearAuthorization }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ signOut }) }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root; let node: HTMLDivElement;
beforeEach(async () => {
  changePassword.mockReset(); clearAuthorization.mockClear(); signOut.mockReset();
  node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node);
  await act(async () => root.render(<ChangePasswordPanel />));
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });

async function fill(current: string, next: string, confirm = next) {
  const inputs = [...node.querySelectorAll<HTMLInputElement>('input[type="password"]')];
  for (const [input, value] of [[inputs[0], current], [inputs[1], next], [inputs[2], confirm]] as const) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  await act(async () => { node.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
}

it('changes the password, clears offline authorization, and asks to sign in again', async () => {
  let resolve!: (value: unknown) => void;
  changePassword.mockReturnValue(new Promise(r => { resolve = r; }));
  await fill('old password', 'new password 1');
  expect(node.textContent).toContain('Changing password…');
  await act(async () => resolve({ message: 'ok', sessionsRevoked: 2 }));
  expect(changePassword).toHaveBeenCalledWith('old password', 'new password 1');
  expect(clearAuthorization).toHaveBeenCalled();
  expect(node.querySelector('[role="status"]')?.textContent).toContain('Every device, including this one, was signed out');
  await act(async () => node.querySelector<HTMLButtonElement>('button')?.click());
  expect(signOut).toHaveBeenCalled();
});

it('shows a wrong current password without signing out', async () => {
  changePassword.mockRejectedValue(Object.assign(new Error('Current password is incorrect.'), { status: 400 }));
  await fill('wrong password', 'new password 1');
  expect(node.querySelector('[role="alert"]')?.textContent).toContain('Current password is incorrect.');
  expect(signOut).not.toHaveBeenCalled();
  expect(clearAuthorization).not.toHaveBeenCalled();
  expect(node.querySelector('form')).not.toBeNull();
});

it('validates policy, confirmation and reuse locally', async () => {
  await fill('old password', 'short');
  expect(node.querySelector('[role="alert"]')?.textContent).toMatch(/at least 8/);
  await fill('old password', 'new password 1', 'new password 2');
  expect(node.querySelector('[role="alert"]')?.textContent).toMatch(/do not match/);
  await fill('same password', 'same password');
  expect(node.querySelector('[role="alert"]')?.textContent).toMatch(/different/);
  expect(changePassword).not.toHaveBeenCalled();
});
