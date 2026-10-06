# Email verification implementation and rollout

This guide retains the original stable-source design details below. The current Supabase-native runtime record at the top supersedes the historical standalone-worker deployment steps where they differ.

## Current Supabase-native onboarding runtime

The account-onboarding routes and verification-email delivery worker now run in Supabase Edge Functions. `supabase/migrations/20261006150000_auth_onboarding_email_worker.sql` installs private database RPCs and a one-minute `pg_cron` wake; `20261006144200_email_worker_clear_claim_on_retry.sql` clears the claim token after a retryable result. Only the Edge runtime can execute onboarding and delivery RPCs; the Python outbox consumer handles Google Sheets only. Supabase Auth is not used.

The verification payload Fernet key is held in Vault as `adaptive_lifting_email_payload_encryption_key`. Delivery uses `adaptive_lifting_resend_api_key`, `adaptive_lifting_email_from`, and `adaptive_lifting_email_app_url` in Vault, or a complete matching set of Edge environment secrets. Internal cron dispatch uses separately named Vault secrets and a private worker bearer check. The worker checks delivery configuration before claiming jobs and processes only `email-verification` rows. Missing Resend, sender, or app URL configuration leaves queued jobs untouched and returns a generic unavailable result. Secret values do not belong in migrations or this document.

## Database and authentication

Alembic `0011_email_verification` follows `0010_voucher_redemption_limits`. It adds `email_verified_at`, `email_verification_required`, and `email_verification_legacy_exempt` to users. Historical password accounts receive an exemption, **not** a fabricated verification timestamp. Historical Google identities receive verified status. Existing user IDs, sessions, relationships, training rows, workspaces, entitlements and subscriptions remain intact.

`email_verification_tokens` stores SHA-256 hashes, user IDs, creation/expiration/consumption/invalidation timestamps and resend provenance. A partial unique index allows one active token per user; hashes are unique and constrained to 64 characters. Every token comes from 32 cryptographically random bytes and expires 24 hours after issuance. Token replacement, consumption and email submission share a database account lock, using a real UPDATE compatible with SQLite and PostgreSQL. Consumption and the verification timestamp commit together.

Registration returns a generic message, with no session, bearer token or user object. Duplicate registration does not rotate another user's token. Resend uses the same generic response for unknown, verified, deleted, exempt and throttled accounts. It permits one issuance per 60 seconds, including the first email, and at most five resends in a rolling 24 hours. The initial registration email is not counted as a resend. Successful verification does not sign in; password login remains a separate step.

The database policy is checked when logging in, creating any session, authenticating an existing cookie or bearer session, and creating coach relationships. A valid password for a pending account returns HTTP 403 with `detail.code=EMAIL_VERIFICATION_REQUIRED`. Changing the new-registration flag does not exempt an already pending account. Shared, database-backed IP limits replace the old process-local counters: registration is limited to ten attempts per rolling hour; login/Google/Telegram, verification and resend categories each permit twenty attempts per rolling minute. IPs come from the actual request client; the supplied Caddy configuration replaces forwarded IP headers, and the API must remain private behind this trusted proxy.

## Email outbox and provider

The existing integration outbox supports `email-verification` without an integration connection. Account, token and encrypted email job persist in one transaction. The Python worker processes Google Sheets jobs only. Supabase Cron wakes the private `email-verification-worker` Edge Function, which claims only email-verification jobs with a database claim token and a 15-minute lease. The ordinary outbox JSON contains no link or token; only temporary Fernet ciphertext is stored in `encrypted_payload`, protected by an independent Vault key. `verification_token_id` associates the job with the hashed token record.

The Resend adapter submits both HTML and plain text through the [official send-email API](https://resend.com/docs/api-reference/emails/send-email), with the outbox ID as the provider idempotency key. A fake in-memory adapter supports local tests without external delivery. The HTML includes a labeled verification button and expiry information. Provider response bodies, tokens and links are excluded from job errors and worker logs. No production fake-provider fallback exists.

The worker atomically claims jobs, uses a 15-minute processing lease, and allows three attempts. Temporary transport errors, HTTP 408/429 and 5xx responses retry after five and ten minutes; permanent failures stop immediately. Account locking serializes delivery against resend and verification; stale workers re-read job/token status before submission. Superseded, consumed, expired and tombstoned accounts' links are never submitted by the worker. Ciphertext is removed after success, cancellation, expiration, permanent failure or exhausted retries. The worker sweeps expired payloads even during idle polling. Resend cannot retract mail already accepted by a provider, but its link becomes invalid immediately.

## Identity and integration compatibility

Google ID tokens still pass through Google's official verifier, and a true verified-email claim and stable `sub` are required. Existing Google identities keep their ID and role. A verified password account can link Google only while authenticated to that exact account. Matching emails alone never merge identities.

If a new pending password registration occupies a legitimate Google user's email, the pending identity is tombstoned under an internal retired address, its verification tokens/jobs are invalidated, and a distinct verified Google identity is created with a new random password credential. Existing data and IDs on the tombstone remain; no password, sessions, training rows, subscriptions or relationships transfer to Google. Concurrent verification winning the account lock changes the collision to an explicit linking requirement. Exempt historical password identities are never retired by this policy.

Telegram Mini App session creation, stale link tokens and webhook commands all check eligibility. Pending identities cannot fetch or modify training through `/today`, `/done` or `/status`, or receive a Telegram session. Existing exempt identities continue normally. Coach invitations and athlete linking require eligible participants. Existing relationships and subscriptions are preserved. Google Sheets remains a one-way export through the same worker. Its OAuth callback rechecks account eligibility, and queued exports recheck both participants, active integration/relationship and the coach integration entitlement before reading training or contacting Google.

## Frontend and offline authorization

Registration displays “Check your email” and a resend cooldown; it never calls `signIn`. Login handles the structured verification error with the same recovery screen. Links use `/verify-email#token=...`; the HTML captures the token in memory and removes it from the URL before loading SDKs or fonts. The page requires an explicit confirmation button and POST. Opening or scanning the GET link cannot activate an account. Success offers sign-in; invalid/expired links offer resend recovery. Reloading a scrubbed confirmation page requires reopening the email link. Referrer policy is `no-referrer`; do not add analytics or provider click/open tracking to verification links.

AuthContext starts signed out and validates `/api/auth/me`. Role/email/user ID preferences and profile snapshots cannot authorize UI. Pending registration cannot populate authenticated state. A server rejection clears the offline capability and UI authorization while preserving training snapshots and queued mutations. Sync does not run while signed out; 401 and verification-required responses invalidate authority. Cached plans and insights require a current authorization scope.

To preserve offline reloads, configure an independent ES256/P-256 private signing key on the API and its matching SPKI public key in the frontend build. `/api/auth/me` issues a signed capability containing the user, session ID and allowed plan scopes, bounded by session expiry and 24 hours. The browser verifies it against the pinned build-time public key, checks expiry, and stores it in IndexedDB. Neither unsigned profiles nor a public key supplied through browser storage are trusted. Offline athlete logging in an already authorized tab remains available. The Mini App set logger uses the same authorization scopes, writes only the permitted owner snapshot, and adds execution changes to the existing IndexedDB sync queue; server denials never enter the offline fallback. Historical browsers need one online authorization refresh after this release before secure offline reload works; old data is retained. Without the key pair, authenticated offline reload is unavailable, but authorized in-tab offline work remains.

Offline revocations or a later policy change cannot reach a disconnected browser immediately; the signed capability expires within 24 hours, and reconnection revalidates the server session. This is an explicit offline authorization lease, never a credential accepted by the API.

## Environment variables

| Variable | Setting |
| --- | --- |
| `EMAIL_VERIFICATION_NEW_ACCOUNTS` | Default `true`. Governs newly created password accounts. |
| `EMAIL_VERIFICATION_ENFORCE_LEGACY` | Default `false`; keep disabled for initial rollout. |
| `EMAIL_PROVIDER` | `resend` in staging/production; `fake` only in local/test environments. |
| `EMAIL_PROVIDER_API_KEY` | Resend sending API key; backend/worker secret. |
| `EMAIL_FROM` | Verified sender, e.g. `Adaptive Lifting <verify@accounts.example.com>`. |
| `EMAIL_PAYLOAD_ENCRYPTION_KEY` | Dedicated stable Fernet key, separate from JWT/integration keys. |
| `APP_URL` | Exact frontend origin, HTTPS in staging/production. No path/query/fragment. |
| `OFFLINE_AUTH_PRIVATE_KEY` | Optional P-256 private PEM; literal `\n` escapes supported. Backend only. |
| `VITE_OFFLINE_AUTH_PUBLIC_KEY` | Matching public SPKI DER encoded as base64; supplied to frontend builds. |

For the historical FastAPI deployment, `DATABASE_URL`, JWT rotation keys, CORS, secure-cookie and integration/provider variables remain necessary. The Supabase Edge runtime instead uses its private PostgreSQL connection plus the Vault/Edge secrets described above. Configuration validation cannot prove DNS, provider permissions or inbox placement: the staging delivery test below remains required.

Generate the email encryption key with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` and store it in your backend secret manager. To generate offline keys, use `openssl ecparam -name prime256v1 -genkey -noout -out offline-private.pem`, then `openssl pkey -in offline-private.pem -pubout -outform DER | openssl base64 -A`. Only the resulting public value belongs in a frontend build. Keep the offline key pair stable and coordinate any rotation with a matching frontend build; old capabilities then fail closed until an online refresh. Protect the private file and do not commit it. Rotate the email key only after outstanding jobs have drained or been explicitly invalidated and reissued; changing it makes existing ciphertext unreadable.

## SPF, DKIM and DMARC

Use an owned transactional subdomain and complete [Resend domain verification](https://resend.com/docs/dashboard/domains/introduction). Publish the provider's exact SPF and DKIM records; do not guess their values. Keep a single valid SPF policy for each applicable domain and preserve other legitimate senders. Disable click/open tracking for this transactional domain so providers do not create analytics redirects containing verification links.

Publish a DMARC record at the relevant `_dmarc` domain with a monitored aggregate-report address. Start with reporting (`p=none`) while validating all legitimate sending sources, then move to quarantine/reject after verifying aligned SPF/DKIM and inbox delivery. Check actual delivered message headers, including DMARC alignment, rather than assuming a DNS record alone is sufficient. See the [provider's DMARC setup guide](https://resend.com/docs/dashboard/domains/dmarc).

## Validation and rollout

1. Back up and restore-test a staging database. Use separate staging keys, provider/domain, OAuth clients and Telegram bot. Run `alembic upgrade head`, repeat it, and run `alembic check`. Do not migrate production as part of local validation.
2. Configure real email delivery and offline keys; leave legacy enforcement false. Build the frontend with the matching public key. For Supabase-native onboarding, confirm the Cron schedule, private worker authorization, and Vault/Edge configuration. The separate Python integration worker remains responsible for Google Sheets.
3. Register a staging password account; verify that no cookie/token is issued and protected APIs fail. Confirm real inbox delivery, sender identity, HTML/text, DNS authentication, fragment link preservation, explicit POST, token reuse/expiry, resend replacement and failed-provider recovery. Check logs/APM for token or URL capture. Disable request-body logging on authentication endpoints.
4. Monitor queued/failed email jobs, provider acceptance, bounces, delivery latency and authentication rate-limit events. Treat exhausted email jobs as recovery through a fresh resend after cooldown; do not manually reveal stored tokens. Registration does not report successful delivery merely because a job is queued.
5. The Supabase-native onboarding migration deploys the API Edge routes, private email worker, database functions, and cron schedule together. Keep `EMAIL_VERIFICATION_NEW_ACCOUNTS=true`, `EMAIL_VERIFICATION_ENFORCE_LEGACY=false`. Configure the independent Fernet payload key in Supabase Vault. Delivery also needs `adaptive_lifting_resend_api_key`, `adaptive_lifting_email_from`, and `adaptive_lifting_email_app_url` in Vault, or the equivalent Edge secrets. The worker returns unavailable before claiming work when delivery configuration is absent. Existing pending accounts still require verification and recovery.
6. Plan any legacy enforcement separately, including advance communication and recovery delivery. Do not bulk fabricate verified timestamps or revoke historical sessions/subscriptions merely because verification was previously unknown.

Prefer a forward fix over rolling back to old authentication code once pending accounts exist. The old code cannot enforce the new policy. Migration downgrade preserves core data but removes verification state and email jobs; it is tested for development/recovery, not a safe production feature toggle. Re-upgrading a downgraded database treats its then-existing accounts as historical, so use a reviewed backup/recovery strategy if a production downgrade is ever necessary.

Automated commands: `pytest -q`, `npm run test`, `npm run lint`, `npm run build`, and `npx playwright test --config playwright.verification.config.ts e2e/email-verification.spec.ts e2e/login.spec.ts e2e/link.spec.ts e2e/offline.spec.ts`. The isolated browser harness uses ports 3011/8123, a temporary SQLite database and fake email; it never uses the normal application database. Existing backend training fixtures now explicitly provision verified identities. Existing browser registration fixtures use the guarded local fixture script; the default Playwright configuration delegates to this isolated configuration as well. UI navigation fixtures establish a real verified session instead of authorizing through browser preferences. PostgreSQL checks use `EMAIL_VERIFICATION_POSTGRES_URL` and create/drop only their own temporary schema; point it at a disposable database. Existing billing concurrency checks use `PHASE4D_POSTGRES_URL` against a disposable migrated database.

Real provider inbox delivery, DNS, Google production tokens and Telegram production webhook behavior require staging credentials and are not claimed by deterministic mocks. The implementation report records commands actually executed and their results.
