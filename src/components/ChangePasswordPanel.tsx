import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { apiService } from '../services/api';
import { clearAuthorization } from '../services/authAuthorization';
import { useAuth } from '../contexts/AuthContext';
import { passwordPolicyError } from './PasswordResetView';

const inputClass = 'w-full min-h-10 bg-[var(--cal-canvas)] text-[var(--cal-ink)] border border-[var(--cal-hairline)] rounded-[var(--cal-radius-md)] px-3 text-sm focus:outline-none focus:border-[var(--cal-accent)] focus:ring-1 focus:ring-[var(--cal-accent)]';

/**
 * Changing the password revokes every session for the account, including this
 * one, so success ends with an explicit sign-in-again step.
 */
export function ChangePasswordPanel() {
  const { signOut } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'success'>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const policy = passwordPolicyError(next);
    if (policy) { setError(policy); return; }
    if (next !== confirm) { setError('New passwords do not match.'); return; }
    if (next === current) { setError('Choose a password different from your current one.'); return; }
    setState('loading'); setError(null);
    try {
      await apiService.changePassword(current, next);
      setCurrent(''); setNext(''); setConfirm('');
      await clearAuthorization();
      setState('success');
    } catch (err: any) {
      setError(err?.message || 'Password could not be changed.');
      setState('idle');
    }
  };

  return (
    <section className="mb-6 cal-nested-card" aria-labelledby="change-password-heading">
      <h2 id="change-password-heading" className="text-sm font-medium text-[var(--cal-ink)] flex items-center gap-2">
        <KeyRound size={14} className="text-[var(--cal-accent)]" />
        Password
      </h2>
      {state === 'success' ? (
        <div className="mt-3 flex flex-col gap-3">
          <p role="status" className="text-sm text-[var(--cal-success)]">
            Password changed. Every device, including this one, was signed out. Sign in again with your new password.
          </p>
          <button type="button" onClick={signOut} className="self-start min-h-10 px-4 bg-[var(--cal-primary)] hover:bg-[var(--cal-primary-active)] text-[var(--cal-on-primary)] text-sm rounded-[var(--cal-radius-md)]">
            Sign in again
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-3 flex flex-col gap-3 max-w-md" aria-label="Change password">
          <p className="text-xs text-[var(--cal-muted)]">
            Changing your password signs you out on every device, including offline access. Signed up with Google? Use “Forgot password?” on the sign-in screen to set one.
          </p>
          {error && (
            <p role="alert" className="text-sm text-[var(--cal-error)] border border-[color-mix(in_srgb,var(--cal-error)_30%,transparent)] bg-[color-mix(in_srgb,var(--cal-error)_10%,transparent)] p-2 rounded-[var(--cal-radius-md)]">
              {error}
            </p>
          )}
          <label className="flex flex-col gap-1 text-xs text-[var(--cal-muted)]">Current password
            <input type="password" autoComplete="current-password" required value={current} onChange={e => setCurrent(e.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--cal-muted)]">New password
            <input type="password" autoComplete="new-password" required value={next} onChange={e => setNext(e.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--cal-muted)]">Confirm new password
            <input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} className={inputClass} />
          </label>
          <button type="submit" disabled={state === 'loading'} className="self-start min-h-10 px-4 bg-[var(--cal-primary)] hover:bg-[var(--cal-primary-active)] text-[var(--cal-on-primary)] text-sm rounded-[var(--cal-radius-md)] disabled:opacity-50">
            {state === 'loading' ? 'Changing password…' : 'Change password'}
          </button>
        </form>
      )}
    </section>
  );
}
