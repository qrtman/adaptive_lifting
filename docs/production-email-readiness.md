# Production email onboarding readiness

## Current decision

The repository has an implemented, fail-closed password onboarding path, but
production email onboarding is **not ready to open**. See the
[authoritative production status](PRODUCTION_STATUS.md). The owner's verified
checkpoint identifies production project `gadusaizqnshxqcckibq` in
`ap-northeast-2` on Free, initialized with all 63 migrations. Do not bootstrap
or reapply them. A verified sender has not been established by this review. Local tests
exercise a mocked Resend boundary; they do not establish provider acceptance,
inbox receipt, DNS authentication, or the deployed Cron/Vault configuration.
Keep password signup closed until the owner completes the actions below and a
controlled inbox test passes.

This is a readiness record, not authorization to provision a project, add
secrets, activate a provider, send a real message, deploy, or change DNS.

## Implemented contract

- New password accounts require email verification by default. Production
  build validation requires `EMAIL_VERIFICATION_NEW_ACCOUNTS=true`; the launch
  runbook keeps `EMAIL_VERIFICATION_ENFORCE_LEGACY=false`.
- `EMAIL_ONBOARDING_ENABLED` defaults to false in production. Registration and
  resend return unavailable before database work until explicitly enabled.
  Verification of already issued links remains available. Enable only under an
  authorized controlled inbox test, then retain true only after delivery passes.
- Registration creates the user, a SHA-256-only token record, and an encrypted
  delivery job transactionally. Registration returns no session. If sender or
  payload-key settings cannot be read, registration returns unavailable before
  creating a pending account. Sender configuration alone does not prove Cron
  dispatch readiness or inbox delivery; the production enablement gate covers
  the operator's completion of those separate checks.
- The raw token exists only in the Edge request while being encrypted with a
  dedicated Fernet key; the outbox JSON contains no token or link. The token
  expires after 24 hours, is single-use, and verification requires an explicit
  POST after the browser scrubs the fragment from the URL.
- Resend has a 60-second cooldown and a five-per-rolling-24-hour account cap.
  Unknown, verified, deleted, exempt, and throttled addresses receive the same
  generic response. Reissue invalidates the previous token and cancels its
  unsent job. Verification, resend, and worker delivery serialize on the
  account lock.
- Database-backed IP limits are shared across instances: registration is
  limited to 10 per rolling hour; login/Google/Telegram, verification, and
  resend each have 20 per rolling minute. Eligibility is checked before
  session creation, protected API access, Telegram access, and coach linking.
- `email-verification-worker` is private and processes only its provider's
  jobs. The one-minute `pg_cron` dispatcher reads its URL, publishable key,
  and internal bearer secret from Vault. The worker reads the internal secret,
  delivery configuration, and payload key from private RPCs backed by Vault.
  It claims jobs only after confirming delivery configuration, uses a
  15-minute lease, at most three attempts, provider idempotency, and clears
  encrypted payloads at terminal outcomes. Errors and logs omit provider
  response bodies, links, and tokens.
- Stripe, vouchers, Telegram, and Google Sheets remain disabled for fresh
  production launch. Google sign-in is optional and must remain unset until
  its separate provider approval and redirect test.

The implementation is in `20261006150000_auth_onboarding_email_worker.sql`
and `20261006160000_email_worker_clear_claim_on_retry.sql`, with handlers in
`supabase/functions/_shared/onboardingRoute.ts`,
`emailWorkerCore.ts`, and `emailReadiness.ts`, and the private worker entry point
in `supabase/functions/email-verification-worker/index.ts`. These migrations
are already included in the completed production ledger. See the remaining
gates in [the cutover runbook](../supabase/PRODUCTION_CUTOVER.md).

## Owner actions before signup

1. Use the existing production project. Confirm the email worker function is deployed and the
   Cron schedule exists; this repository cannot prove deployed state.
2. Configure the following in the production secret manager/Vault. Use
   independent production-only values and use the same payload key for API and
   worker execution:

   - Vault: `adaptive_lifting_email_payload_encryption_key`
   - Vault: `adaptive_lifting_resend_api_key`
   - Vault: `adaptive_lifting_email_from`
   - Vault: `adaptive_lifting_email_app_url` set to
     `https://app.goatedmethod.me`
   - Vault: `adaptive_lifting_email_worker_edge_url` pointing to the exact
     project's `email-verification-worker` Edge Function URL
   - Vault: `adaptive_lifting_email_worker_publishable_key`
   - Vault: `adaptive_lifting_email_worker_internal_secret`

   Delivery credentials may instead be supplied as matching Edge secrets, but
   the Cron dispatch URL/key/internal secret and payload encryption key remain
   Vault-backed according to the migration contract. Never put secret values
   in repository files, browser build variables, or logs.
3. Select and verify an owner-controlled transactional sending domain with Resend.
   The exact sender address and subdomain are still an owner decision; ownership
   of the app hostname does not establish Resend verification. Set
   `adaptive_lifting_email_from` to that verified address. Publish
   the exact SPF and DKIM records shown for that domain, disable click/open
   tracking for verification messages, and start DMARC at monitored `p=none`.
   Inspect real received headers for SPF, DKIM, alignment, and DMARC pass.
4. After explicit authorization to enable onboarding and send a test email, set
   `EMAIL_ONBOARDING_ENABLED=true` for the controlled test. With an
   owner-controlled test mailbox, validate the real delivery path:
   registration produces no session; the message arrives; the fragment link is
   scrubbed; explicit confirmation succeeds; expiry and token reuse fail;
   resend invalidates the old link; rate limits hold; provider temporary
   failures retry without leaking secrets; and missing sender/dispatch
   configuration fails closed. Check deployed logs for token or URL capture.
5. Keep onboarding enabled only after the controlled test succeeds; otherwise
   restore `EMAIL_ONBOARDING_ENABLED=false`. Monitor queued and
   failed email jobs, provider acceptance, bounces, and delivery latency. A
   queued job is not proof of delivery.

These are the minimal owner-controlled prerequisites. No production access,
secrets, DNS, provider calls, or deployment were used to prepare this record.

## Local verification evidence

Historical evidence, 2026-10-11: the focused local Vitest group passed: `emailReadiness.test.ts`,
`emailWorkerCore.test.ts`, and `onboardingFailClosed.test.ts` (10 tests). The
worker test uses a mocked fetch boundary. Production sender verification,
Vault contents, Cron invocation, provider acceptance, inbox placement, and DNS
remain **not tested**.

Supabase's current guidance supports the architecture used here: schedule Edge
Function calls through `pg_cron` plus `pg_net`, and store dispatch credentials
in Vault ([scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)).
