// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../services/api';
import { LoginView } from './LoginView';
import { SUPPORT_EMAIL } from '../config/support';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { signIn, login, register, forgotPassword } = vi.hoisted(() => ({
  signIn: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  forgotPassword: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ signIn }) }));
vi.mock('../services/api', async (original) => ({ ...await original<typeof import('../services/api')>(), apiService: { login, register, forgotPassword, googleLogin: vi.fn(), developmentLogin: vi.fn() } }));

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
  forgotPassword.mockReset();
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
  it('links to the privacy policy, terms, and support', () => {
    const hrefs = Array.from(container.querySelectorAll('nav[aria-label="Legal and support"] a')).map(a => a.getAttribute('href'));
    expect(hrefs).toEqual(['/privacy.html', '/terms.html', `mailto:${SUPPORT_EMAIL}`]);
  });

  it('offers Forgot password? on sign-in and returns to sign-in after requesting a link', async () => {
    forgotPassword.mockResolvedValue({ message: 'generic' });
    await enter(container.querySelector<HTMLInputElement>('input[type="email"]')!, 'coach@example.com');
    const link = [...container.querySelectorAll('button')].find(button => button.textContent === 'Forgot password?');
    expect(link).toBeTruthy();
    await act(async () => { link!.click(); });
    expect(container.textContent).toContain('Reset your password');
    expect(container.querySelector<HTMLInputElement>('input[type="email"]')?.value).toBe('coach@example.com');
    await submit();
    expect(forgotPassword).toHaveBeenCalledWith('coach@example.com');
    expect(login).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('If an account exists');
    const back = [...container.querySelectorAll('button')].find(button => button.textContent === 'Return to sign in');
    await act(async () => { back!.click(); });
    expect(container.querySelector('[data-testid="login-card"]')).not.toBeNull();
  });

  it('hides Forgot password? while creating an account', async () => {
    await act(async () => { container.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="false"]')?.click(); });
    expect([...container.querySelectorAll('button')].some(button => button.textContent === 'Forgot password?')).toBe(false);
  });

  it('creates a pending account without signing in', async () => {
    const user = { id: 'new-user', email: 'new@example.com', role: 'ATHLETE' };
    register.mockResolvedValue({ user });
    await act(async () => { container.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="false"]')?.click(); });
    const inputs = container.querySelectorAll('input');
    await enter(inputs[0], 'new@example.com');
    await enter(inputs[1], 'password123');
    await enter(inputs[2], 'password123');
    await submit();
    expect(register).toHaveBeenCalledWith('new@example.com', 'password123');
    expect(signIn).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Check your email");
    expect(container.textContent).toContain("Resend in 60s");
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

  it('clearly fails closed when production email verification is not configured', async () => {
    register.mockRejectedValue(new ApiRequestError('Email verification is temporarily unavailable', 503));
    await act(async () => { container.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="false"]')?.click(); });
    const inputs = container.querySelectorAll('input');
    await enter(inputs[0], 'new@example.com');
    await enter(inputs[1], 'password123');
    await enter(inputs[2], 'password123');
    await submit();
    expect(register).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'New account registration is not ready because verification email delivery is not configured.',
    );
    expect(signIn).not.toHaveBeenCalled();
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

it('offers resend when valid credentials require verification', async () => {
  login.mockRejectedValue(new ApiRequestError('Verify your email before signing in.', 403, 'EMAIL_VERIFICATION_REQUIRED'));
  await enter(container.querySelectorAll('input')[0], 'pending@example.com');
  await enter(container.querySelectorAll('input')[1], 'password123');
  await submit();
  expect(container.textContent).toContain('Check your email');
  expect(container.textContent).toContain('Resend verification email');
  expect(signIn).not.toHaveBeenCalled();
});
