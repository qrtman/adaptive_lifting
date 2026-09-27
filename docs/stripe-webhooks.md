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

## Checkout reservation and retries

`billing_checkout_reservations` has one current row per workspace and provider. A database write lock on the workspace serializes the initial claim and every replacement; unique constraints on `(workspace_id, provider)` and `(provider, request_id)` provide a second guard. The row moves through `CREATING → OPEN → COMPLETED`, or to `EXPIRED` / `FAILED`. Audit events retain the prior attempt's safe identifiers when the slot is reused. The Checkout URL is stored for owner-only request replay and never printed by `show-access` or exposed by `/api/account/access`.

Stripe idempotency prevents duplicate retry of **one request**. The workspace reservation prevents **separate requests** from opening parallel subscription sessions. The same UUID and plan resume an open Checkout without another Stripe call; a different UUID for the same plan resumes the same URL. A different plan is rejected with `BILLING_CHECKOUT_IN_PROGRESS`, and reuse of a UUID for another plan is rejected with `BILLING_CHECKOUT_REQUEST_CONFLICT`.

The provider's `expires_at` is persisted. On a later request, the server checks an expired local session with Stripe and calls `checkout.Session.expire` if still open. It replaces the slot only after Stripe confirms `expired`; a complete or unreachable session blocks replacement. The same UUID can retry a `CREATING` operation with its original Stripe key; another UUID can recover it after ten minutes, within a conservative 23-hour idempotency window. An ambiguous timeout leaves `CREATING` intact for that recovery. A definitive provider rejection marks `FAILED`. A successful Stripe create followed by a failed local update remains `CREATING`, so recovery repeats the same provider operation.

Only a signed subscription webhook and trusted `BillingCustomer` mapping complete the reservation. The subscription Price mapping remains authoritative for plan and entitlement. A reservation plan mismatch records `CHECKOUT_RECONCILIATION_MISMATCH` while preserving the synchronized subscription. Browser `billing=success` only starts a bounded access refresh.

## Deployment and PostgreSQL verification

Before enabling production billing, configure the Stripe secret, signed webhook secret, three distinct recurring Price IDs, `STRIPE_EXPECT_LIVEMODE=true`, and a single HTTPS `APP_URL` origin. Ensure the endpoint receives `customer.subscription.*` events and the production Origin/Referer guard is configured for that origin. Apply migrations before starting the API. Do not use customer email, Checkout metadata, or browser redirects as an entitlement source.

Use disposable PostgreSQL, with `DATABASE_URL` set to that database, and the application's actual Alembic command:

1. Empty database: `alembic -c alembic.ini upgrade head`. Inspect tables and unique/FK constraints, and try representative duplicate inserts.
2. Second empty database: `alembic -c alembic.ini upgrade 0004_outbox_result`; insert a representative user; then `upgrade head` and verify the user survived.
3. Run `downgrade 0007_billing_customer_mapping` followed by `upgrade head` on a disposable head database. Inspect the reservation table after each step.
4. With independent database connections, attempt two claims for the same workspace and duplicate webhook event IDs. Confirm one Checkout slot and one effective webhook mutation. Verify a newer canceled subscription cannot be overwritten by an older active event.

The production checklist is incomplete until these PostgreSQL checks pass. SQLite test results do not establish PostgreSQL readiness.
