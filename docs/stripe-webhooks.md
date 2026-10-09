# Stripe billing operations

Stripe billing is served by the Supabase `api` Edge Function. There is no
FastAPI, Python Stripe SDK, or Python operator command in the production path.
The stable Python implementation remains a reference and test suite.

## Staging and production configuration

Stripe values are server-side configuration only. Do not put secrets in
`VITE_*` variables, source control, logs, or support tickets. Configure values
in the target Supabase project's approved secret/Vault path:

| Name | Classification | Purpose |
| --- | --- | --- |
| `STRIPE_BILLING_ENABLED` | private/feature gate | Enables hosted billing routes |
| `STRIPE_SECRET_KEY` | private | Stripe API access |
| `STRIPE_WEBHOOK_SECRET` | private | Raw-body webhook signature verification |
| `STRIPE_PRICE_COACH_STARTER` | server configuration | Trusted Starter Price mapping |
| `STRIPE_PRICE_COACH_PRO` | server configuration | Trusted Pro Price mapping |
| `STRIPE_PRICE_COACH_UNLIMITED` | server configuration | Trusted Unlimited Price mapping |
| `STRIPE_EXPECT_LIVEMODE` | server configuration | Enforces test/live event isolation |
| `APP_URL` | server configuration | Trusted application return origin |
| `SUBSCRIPTION_PAST_DUE_GRACE_DAYS` | server configuration | Past-due entitlement grace; defaults to 3 |

Billing fails closed until enabled and all required key, unique Price, and
application-origin settings validate. Staging may intentionally remain
unconfigured; in that state plans/checkout/portal/webhook return safe disabled
or unavailable responses. Never use production Stripe credentials in staging.

## Webhook endpoint

Configure the Stripe endpoint at:

```text
POST https://<application-host>/api/billing/stripe/webhook
```

Subscribe only to:

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.paused`
- `customer.subscription.resumed`

The Edge handler verifies the signature over the exact request bytes before
processing the event and requires the event `livemode` to match
`STRIPE_EXPECT_LIVEMODE`. It ignores Connect and unrelated signed events. It
uses the database BillingCustomer mapping and configured Price IDs as
authority; Stripe metadata, customer email, and checkout return parameters do
not grant access. Raw webhook payloads are not persisted.

Failed mapping events remain retryable after server-side configuration or
customer mapping is repaired. Inspect event status using the private
`al_billing_operator_diagnostics` database function from a trusted operator
connection. That function returns safe diagnostics only. Voucher operator
functions and billing diagnostics are private SQL operations, not browser
routes.

## Customer mapping and operator workflow gap

Checkout creates or reuses one Stripe Customer for the coach workspace and
persists the trusted mapping. Portal requires that mapping. Webhooks never
infer workspace ownership from Stripe metadata. Do not manually reassign a
customer ID between workspaces.

The previous Python CLI exposed `link-billing-customer`, per-account
`show-access`, manual access grant/revocation, and coach promotion. Those
support actions do not yet have reviewed Supabase-native operator replacements.
They must be migrated or explicitly retired before production cutover. The
old Python commands are reference utilities only and must not be used as the
production operating procedure.

## Hosted checkout and portal

Create three recurring coaching Prices in the same Stripe account and mode as
the API key, then set their IDs in server configuration. `coach_beta` is not
purchasable. `APP_URL` must be a pure trusted application origin. An OWNER
membership on a COACH workspace is required for plan listing, checkout, and
portal. The server validates provider-hosted URLs before returning them.

Checkout reservations serialize attempts per workspace and provider. A retry
uses its original UUID and Stripe idempotency key. A Checkout success redirect
does not grant entitlement; the signed subscription webhook updates the local
Subscription, then `/api/account/access` resolves current capabilities.
Existing manual and voucher grants remain independent entitlement sources.

Configure the Stripe Customer Portal for subscription viewing, payment method
updates, invoices, cancellation at period end, and reactivation. If plan
switching is enabled, restrict it to the three configured coaching Prices.
Do not add subscription items or add-ons; the webhook accepts exactly one
recognized recurring Price.

## Entitlement mapping

| Stripe status | Internal status | Access policy |
| --- | --- | --- |
| `trialing` | `TRIALING` | Entitled |
| `active` | `ACTIVE` | Entitled unless scheduled cancellation period has ended |
| `past_due` | `PAST_DUE` | Entitled through configured grace period |
| `canceled` | `CANCELED` | Entitled only before current period end |
| `incomplete` | `INCOMPLETE` | Not entitled |
| `incomplete_expired`, `unpaid`, `paused` | `EXPIRED` | Not entitled |

Unknown statuses, unknown Prices, multiple or non-recurring items, and
unmapped customers fail closed. Events are ordered by provider timestamp and
event ID to prevent older deliveries from regressing subscription state.

## Cutover readiness

See [`supabase/PRODUCTION_CUTOVER.md`](../supabase/PRODUCTION_CUTOVER.md) for
the non-secret production configuration manifest, deployment sequence, smoke
checks, rollback decision point, and current staging limitations. Production
cutover is not authorized by this document.
