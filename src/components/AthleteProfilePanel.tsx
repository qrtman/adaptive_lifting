import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiService } from '../services/api';

export function AthleteProfilePanel() {
  const { user, signIn } = useAuth();
  const [displayName, setDisplayName] = useState(String(user?.displayName || ''));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setDisplayName(String(user?.displayName || ''));
  }, [user?.displayName]);

  if (String(user?.role || '').toUpperCase() !== 'ATHLETE') return null;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const profile = await apiService.updateProfile(displayName);
      signIn({ ...user, ...profile });
      setDisplayName(profile.displayName || '');
      setMessage('Athlete name saved. Linked coaches can see and search this name and your email.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save your athlete name.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mb-6 cal-nested-card" data-testid="athlete-profile-panel">
      <h2 className="text-sm font-semibold text-[var(--cal-ink)] mb-1">Athlete profile</h2>
      <p className="text-xs text-[var(--cal-muted)] mb-3">
        Add an optional name so your coach can recognize you. Your name and email are visible to linked coaches.
      </p>
      <form onSubmit={(event) => void save(event)} className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-medium text-[var(--cal-ink)]">
          Display name
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={80}
            autoComplete="name"
            className="h-11 rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)] bg-[var(--cal-canvas)] px-3 text-sm text-[var(--cal-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]"
            placeholder="Optional"
            data-testid="athlete-display-name"
          />
        </label>
        <button
          type="submit"
          disabled={saving || displayName.length > 80}
          className="h-11 rounded-[var(--cal-radius-md)] bg-[var(--cal-primary)] px-4 text-sm font-medium text-[var(--cal-on-primary)] hover:bg-[var(--cal-primary-active)] disabled:opacity-50"
          data-testid="save-athlete-display-name"
        >
          {saving ? 'Saving…' : 'Save name'}
        </button>
      </form>
      {message && <p role="status" className="mt-2 text-xs text-[var(--cal-success)]">{message}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-[var(--cal-error)]">{error}</p>}
    </section>
  );
}
