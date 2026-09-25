import React, { useEffect, useRef, useState } from 'react';
import { Lock, Mail } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiService } from '../services/api';

const fieldClass =
  'w-full min-h-12 bg-[var(--cal-canvas)] border border-[var(--cal-hairline)] rounded-[var(--cal-radius-md)] py-3 pl-10 pr-3 text-[var(--cal-ink)] placeholder:text-[var(--cal-muted-soft)] focus:outline-none focus:border-[var(--cal-accent)] focus:ring-1 focus:ring-[var(--cal-accent)]';

export const LoginView = () => {
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const googleButton = useRef<HTMLDivElement>(null);
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStandardLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await apiService.login(email, password);
      signIn(data.user);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async (token: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiService.googleLogin(token, 'COACH');
      signIn(data.user);
    } catch (err: any) {
      setError(err.message || 'Google login failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!googleClientId) return;
    type GoogleIdentity = {
      accounts: { id: {
        initialize: (options: { client_id: string; callback: (result: { credential: string }) => void }) => void;
        renderButton: (element: HTMLElement, options: { theme: string; size: string; width: number }) => void;
      } };
    };
    const browser = window as Window & { google?: GoogleIdentity };
    const renderButton = () => {
      if (!browser.google || !googleButton.current) return;
      browser.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: result => void handleGoogleLogin(result.credential),
      });
      googleButton.current.replaceChildren();
      browser.google.accounts.id.renderButton(googleButton.current, { theme: 'outline', size: 'large', width: 320 });
    };
    if (browser.google) {
      renderButton();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = renderButton;
    script.onerror = () => setError('Google sign-in could not load');
    document.head.appendChild(script);
    return () => { script.onload = null; script.onerror = null; };
  }, [googleClientId]);

  const handleDevelopmentLogin = async (role: 'COACH' | 'ATHLETE') => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiService.developmentLogin(role);
      signIn(data.user);
    } catch (err: any) {
      setError(err.message || 'Development login failed');
    } finally {
      setLoading(false);
    }
  };

  const showDevelopmentLogin = Boolean((import.meta as any).env.DEV);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--cal-canvas)] p-4">
      <div
        className="w-full max-w-md cal-nested-card p-6 flex flex-col gap-6"
        data-elevated="true"
        data-testid="login-card"
      >
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--cal-ink)]">Adaptive Lifting</h1>
          <p className="text-sm text-[var(--cal-muted)] mt-1">Sign in</p>
        </div>

        {error && (
          <div role="alert" className="border border-[color-mix(in_srgb,var(--cal-error)_40%,transparent)] bg-[color-mix(in_srgb,var(--cal-error)_10%,transparent)] text-[var(--cal-error)] text-sm p-3 rounded-[var(--cal-radius-md)]">
            {error}
          </div>
        )}

        <form onSubmit={handleStandardLogin} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-[var(--cal-muted)]">
            Email
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--cal-muted)]" size={16} />
              <input
                type="email"
                autoComplete="username"
                placeholder="coach@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className={fieldClass}
                required
              />
            </div>
          </label>

          <label className="flex flex-col gap-1 text-xs text-[var(--cal-muted)]">
            Password
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--cal-muted)]" size={16} />
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className={fieldClass}
                required
              />
            </div>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-12 bg-[var(--cal-primary)] hover:bg-[var(--cal-primary-active)] text-[var(--cal-on-primary)] rounded-[var(--cal-radius-md)] disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {googleClientId && <div ref={googleButton} aria-label="Continue with Google" />}

        {showDevelopmentLogin && (
          <div className="border-t border-[var(--cal-hairline)] pt-3">
            <p className="mb-2 text-xs text-[var(--cal-muted)]">Local development</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleDevelopmentLogin('COACH')}
                disabled={loading}
                className="min-h-10 border border-[var(--cal-hairline)] bg-[var(--cal-surface-soft)] text-sm text-[var(--cal-ink)] rounded-[var(--cal-radius-md)] disabled:opacity-50"
              >
                Open as coach
              </button>
              <button
                type="button"
                onClick={() => handleDevelopmentLogin('ATHLETE')}
                disabled={loading}
                className="min-h-10 border border-[var(--cal-hairline)] bg-[var(--cal-surface-soft)] text-sm text-[var(--cal-ink)] rounded-[var(--cal-radius-md)] disabled:opacity-50"
              >
                Open as athlete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
