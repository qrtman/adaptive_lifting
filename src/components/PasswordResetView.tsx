import React, { useState } from 'react';
import { apiService } from '../services/api';
import { clearAuthorization } from '../services/authAuthorization';

declare global { interface Window { __passwordReset?: { token: string } } }

const inputClass = 'w-full min-h-12 bg-[var(--cal-canvas)] text-[var(--cal-ink)] border border-[var(--cal-hairline)] rounded-[var(--cal-radius-md)] px-3 focus:outline-none focus:border-[var(--cal-accent)] focus:ring-1 focus:ring-[var(--cal-accent)]';
const primaryClass = 'min-h-12 bg-[var(--cal-primary)] hover:bg-[var(--cal-primary-active)] text-[var(--cal-on-primary)] rounded-[var(--cal-radius-md)] disabled:opacity-50';
const alertClass = 'border border-[color-mix(in_srgb,var(--cal-error)_40%,transparent)] bg-[color-mix(in_srgb,var(--cal-error)_10%,transparent)] text-[var(--cal-error)] text-sm p-3 rounded-[var(--cal-radius-md)]';

/** Mirrors the server policy: 8+ characters, at most 72 UTF-8 bytes. */
export function passwordPolicyError(password: string): string | null {
  if (Array.from(password).length < 8) return 'Use at least 8 characters.';
  if (new TextEncoder().encode(password).length > 72) return 'Use at most 72 bytes (shorter, or fewer special characters).';
  return null;
}

/** Request a reset link. The reply never reveals whether the account exists. */
export function ForgotPasswordForm({ initialEmail = '', onCancel }: { initialEmail?: string; onCancel?: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [state, setState] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState('loading'); setError('');
    try { await apiService.forgotPassword(email.trim()); setState('sent'); }
    catch (err: any) { setError(err?.message || 'Password reset is temporarily unavailable. Try again later.'); setState('error'); }
  };
  if (state === 'sent') return <div className="flex flex-col gap-3">
    <p role="status">If an account exists for {email.trim()}, a password reset link will arrive shortly. The link expires in 30 minutes. Check your spam folder too.</p>
    {onCancel && <button type="button" className="min-h-12" onClick={onCancel}>Return to sign in</button>}
  </div>;
  return <form onSubmit={submit} className="flex flex-col gap-3" aria-label="Request a password reset link">
    <p className="text-sm text-[var(--cal-muted)]">Enter your account email. We will send a single-use link to choose a new password.</p>
    {state === 'error' && <p role="alert" className={alertClass}>{error}</p>}
    <label className="flex flex-col gap-1 text-xs text-[var(--cal-muted)]">Email
      <input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} className={inputClass} />
    </label>
    <button type="submit" className={primaryClass} disabled={state === 'loading' || !email.trim()}>
      {state === 'loading' ? 'Sending…' : 'Send reset link'}
    </button>
    {onCancel && <button type="button" className="min-h-12" onClick={onCancel}>Return to sign in</button>}
  </form>;
}

export function PasswordResetView() {
  const [token] = useState(() => window.__passwordReset?.token || '');
  const [state, setState] = useState<'form' | 'loading' | 'success' | 'invalid'>(token ? 'form' : 'invalid');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const policy = passwordPolicyError(password);
    if (policy) { setError(policy); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setState('loading'); setError('');
    try {
      await apiService.resetPassword(token, password);
      delete window.__passwordReset;
      setPassword(''); setConfirm('');
      // Every session was revoked server-side; drop this browser's offline lease too.
      await clearAuthorization();
      setState('success');
    } catch (err: any) {
      if (err?.status === 400) { delete window.__passwordReset; setState('invalid'); return; }
      setError(err?.message || 'Password could not be reset. Try again.');
      setState('form');
    }
  };
  const title = state === 'success' ? 'Password updated' : state === 'invalid' ? 'Link invalid or expired' : 'Choose a new password';
  return <div className="min-h-screen flex items-center justify-center bg-[var(--cal-canvas)] p-4">
    <div className="w-full max-w-md cal-nested-card p-6 flex flex-col gap-4" data-elevated="true">
      <h1 className="text-xl font-semibold">{title}</h1>
      {state === 'form' || state === 'loading' ? <form onSubmit={submit} className="flex flex-col gap-3" aria-label="Choose a new password">
        <p className="text-sm text-[var(--cal-muted)]">Saving signs you out on every device, including offline access. Sign in again afterward.</p>
        {error && <p role="alert" className={alertClass}>{error}</p>}
        <label className="flex flex-col gap-1 text-xs text-[var(--cal-muted)]">New password
          <input type="password" autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--cal-muted)]">Confirm new password
          <input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} className={inputClass} />
        </label>
        <button type="submit" className={primaryClass} disabled={state === 'loading'}>
          {state === 'loading' ? 'Saving…' : 'Save new password'}
        </button>
      </form> : state === 'success' ? <p role="status">Your password was changed and every device was signed out. Sign in with your new password.</p> : <>
        <p role="alert">This password reset link is invalid, expired or already used. Links work once and expire 30 minutes after the request.</p>
        <ForgotPasswordForm />
      </>}
      <a href="/" className="min-h-12 flex items-center justify-center">{state === 'success' ? 'Sign in' : 'Return to sign in'}</a>
    </div>
  </div>;
}
