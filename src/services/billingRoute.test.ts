import { describe, expect, it, vi } from 'vitest';
vi.mock('../../supabase/functions/_shared/db/mod.ts', () => ({ authRepository: vi.fn() }));
vi.mock('../../supabase/functions/_shared/auth/session.ts', () => ({ authenticate: vi.fn() }));
import { billingTestHelpers, handleBillingRoute } from '../../supabase/functions/_shared/billingRoute';
import { authenticate } from '../../supabase/functions/_shared/auth/session';

const encoder = new TextEncoder();

const principal = { user: { id: 'coach-1', email: 'coach@example.test', role: 'COACH' }, sessionId: 'session-1' };
const owner = { denial: null, workspaceId: 'workspace-1', userId: 'coach-1', email: 'coach@example.test', displayName: 'Coach', workspaceName: 'Coach Workspace' };
const config = {
  enforceLegacyEmailVerification: false,
  allowedOrigins: ['https://app.example.test'],
  stripeBillingEnabled: true,
  stripeBillingEnabledConfigured: true,
  stripeSecretKey: 'sk_test_fake',
  stripeWebhookSecret: 'whsec_test_fake',
  stripePriceCoachStarter: 'price_starter',
  stripePriceCoachPro: 'price_pro',
  stripePriceCoachUnlimited: 'price_unlimited',
  stripeExpectLivemode: false,
  stripeExpectLivemodeConfigured: true,
  appUrl: 'https://app.example.test',
  billingAppUrlConfigured: true,
  appEnv: 'staging',
  cookieSecure: true,
} as never;

function mockDatabase(responses: Record<string, unknown> = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const client = {
    queryObject: async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      if (sql.includes('al_billing_owner')) return { rows: [{ payload: responses.owner ?? owner }] };
      if (sql.includes('al_billing_checkout_claim')) return { rows: [{ payload: responses.claim ?? { action: 'create', requestId: '6f5c3b2e-1d0a-4b8c-9e7f-0123456789ab', planKey: 'coach_pro' } }] };
      if (sql.includes('al_billing_customer_context')) return { rows: [{ payload: responses.customer ?? { ...owner, customerId: 'cus_staging' } }] };
      if (sql.includes('al_billing_customer_link')) return { rows: [{ payload: responses.linked ?? { customerId: 'cus_staging' } }] };
      if (sql.includes('al_billing_checkout_finalize')) return { rows: [{ payload: { ok: true } }] };
      if (sql.includes('al_billing_checkout_fail')) return { rows: [{ payload: { ok: true } }] };
      if (sql.includes('al_stripe_webhook_apply')) return { rows: [{ payload: responses.webhook ?? { status: 'processed' } }] };
      if (sql.includes('al_private.al_billing_secret')) return { rows: [{ value: null }] };
      return { rows: [{ payload: {} }] };
    },
    release: () => undefined,
  };
  return { db: { connect: async () => client } as never, calls };
}

async function stripeSignature(raw: Uint8Array, secret: string, timestamp: number) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const prefix = encoder.encode(`${timestamp}.`);
  const signed = new Uint8Array(prefix.length + raw.length);
  signed.set(prefix);
  signed.set(raw, prefix.length);
  const signature = await crypto.subtle.sign('HMAC', key, signed);
  return `t=${timestamp},v1=${[...new Uint8Array(signature)].map((part) => part.toString(16).padStart(2, '0')).join('')}`;
}

describe('billing Edge route provider boundaries', () => {
  it('serves validated plans from trusted configured price IDs', async () => {
    vi.mocked(authenticate).mockResolvedValue(principal as never);
    const { db } = mockDatabase();
    const response = await handleBillingRoute(
      new Request('https://edge.example.test/api/billing/plans'), db, config,
      async (input) => {
        const id = String(input).split('/').pop();
        return new Response(JSON.stringify({ id, active: true, unit_amount: 1234, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } }));
      },
    );
    expect(response?.status).toBe(200);
    const body = await response!.json();
    expect(body.plans.map((plan: { planKey: string; maxActiveAthletes: number | null }) => [plan.planKey, plan.maxActiveAthletes]))
      .toEqual([['coach_starter', 5], ['coach_pro', 25], ['coach_unlimited', null]]);
  });

  it('creates Checkout with server-owned Price and stable idempotency key', async () => {
    vi.mocked(authenticate).mockResolvedValue(principal as never);
    const { db, calls } = mockDatabase();
    let checkoutParams = '';
    let checkoutIdempotency = '';
    const response = await handleBillingRoute(
      new Request('https://edge.example.test/api/billing/stripe/checkout-session', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planKey: 'coach_pro', requestId: '6f5c3b2e-1d0a-4b8c-9e7f-0123456789ab' }),
      }), db, config,
      async (input, init) => {
        if (String(input).endsWith('/checkout/sessions')) {
          checkoutParams = String(init?.body ?? '');
          checkoutIdempotency = new Headers(init?.headers).get('Idempotency-Key') ?? '';
          return new Response(JSON.stringify({ id: 'cs_staging', url: 'https://checkout.stripe.com/c/pay', expires_at: 1_900_000_000 }));
        }
        return new Response('{}');
      },
    );
    expect(response?.status).toBe(200);
    expect(await response!.json()).toEqual({ url: 'https://checkout.stripe.com/c/pay', resumed: false });
    expect(checkoutIdempotency).toBe('checkout:workspace-1:coach_pro:6f5c3b2e-1d0a-4b8c-9e7f-0123456789ab');
    expect(checkoutParams).toContain('line_items%5B0%5D%5Bprice%5D=price_pro');
    expect(checkoutParams).toContain('success_url=https%3A%2F%2Fapp.example.test%2F%3Fbilling%3Dsuccess');
    expect(calls.some((call) => call.sql.includes('al_billing_checkout_finalize'))).toBe(true);
  });

  it('creates a Billing Portal only for the mapped customer and validates its URL', async () => {
    vi.mocked(authenticate).mockResolvedValue(principal as never);
    const { db } = mockDatabase({ customer: { ...owner, customerId: 'cus_workspace_bound' } });
    let sentCustomer = '';
    const response = await handleBillingRoute(new Request('https://edge.example.test/api/billing/stripe/portal-session', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }), db, config, async (_input, init) => {
      sentCustomer = new URLSearchParams(String(init?.body ?? '')).get('customer') ?? '';
      return new Response(JSON.stringify({ url: 'https://billing.stripe.com/session/test' }));
    });
    expect(sentCustomer).toBe('cus_workspace_bound');
    expect(await response!.json()).toEqual({ url: 'https://billing.stripe.com/session/test' });

    await expect(handleBillingRoute(new Request('https://edge.example.test/api/billing/stripe/portal-session', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }), mockDatabase({ customer: { ...owner, customerId: 'cus_workspace_bound' } }).db, config,
    async () => new Response(JSON.stringify({ url: 'https://attacker.example.test/' }))))
      .rejects.toMatchObject({ status: 502 });
  });

  it('keeps an ambiguous Checkout POST recoverable and fails a definitive provider rejection', async () => {
    vi.mocked(authenticate).mockResolvedValue(principal as never);
    const request = () => new Request('https://edge.example.test/api/billing/stripe/checkout-session', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planKey: 'coach_pro', requestId: '6f5c3b2e-1d0a-4b8c-9e7f-0123456789ab' }),
    });
    const ambiguous = mockDatabase();
    await expect(handleBillingRoute(request(), ambiguous.db, config,
      async () => new Response('{"error":"private"}', { status: 500 })))
      .rejects.toMatchObject({ status: 502 });
    expect(ambiguous.calls.some((call) => call.sql.includes('al_billing_checkout_fail'))).toBe(false);

    const rejected = mockDatabase();
    await expect(handleBillingRoute(request(), rejected.db, config,
      async () => new Response('{"error":"private"}', { status: 400 })))
      .rejects.toMatchObject({ status: 502 });
    expect(rejected.calls.some((call) => call.sql.includes('al_billing_checkout_fail'))).toBe(true);
  });

  it('verifies the exact raw Stripe bytes and rejects modified bodies', async () => {
    const now = 1_800_000_000_000;
    const raw = encoder.encode('{"id":"evt_test","livemode":false}');
    const signature = await stripeSignature(raw, 'whsec_test_value', now / 1000);
    await expect(billingTestHelpers.verifyStripeSignature(raw, signature, 'whsec_test_value', now))
      .resolves.toMatchObject({ id: 'evt_test', livemode: false });
    await expect(billingTestHelpers.verifyStripeSignature(
      encoder.encode('{"id":"evt_other","livemode":false}'), signature, 'whsec_test_value', now,
    )).rejects.toThrow('Invalid Stripe webhook signature or payload');
  });

  it('sends only a correctly signed, correctly-modeled event to the narrow webhook RPC', async () => {
    const now = Math.floor(Date.now() / 1000);
    const event = JSON.stringify({ id: 'evt_test', type: 'customer.subscription.created', created: now, livemode: false, data: { object: {} } });
    const raw = encoder.encode(event);
    const signature = await stripeSignature(raw, 'whsec_test_fake', now);
    const { db, calls } = mockDatabase({ webhook: { status: 'processed' } });
    const response = await handleBillingRoute(new Request('https://edge.example.test/api/billing/stripe/webhook', {
      method: 'POST', headers: { 'stripe-signature': signature }, body: raw,
    }), db, config);
    expect(response?.status).toBe(200);
    expect(await response!.json()).toEqual({ status: 'processed' });
    expect(calls.some((call) => call.sql.includes('al_stripe_webhook_apply'))).toBe(true);
  });

  it('ignores Connect events and rejects livemode mismatches after signature verification', async () => {
    const now = Math.floor(Date.now() / 1000);
    const connected = encoder.encode(JSON.stringify({ id: 'evt_connect', type: 'customer.subscription.created', created: now, livemode: false, account: 'acct_test', data: { object: {} } }));
    const connectedSignature = await stripeSignature(connected, 'whsec_test_fake', now);
    const connectDb = mockDatabase();
    const connectResponse = await handleBillingRoute(new Request('https://edge.example.test/api/billing/stripe/webhook', {
      method: 'POST', headers: { 'stripe-signature': connectedSignature }, body: connected,
    }), connectDb.db, config);
    expect(await connectResponse!.json()).toEqual({ status: 'ignored_connect' });
    expect(connectDb.calls.some((call) => call.sql.includes('al_stripe_webhook_apply'))).toBe(false);

    const wrongMode = encoder.encode(JSON.stringify({ id: 'evt_live', type: 'customer.subscription.created', created: now, livemode: true, data: { object: {} } }));
    const wrongSignature = await stripeSignature(wrongMode, 'whsec_test_fake', now);
    await expect(handleBillingRoute(new Request('https://edge.example.test/api/billing/stripe/webhook', {
      method: 'POST', headers: { 'stripe-signature': wrongSignature }, body: wrongMode,
    }), mockDatabase().db, config)).rejects.toMatchObject({ status: 400 });
  });

  it('validates complete recurring price fields and a pure trusted app origin', () => {
    expect(billingTestHelpers.validPrice({
      id: 'price_x', active: true, unit_amount: 1200, currency: 'usd',
      recurring: { interval: 'month', interval_count: 1 },
    }, 'price_x')).toBe(true);
    expect(billingTestHelpers.validPrice({
      id: 'price_x', active: true, unit_amount: 1200, currency: 'usd',
      recurring: { interval: 'month' },
    }, 'price_x')).toBe(false);
    expect(billingTestHelpers.trustedOrigin({ appUrl: 'https://app.example.test', cookieSecure: true } as never))
      .toBe('https://app.example.test');
    expect(() => billingTestHelpers.trustedOrigin({
      appUrl: 'https://app.example.test/unsafe', cookieSecure: true,
    } as never)).toThrow('Billing return URL is unavailable.');
  });

  it('does not reveal provider response bodies and retains ambiguous POST state', async () => {
    const failure = ((status: number) => ((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response('{"error":{"message":"provider-private detail"}}', { status }))) as typeof fetch);
    await expect(billingTestHelpers.stripeRequest(
      '/v1/prices/price_x', 'sk_test_fake', 'GET', {}, undefined, failure(500),
    )).rejects.toThrow('Stripe request failed');
    try {
      await billingTestHelpers.stripeRequest('/v1/checkout/sessions', 'sk_test_fake', 'POST', {}, 'idem', failure(500));
      throw new Error('expected provider failure');
    } catch (error) {
      expect((error as Error & { ambiguous?: boolean }).ambiguous).toBe(true);
      expect((error as Error).message).not.toContain('provider-private detail');
    }
    try {
      await billingTestHelpers.stripeRequest('/v1/checkout/sessions', 'sk_test_fake', 'POST', {}, 'idem', failure(400));
      throw new Error('expected provider failure');
    } catch (error) {
      expect((error as Error & { ambiguous?: boolean }).ambiguous).toBe(false);
    }
  });

  it('uses deterministic keyed voucher hashes without storing plaintext', async () => {
    const hash = await billingTestHelpers.hmacHex(
      'voucher-test-key-with-more-than-32-bytes', 'VCH-AAAAA-BBBBB-CCCCC-DDDDD',
    );
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain('VCH-');
  });
});
