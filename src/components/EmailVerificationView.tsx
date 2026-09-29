import { useState } from 'react';
import { apiService } from '../services/api';

declare global { interface Window { __emailVerification?: { token: string } } }

export function EmailVerificationView() {
  const [token] = useState(() => window.__emailVerification?.token || '');
  const [state, setState] = useState<'confirm' | 'loading' | 'success' | 'error'>(token ? 'confirm' : 'error');
  const [error, setError] = useState('This verification link is invalid or expired. Request a new email.');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  return <div className="min-h-screen flex items-center justify-center bg-[var(--cal-canvas)] p-4">
    <div className="w-full max-w-md cal-nested-card p-6 flex flex-col gap-4" data-elevated="true">
      <h1 className="text-xl font-semibold">{state === 'success' ? 'Email verified' : state === 'error' ? 'Link invalid or expired' : 'Verify your email'}</h1>
      {state === 'confirm' || state === 'loading' ? <>
        <p>Confirm your email address for Adaptive Lifting. You can sign in after verification.</p>
        <button className="min-h-12 bg-[var(--cal-primary)] hover:bg-[var(--cal-primary-active)] text-[var(--cal-on-primary)] rounded-[var(--cal-radius-md)] disabled:opacity-50" disabled={state === 'loading'} onClick={async () => {
          setState('loading');
          try { await apiService.verifyEmail(token); delete window.__emailVerification; setState('success'); }
          catch (err: any) { setError(err.message); setState('error'); }
        }}>{state === 'loading' ? 'Verifying…' : 'Confirm email address'}</button>
      </> : state === 'success' ? <p>Your email is verified. Sign in with your email and password.</p> : <>
        <p role="alert">{error}</p>
        <label>Email address<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full min-h-12 bg-[var(--cal-canvas)] text-[var(--cal-ink)] border border-[var(--cal-hairline)] rounded-[var(--cal-radius-md)] px-3" /></label>
        <button className="min-h-12 bg-[var(--cal-primary)] hover:bg-[var(--cal-primary-active)] text-[var(--cal-on-primary)] rounded-[var(--cal-radius-md)] disabled:opacity-50" disabled={sent || !email} onClick={async () => {
          try { await apiService.resendVerification(email); setSent(true); }
          catch (err: any) { setError(err.message); }
        }}>Request a new verification email</button>
        {sent && <p role="status">If eligible, a new email will arrive shortly. Please wait 60 seconds before trying again.</p>}
      </>}
      <a href="/" className="min-h-12 flex items-center justify-center">Return to sign in</a>
    </div>
  </div>;
}
