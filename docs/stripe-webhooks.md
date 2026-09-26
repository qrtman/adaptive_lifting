# Stripe subscription webhooks (Phase 4B)

This integration accepts subscription lifecycle events only. It does not create customers or subscriptions, expose a payment UI, or provide checkout/billing-portal behavior.

## Configuration

Keep every value below in the backend runtime environment. Do not add any of them to a `VITE_*` setting.

```dotenv
STRIPE_BILLING_ENABLED=true
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_EXPECT_LIVEMODE=true
STRIPE_PRICE_COACH_STARTER=price_...
STRIPE_PRICE_COACH_PRO=price_...
STRIPE_PRICE_COACH_UNLIMITED=price_...
```

When `STRIPE_BILLING_ENABLED` is false or unset, the endpoint returns `503` and does not inspect or process events. Production-like deployments that enable Stripe must configure all three distinct price IDs and `STRIPE_EXPECT_LIVEMODE=true`. Local development can enable Stripe with test-mode configuration and `STRIPE_EXPECT_LIVEMODE=false`. Never infer event mode from the API key prefix.

The three configured recurring Price IDs are the authoritative mapping to `coach_starter`, `coach_pro`, and `coach_unlimited`. `coach_beta` remains a manual grant. Subscription metadata, product names, customer email, and workspace metadata do not grant a plan.

## Customer mapping

Before an event can grant an entitlement, an operator must link the Stripe customer to the existing coach workspace:

```bash
python -m backend.manage_user link-billing-customer coach@example.com --provider stripe --customer-id cus_123
python -m backend.manage_user show-access coach@example.com
```

The mapping is unique per provider customer and per workspace/provider. It cannot be moved by the link command. The webhook never guesses by email or trusts event metadata for workspace ownership. `show-access` masks the stored customer identifier.

## Endpoint and event subscription

Configure the Stripe endpoint as:

```text
POST https://<application-host>/api/billing/stripe/webhook
```

Select only:

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.paused`
- `customer.subscription.resumed`

Unrelated signed events are recorded as ignored and acknowledged with 2xx. Connect-context events are also recorded and ignored; this application does not accept Connect subscriptions. A test/live mode mismatch and signature failures are rejected.

The endpoint verifies the exact raw request bytes using `Stripe-Signature` and `STRIPE_WEBHOOK_SECRET`. Missing configuration fails closed. No session cookie, bearer token, or browser CSRF token is expected.

## Status translation

| Stripe status | Internal status | Access policy |
| --- | --- | --- |
| `trialing` | `TRIALING` | Entitled |
| `active` | `ACTIVE` | Entitled; scheduled cancellation remains entitled through period end |
| `past_due` | `PAST_DUE` | Existing configured grace policy applies |
| `canceled` | `CANCELED` | Existing policy allows through future period end |
| `incomplete` | `INCOMPLETE` | Not entitled |
| `incomplete_expired` | `EXPIRED` | Not entitled |
| `unpaid` | `EXPIRED` | Not entitled |
| `paused` | `EXPIRED` | Not entitled; a later resumed event can reactivate it |

An unknown status, missing/unmapped customer, unknown price, or anything other than exactly one recognized recurring coaching price fails closed. Mixed/add-on subscription items are not supported in this phase. Stripe `event.created` seconds and event ID are stored as the accepted provider watermark. Older events are marked stale. For events with identical timestamps, lexicographically larger event ID wins; this stable tie rule does not claim that Stripe IDs encode business order.

## Delivery, retries, and operations

Webhook event IDs are stored in the existing `webhook_events` inbox and protected by its database unique constraint. The inbox status and subscription/audit mutation commit in one transaction. `FAILED` mapping events are recorded after rollback and remain retryable; fix the customer/price/configuration issue and use Stripe's dashboard to resend the event. Internal failures return 5xx and are not marked processed. Processed, ignored, and stale duplicate deliveries are acknowledged without applying the subscription again.

Safe operational fields are logged: event ID/type, provider subscription ID, workspace ID, and result. Raw payloads and secrets are not logged. Inspect local subscription/access state with:

```bash
python -m backend.manage_user show-access coach@example.com
```

Apply schema changes before deploying the API:

```bash
alembic -c alembic.ini upgrade head
```
