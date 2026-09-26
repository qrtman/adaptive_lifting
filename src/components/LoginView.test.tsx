// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginView } from './LoginView';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { signIn, login, register } = vi.hoisted(() => ({
  signIn: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ signIn }) }));
vi.mock('../services/api', () => ({ apiService: { login, register, googleLogin: vi.fn(), developmentLogin: vi.fn() } }));

let root: Root;
let container: HTMLDivElement;

async function renderLogin() {
  await act(async () => { root.render(<LoginView />); });
}

async function enter(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit() {
  await act(async () => {
    container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

beforeEach(async () => {
  signIn.mockReset();
  login.mockReset();
  register.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await renderLogin();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('LoginView authentication modes', () => {
  it('creates an account and signs the returned user in', async () => {
    const user = { id: 'new-user', email: 'new@example.com', role: 'ATHLETE' };
    register.mockResolvedValue({ user });
    await act(async () => { container.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="false"]')?.click(); });
    const inputs = container.querySelectorAll('input');
    await enter(inputs[0], 'new@example.com');
    await enter(inputs[1], 'password123');
    await enter(inputs[2], 'password123');
    await submit();
    expect(register).toHaveBeenCalledWith('new@example.com', 'password123');
    expect(signIn).toHaveBeenCalledWith(user);
  });

  it('rejects mismatched passwords without calling registration', async () => {
    await act(async () => { container.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="false"]')?.click(); });
    const inputs = container.querySelectorAll('input');
    await enter(inputs[0], 'new@example.com');
    await enter(inputs[1], 'password123');
    await enter(inputs[2], 'different');
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Passwords do not match');
    expect(register).not.toHaveBeenCalled();
  });

  it('keeps normal sign-in working', async () => {
    const user = { id: 'existing-user', email: 'existing@example.com', role: 'ATHLETE' };
    login.mockResolvedValue({ user });
    const inputs = container.querySelectorAll('input');
    await enter(inputs[0], 'existing@example.com');
    await enter(inputs[1], 'password123');
    await submit();
    expect(login).toHaveBeenCalledWith('existing@example.com', 'password123');
    expect(signIn).toHaveBeenCalledWith(user);
  });
});
