import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAccountAccess } from '../contexts/AccessContext';
import { apiService, type BillingPlan } from '../services/api';
import { openHostedBilling } from '../services/billingNavigation';

const BILLING_MESSAGES: Record<string, string> = {
  BILLING_OWNER_REQUIRED: 'Only the workspace owner can manage billing.',
  BILLING_NOT_CONFIGURED: 'Billing is currently unavailable.',
  BILLING_PLAN_NOT_PURCHASABLE: 'This plan is not available for purchase.',
  BILLING_SUBSCRIPTION_EXISTS: 'This workspace already has a Stripe subscription. Manage it through billing.',
  BILLING_CUSTOMER_UNAVAILABLE: 'Your billing customer is unavailable. Please try again later.',
  BILLING_PROVIDER_ERROR: 'The billing provider is temporarily unavailable. Please try again.',
  BILLING_CHECKOUT_IN_PROGRESS: 'A checkout for another plan is already in progress. Complete or wait for that checkout to expire before starting another.',
  BILLING_CHECKOUT_REQUEST_CONFLICT: 'This checkout request cannot be reused for a different plan. Please try again.',
  VOUCHER_INVALID: 'Voucher is invalid or no longer available.',
  VOUCHER_RATE_LIMITED: 'Too many voucher attempts. Try again later.',
  VOUCHER_UNAVAILABLE: 'Voucher redemption is currently unavailable.',
  VOUCHER_COACH_ACCOUNT_REQUIRED: 'A coach account is required to redeem vouchers.',
};

function errorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return BILLING_MESSAGES[code] || (error instanceof Error ? error.message : 'Billing request failed.');
}

function money(plan: BillingPlan): string {
  // Stripe Price amounts use whole units for these zero-decimal currencies.
  // UGX and ISK retain a 100-based API amount for backwards compatibility.
  const zeroDecimal = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
  const currency = plan.currency.toUpperCase();
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: plan.currency.toUpperCase() })
    .format(plan.unitAmount / (zeroDecimal.has(currency) ? 1 : 100));
}

function interval(plan: BillingPlan): string {
  return plan.intervalCount === 1 ? plan.interval : `every ${plan.intervalCount} ${plan.interval}s`;
}

function paidAccessVisible(access: Awaited<ReturnType<typeof apiService.fetchAccountAccess>>): boolean {
  return access.entitlements?.active === true &&
    (access.billingSubscription?.status === 'ACTIVE' || access.billingSubscription?.status === 'TRIALING');
}

export function CoachBillingPanel() {
  const { isCoach, access, status, refreshAccess } = useAccountAccess();
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [voucherCode, setVoucherCode] = useState('');
  const [voucherMessage, setVoucherMessage] = useState<string | null>(null);
  const [returnState, setReturnState] = useState<'none' | 'syncing' | 'pending' | 'ready' | 'cancelled'>('none');
  const attempt = useRef<{ planKey: string; requestId: string; createdAt: number } | null>(null);
  const owner = isCoach && access?.membershipRole === 'OWNER';
  const canStart = access?.canStartCheckout !== false;

  useEffect(() => {
    if (!owner || status !== 'resolved' || !canStart) return;
    let cancelled = false;
    setLoadingPlans(true);
    apiService.fetchBillingPlans().then(next => {
      if (!cancelled) setPlans(next);
    }).catch(err => {
      if (!cancelled) setError(errorMessage(err));
    }).finally(() => { if (!cancelled) setLoadingPlans(false); });
    return () => { cancelled = true; };
  }, [owner, status, canStart]);

  useEffect(() => {
    if (!owner) return;
    const params = new URLSearchParams(window.location.search);
    const result = params.get('billing');
    if (!result) return;
    params.delete('billing');
    params.delete('session_id');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    if (result === 'cancelled') { setReturnState('cancelled'); void refreshAccess(); return; }
    if (result === 'portal-return') { void refreshAccess(); return; }
    if (result !== 'success') return;
    let cancelled = false;
    setReturnState('syncing');
    void (async () => {
      for (let i = 0; i < 6 && !cancelled; i++) {
        try {
          const current = await apiService.fetchAccountAccess();
          await refreshAccess();
          if (paidAccessVisible(current)) { if (!cancelled) setReturnState('ready'); return; }
        } catch { /* A transient fetch error leaves the return in a neutral state. */ }
        if (i < 5) await new Promise(resolve => setTimeout(resolve, 2000));
      }
      if (!cancelled) setReturnState('pending');
    })();
    return () => { cancelled = true; };
  }, [owner, refreshAccess]);

  if (!isCoach || status !== 'resolved' || !access?.workspace) return null;

  const startCheckout = async (planKey: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(null);
    if (attempt.current?.planKey !== planKey || Date.now() - attempt.current.createdAt > 10 * 60_000) {
      attempt.current = { planKey, requestId: crypto.randomUUID(), createdAt: Date.now() };
    }
    try {
      const url = await apiService.createCheckoutSession(planKey, attempt.current.requestId);
      openHostedBilling(url);
    } catch (err) {
      setError(errorMessage(err)); setBusy(false); inFlight.current = false;
      if (err && typeof err === 'object' && 'code' in err && err.code === 'BILLING_SUBSCRIPTION_EXISTS') void refreshAccess();
    }
  };

  const openPortal = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(null);
    try { openHostedBilling(await apiService.createPortalSession()); }
    catch (err) { setError(errorMessage(err)); setBusy(false); inFlight.current = false; }
  };

  const redeemVoucher = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current || !voucherCode.trim()) return;
    inFlight.current = true;
    setBusy(true); setError(null); setVoucherMessage(null);
    try {
      const result = await apiService.redeemVoucher(voucherCode.trim());
      setVoucherCode('');
      await refreshAccess();
      setVoucherMessage(`Voucher redeemed. ${result.planKey.replace('coach_', '').replace(/^./, letter => letter.toUpperCase())} access added for ${result.durationDays} days.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false); inFlight.current = false;
    }
  };

  const subscription = access.billingSubscription;
  return <section className="mb-6 cal-nested-card" aria-label="Billing">
    <h2 className="text-sm font-medium text-[var(--cal-ink)]">Billing</h2>
    {returnState === 'syncing' && <p role="status" className="mt-2 text-xs">Checkout completed. Activating your coaching access…</p>}
    {returnState === 'pending' && <p role="status" className="mt-2 text-xs">Access is still synchronizing. Refresh access status in a moment.</p>}
    {returnState === 'ready' && <p role="status" className="mt-2 text-xs">Paid coaching access is now active.</p>}
    {returnState === 'cancelled' && <p role="status" className="mt-2 text-xs">Checkout was cancelled. Your access has not changed.</p>}
    {(returnState === 'pending' || returnState === 'ready') &&
      <button type="button" className="mt-2 text-xs underline" onClick={() => void refreshAccess()}>Refresh access status</button>}
    {!owner ? <p className="mt-2 text-xs text-[var(--cal-muted)]">Only the workspace owner can manage billing.</p> : <>
      {subscription && <p className="mt-2 text-xs">Stripe plan: {subscription.planKey.replace('coach_', '')} · {subscription.status}</p>}
      {subscription?.cancelAtPeriodEnd && subscription.currentPeriodEnd &&
        <p className="mt-1 text-xs">Cancels on {new Date(subscription.currentPeriodEnd).toLocaleDateString()}</p>}
      {subscription?.status === 'PAST_DUE' && <p className="mt-1 text-xs">Billing issue. Access may still be active during the grace period. Manage billing to update your payment method.</p>}
      {subscription && <button type="button" disabled={busy} className="mt-2 text-xs underline disabled:opacity-50" onClick={() => void openPortal()}>Manage billing</button>}
      {canStart && (returnState === 'none' || returnState === 'cancelled') && <>
        {loadingPlans && <p className="mt-2 text-xs" role="status">Loading plans…</p>}
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {plans.map(plan => <div key={plan.planKey} className="border border-[var(--cal-hairline)] rounded-[var(--cal-radius-md)] p-3">
            <h3 className="text-sm font-medium">{plan.name}</h3>
            <p className="mt-1 text-xs">{money(plan)} / {interval(plan)}</p>
            <p className="mt-1 text-xs">{plan.maxActiveAthletes === null ? 'Unlimited athletes' : `${plan.maxActiveAthletes} athletes`}</p>
            <button type="button" disabled={busy} className="mt-2 text-xs underline disabled:opacity-50" onClick={() => void startCheckout(plan.planKey)}>Choose {plan.name}</button>
          </div>)}
        </div>
      </>}
    </>}
    <form className="mt-4 border-t border-[var(--cal-hairline)] pt-3" onSubmit={redeemVoucher}>
      <label htmlFor="billing-voucher-code" className="text-xs font-medium">Have a voucher?</label>
      <p className="mt-1 text-xs text-[var(--cal-muted)]">If you received a prepaid voucher, redeem it here.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input id="billing-voucher-code" type="text" value={voucherCode}
          onChange={event => setVoucherCode(event.target.value)} disabled={busy}
          autoComplete="off" autoCapitalize="characters" spellCheck={false}
          placeholder="VCH-XXXXX-XXXXX-XXXXX-XXXXX"
          className="min-w-0 flex-1 rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)] bg-[var(--cal-surface)] px-3 py-2 text-xs" />
        <button type="submit" disabled={busy || !voucherCode.trim()} className="text-xs underline disabled:opacity-50">Redeem</button>
      </div>
    </form>
    {voucherMessage && <p role="status" className="mt-2 text-xs">{voucherMessage}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-[var(--cal-error)]">{error}</p>}
  </section>;
}
