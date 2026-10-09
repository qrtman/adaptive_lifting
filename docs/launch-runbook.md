# Supabase launch runbook

Production application traffic is served by the static frontend host and
Supabase Edge Functions. Do not deploy `backend/main.py`, `backend/worker.py`,
FastAPI, or a Python database process. The Python code remains a local and test
reference only.

Use [the production cutover plan](../supabase/PRODUCTION_CUTOVER.md) for the
complete non-secret configuration manifest, release order, provider setup,
smoke checks, rollback criteria, and evidence record.

## Billing operations

Billing and voucher redemption execute in the Supabase API Edge Function.
Stripe test/live credentials and webhook secrets belong in the corresponding
Supabase project configuration. Voucher signing uses a dedicated
`VOUCHER_CODE_SECRET` stored through the private Vault getter. Never reuse the
app JWT, offline-auth, Realtime, email-encryption, or integration-encryption
keys. Keep Stripe test and live accounts, Price IDs, and webhook signing keys
separate.

Voucher issue, inspect, revoke, and billing diagnostics are operator-only
private database functions. They are not browser routes and are not exposed to
the Edge runtime role. Issue a voucher from the trusted database operator
connection and record its one-time plaintext securely for delivery. Inspection
never returns the code; revocation only affects an unredeemed voucher. A
redeemed voucher's grant is managed separately.

For Stripe, a successful Checkout browser return does not grant access. Verify
that the signed provider webhook was processed through the trusted
`BillingCustomer` mapping and configured Price mapping, then inspect account
access and the billing lifecycle from the established audit surface. Webhook
retries are idempotent; resolve mapping/configuration failures before asking the
provider to resend an event.

## Recovery

Prefer forward-compatible code fixes. Do not downgrade or delete billing data
to roll back a release. Preserve subscriptions, webhook inbox rows, vouchers,
grants, and audit events. If frontend traffic must be switched back, use the
documented routing rollback only after checking that the previous application
can safely operate with the current schema and data; production rollback is
not part of the staging audit.
