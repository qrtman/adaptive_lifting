import { RefreshCw, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useAccountAccess } from '../contexts/AccessContext';
import { formatAthleteUsage } from '../services/accessUi';

const PLAN_LABELS: Record<string, string> = {
  coach_beta: 'Coach Beta',
  coach_starter: 'Coach Starter',
  coach_pro: 'Coach Pro',
  coach_unlimited: 'Coach Unlimited',
};

function readableDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function CoachAccessStatus() {
  const { isCoach, access, status, error, refreshAccess } = useAccountAccess();
  if (!isCoach) return null;

  if (status === 'idle' || status === 'loading') {
    return <section className="mb-6 cal-nested-card" data-testid="coach-access-loading" role="status">Loading coaching access…</section>;
  }

  if (status === 'error') {
    return (
      <section className="mb-6 cal-nested-card" data-testid="coach-access-unavailable">
        <h2 className="text-sm font-medium text-[var(--cal-ink)]">Access status unavailable</h2>
        <p className="mt-1 text-xs text-[var(--cal-muted)]">Your access status could not be loaded. Server permissions will continue to determine available actions.</p>
        {error && <span className="sr-only">{error}</span>}
        <button type="button" className="mt-2 text-xs underline text-[var(--cal-muted)]" onClick={() => void refreshAccess()}>Try again</button>
      </section>
    );
  }

  const entitlements = access?.entitlements;
  const usage = access?.usage;
  const active = entitlements?.active === true;
  const limit = usage?.maxActiveAthletes ?? null;
  const plan = entitlements?.planKey ? PLAN_LABELS[entitlements.planKey] || 'Coaching plan' : null;
  const expiry = readableDate(access?.grant?.expiresAt);
  const subscriptionSource = access?.accessSource?.type === 'subscription' ? access.accessSource : null;
  const subscriptionEnd = subscriptionSource?.status === 'CANCELED' || subscriptionSource?.cancelAtPeriodEnd
    ? readableDate(subscriptionSource.currentPeriodEnd) : null;
  const unlimited = limit === null;

  return (
    <section className="mb-6 cal-nested-card" data-testid="coach-access-status" aria-live="polite">
      <h2 className="flex items-center gap-2 text-sm font-medium text-[var(--cal-ink)]">
        {active ? <ShieldCheck size={16} className="text-[var(--cal-success)]" aria-hidden="true" /> : <ShieldAlert size={16} className="text-[var(--cal-warning)]" aria-hidden="true" />}
        {active ? access?.grant?.source === 'beta' || entitlements?.planKey === 'coach_beta' ? 'Beta access' :
          access?.grant?.source === 'offline_payment' ? 'Prepaid coaching access' : 'Coaching access' : 'Coaching access inactive'}
      </h2>
      {active ? (
        <div className="mt-2 space-y-1 text-xs text-[var(--cal-muted)]">
          {plan && <p>Plan: <span className="text-[var(--cal-ink)]">{plan}</span></p>}
          {subscriptionSource && <p>Status: <span className="text-[var(--cal-ink)]">Active</span></p>}
          {usage && <p>Athletes: <span className="text-[var(--cal-ink)]">{formatAthleteUsage(usage.activeAthletes, limit)}</span></p>}
          {expiry && <p>Access until: <span className="text-[var(--cal-ink)]">{expiry}</span></p>}
          {subscriptionEnd && <p>Access until: <span className="text-[var(--cal-ink)]">{subscriptionEnd}</span></p>}
          {!expiry && access?.grant && <p>Access has no scheduled expiry.</p>}
          <button type="button" className="mt-1 inline-flex items-center gap-1 underline" onClick={() => void refreshAccess()}>
            <RefreshCw size={12} aria-hidden="true" /> Refresh status
          </button>
        </div>
      ) : (
        <p className="mt-1 text-xs text-[var(--cal-muted)]">You can still view your account and existing athletes, but creating or editing programs and adding new athletes is currently unavailable.</p>
      )}
    </section>
  );
}
