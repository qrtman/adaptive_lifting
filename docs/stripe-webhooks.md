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

## Hosted Checkout and Customer Portal

Create three **recurring** Stripe Prices for Starter, Pro, and Unlimited in the same Stripe account and mode as `STRIPE_SECRET_KEY`. Set their IDs in `STRIPE_PRICE_COACH_STARTER`, `STRIPE_PRICE_COACH_PRO`, and `STRIPE_PRICE_COACH_UNLIMITED`. Beta is a manual grant and has no purchasable Price. Enable `STRIPE_BILLING_ENABLED`, set `APP_URL` to the exact frontend origin, and configure the signed webhook above before opening billing to customers. The account Security screen retrieves Price amount, currency, and interval from Stripe through `GET /api/billing/plans`; these values are display data only.

An authenticated workspace OWNER chooses an internal plan key. The server maps it to the configured Price, reuses or creates a Stripe Customer with a workspace-based idempotency key, persists the trusted `BillingCustomer` mapping, then creates one subscription-mode hosted Checkout Session. A browser-generated UUID is reused on network retries and included with workspace and plan in the Checkout idempotency key. Existing current Stripe subscriptions, including incomplete and past-due states, block another Checkout. `EXPIRED` rows and `CANCELED` rows whose period ended allow a new attempt. A manual beta or founder grant does not block purchase. If Stripe creates a Customer but local persistence fails catastrophically, the stable Stripe idempotency key lets a retry recover that Customer; an orphan Customer is still possible if the workspace identity changes or Stripe's idempotency retention expires.

Checkout returns to the fixed Security route under `APP_URL` with `billing=success` or `billing=cancelled`. Portal returns with `billing=portal-return`. The success page polls `/api/account/access` briefly and offers manual refresh if synchronization takes longer. Neither redirect nor Checkout Session completion grants access. The signed `customer.subscription.*` webhook updates the local Subscription, and the existing resolver applies capabilities. Portal returns likewise refresh account access without changing local Subscription state.

In Stripe Dashboard, enable the Customer Portal for subscription viewing, payment method updates, invoices, cancellation at period end, and reactivation. If Portal plan switching is enabled, restrict its catalog to the three configured coaching Prices. Portal changes arrive through the same `customer.subscription.updated/deleted` webhook path. Do not add unrelated items or add-ons to coaching subscriptions: the webhook adapter requires exactly one recognized recurring coaching Price item. No card data or provider secret is handled by the frontend.

The Checkout and Portal routes require an authenticated coach with server-controlled `OWNER` workspace membership. They pass through the application's production Origin/Referer guard for cookie writes. The webhook uses Stripe signature authentication and has no browser session requirement.

PostgreSQL migration verification is still required before a paid production launch. Use a disposable PostgreSQL 16 database to test fresh upgrade, existing-schema upgrade, newest downgrade/upgrade, and the customer, subscription, webhook uniqueness and foreign-key constraints. SQLite migration tests alone do not establish PostgreSQL deployment readiness.
