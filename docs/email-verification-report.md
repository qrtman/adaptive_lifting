# Email verification implementation report

> Historical implementation report for the legacy Python deployment. File
> inventories below describe that snapshot and are not active deployment
> artifacts. The current runtime and hosting contract are documented in
> `supabase/README.md` and `supabase/PRODUCTION_CUTOVER.md`.

Repository: `qrtman/adaptive_lifting`. Working branch: `local-save`. Reference/unchanged HEAD: `c8c0181a90c9962e779f633c2bc48bca1b971435`. Implementation is in the working tree; no merge, push, deployment or live database changes were performed. The initial working tree was clean.

## Database changes

Migration `0011_email_verification` follows the actual head `0010_voucher_redemption_limits`. It adds a nullable verification timestamp and separate required/legacy-exemption booleans. Existing password accounts retain a NULL timestamp and receive an exemption. Existing Google subjects receive verified status. It adds hash-only token records with lifecycle timestamps, resend provenance, foreign keys, hash/expiry checks and a unique active-token-per-user index. Shared IP subject/event tables provide rolling limits. The integration outbox gains nullable connection IDs, protected ciphertext and a token foreign key.

SQLite preservation tests compare sessions, coach relationships, workspaces, access grants and subscriptions before/after upgrade, repeated upgrade and downgrade. PostgreSQL upgrade/check/downgrade/reupgrade and concurrency checks were run on an independently created disposable PostgreSQL 16 container. Core identities, training data, relationships and subscriptions are preserved. Downgrading removes verification state/email jobs and is not a safe production toggle after pending accounts exist.

## Authentication and authorization

Registration returns a generic message and creates no session, cookie, access token or authenticated profile. Account, hashed token and encrypted email job commit together. Verification accepts the token only through POST, atomically consumes it and marks the email verified without signing in. Password login checks valid credentials before returning `EMAIL_VERIFICATION_REQUIRED` for pending identities. Every protected cookie/bearer authentication and common session creator applies the same eligibility policy.

Resend is generic for all addresses and eligibility states. It invalidates previous tokens/jobs, applies a 60-second issuance cooldown and a maximum of five resends per rolling 24 hours. New-registration enforcement and later legacy enforcement are separate; disabling the new-registration switch does not release already pending identities. Startup requires recovery configuration while pending identities remain.

## Email delivery

The existing database outbox and standalone worker dispatch both Google Sheets and verification email. Resend is the real transactional provider; a fake adapter is explicitly limited to local/test environments. Emails include HTML, plain text, a labeled button and expiry instructions. Temporary provider errors retry with bounded attempts/backoff and a stable provider idempotency key. Database claims/leases support concurrent worker processes. A separate Fernet key protects temporary token ciphertext; ordinary JSON payloads contain no raw token. Success, cancellation, expiry and terminal failure erase ciphertext.

## Compatibility and offline behavior

Google ID-token signature/issuer/audience/expiry and verified-email validation remain in the official verifier, with stable `sub` identity. Email-only merging is prohibited. A pending password collision is retired into a retained tombstone and a distinct verified Google identity is created; credentials, data and entitlements never transfer. Verified/exempt password linking requires authentication to the matching account.

Telegram Mini App sessions, stale linking tokens and webhook training commands check eligibility. Sheets OAuth callbacks and queued exports also revalidate accounts/relationship/integration access. New coach invitations/linking require eligible participants; historical relationships and subscriptions remain unchanged.

The frontend adds pending registration, explicit verification confirmation, success and invalid/expired recovery in the existing Cal theme. It scrubs fragment tokens before external assets load, uses no-referrer policy and never signs in after registration. Browser preferences and unsigned profiles cannot authenticate. Online restoration validates `/api/auth/me`; offline reload uses a pinned ES256 signed capability bounded by the server session and 24 hours. Server rejection/logout clears authorization while retaining training snapshots and mutation queues. The Mini App logger uses authorized owner caches and the existing sync queue, and refuses offline fallback on server denial.

## Security measures

- Exactly 32 CSPRNG bytes per token; SHA-256 persistence; 24-hour expiration.
- Account locks serialize consumption, replacement and delivery on SQLite/PostgreSQL; conditional consumption has one concurrent winner.
- Shared database IP limits: ten registrations/hour, twenty verification or resend attempts/minute, twenty general authentication attempts/minute.
- Generic registration/resend; verification errors never echo submitted tokens; provider errors never retain response bodies or links.
- POST confirmation, fragment-only generated links, immediate URL scrubbing, no-store auth responses, no-referrer policy and disabled browser traces in the test harness.
- Production rejects fake or missing transactional delivery configuration; independent backend encryption and optional offline signing secrets.

## Tests executed

| Command/check | Actual result |
| --- | --- |
| `.venv\Scripts\python.exe -m pytest -q` | **266 passed**, no skips, 132.12s. Both optional PostgreSQL URLs targeted the disposable container. |
| `npm.cmd run test` | **219 passed**, 30 files. |
| `npm.cmd run lint` | Passed (`tsc --noEmit`). |
| `npm.cmd run build` | Passed; Vite large-chunk warning remains. |
| `node node_modules/@playwright/test/cli.js test e2e/email-verification.spec.ts e2e/login.spec.ts e2e/link.spec.ts e2e/offline.spec.ts e2e/navigation.spec.ts e2e/shared-plan.spec.ts` | **16 passed**, 1.1m. Uses the default isolated configuration. |
| `node node_modules/@playwright/test/cli.js test` (broader run, before the additional mobile check) | **38 passed, 14 failed**, 8.1m; unresolved cases are listed below. This suite is **not** reported as passing. |
| SQLite migration tests in `backend/test_migrations.py` | Passed: fresh/legacy upgrades, repeatability, adoption, downgrade/reupgrade, preserved sessions/relationships/subscriptions and schema checks. |
| PostgreSQL `alembic upgrade head` twice, `check`, `downgrade 0010_voucher_redemption_limits`, `upgrade head`, `check` | All commands returned exit 0; schema checks reported no new upgrade operations. |
| PostgreSQL email concurrency tests | All three passed in the full backend run: exactly one verification winner, serialized resend, shared IP controls and concurrent outbox claims. |
| Git whitespace/source review | Passed. |

Local ignored evidence logs: `backend-tests.log`, `frontend-test.log`, `frontend-lint.log`, `frontend-build.log`, `playwright-tests.log`, `playwright-all-tests.log`, `postgres-migrations.log`.

The 14 unresolved broader browser cases are:

- `calendar.spec.ts`: hover New session dialog flow (font weight assertion expects greater than 600, actual 600); lift-filter category/pattern/tier flow (absent picker options).
- `e1rm-rpe-floor.spec.ts`: LOG e1RM progression (absent picker option).
- `reorder.spec.ts`: lift reordering (absent picker option).
- `session.spec.ts`: typed Plan kg, plan-kg update suggestion, grid headers/delta, and later-set percentage scaling (four absent picker-option failures).
- `sessions-list.spec.ts`: Plan/Log headings, comparison layout, block scrolling/card count, and tonnage comparison text (four outdated heading/layout/text expectations).
- `sheets-cell-edit.spec.ts`: grid keyboard parity (absent picker option).
- `sync-overlay.spec.ts`: flushing spinner/layout (absent picker option).


Optional PostgreSQL billing readiness was also enabled against the disposable database. One earlier run exposed intermittent under-acceptance in the existing voucher rate-limit concurrency assertion (four accepted instead of five); an unchanged full rerun passed. That unrelated limiter was not modified. Unit-test warnings include existing short development JWT fixtures and a dependency deprecation. The successful production build reports its existing large-chunk warning.

## Required configuration

Set `EMAIL_VERIFICATION_NEW_ACCOUNTS=true`, `EMAIL_VERIFICATION_ENFORCE_LEGACY=false`, `EMAIL_PROVIDER=resend`, `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM`, an independent stable `EMAIL_PAYLOAD_ENCRYPTION_KEY` and the exact HTTPS `APP_URL`. API and worker share the database and delivery settings. Preserve existing database/JWT/CORS/cookie/integration settings. Configure matching `OFFLINE_AUTH_PRIVATE_KEY` (backend-only P-256 PEM) and `VITE_OFFLINE_AUTH_PUBLIC_KEY` (frontend SPKI base64) to preserve secure offline reloads. The full [configuration and DNS guide](email-verification.md#environment-variables) documents generation, sender setup, SPF, DKIM and staged DMARC enforcement.

## Remaining limitations and manual validation

- Live provider inbox delivery, domain ownership/DNS authentication, bounces/inbox placement and real Google/Telegram credentials require staging validation; deterministic adapters/verifier mocks do not prove these.
- Disconnected browsers cannot observe immediate revocation; signed offline grants expire within 24 hours and reconnect revalidates. Historical browsers require one online refresh after upgrading. No old training snapshots are indiscriminately erased.
- A provider-accepted email cannot be recalled; resend immediately invalidates its link, and the worker does not submit already superseded jobs.
- SQLite serializes writers; production configuration continues to require persistent PostgreSQL.
- The broader 52-test browser run finished with 38 passed and 14 failed. Remaining failures use absent movement-pattern options in the category picker, old `Competition Squat/Deadlift` headings, font/layout and scrolling assumptions, or obsolete tonnage text. Their product surfaces were not changed by this feature. A clean baseline browser run was not performed, so these are recorded as unresolved broader-suite failures, not claimed as proven baseline failures. The verification/auth/linking/offline/navigation/shared-plan selection passes independently.

## Staging and production rollout

Follow the [rollout instructions](email-verification.md#validation-and-rollout): restore-test a staging backup, configure the verified sender/DNS and independent secrets, migrate/repeat/check, build with the pinned public key, start API plus standalone worker, then validate real email delivery and old sessions/subscriptions/relationships/integrations. Exercise expiry/reuse/resend/retry, scan logs/APM for credential capture, and validate offline/reconnect behavior. Monitor queued/failed email jobs, provider acceptance and authentication failures.

Only after staging acceptance and explicit deployment authorization should an operator back up production, briefly pause password registration, drain old processes, apply the migration and deploy matching API/worker/frontend builds before reopening registration. Keep legacy enforcement disabled initially. Plan later enforcement with communication/recovery; prefer forward fixes over downgrading authentication code once pending users exist. No production action was executed here.

## Files created

- `backend/auth_limits.py`
- `backend/email_delivery.py`
- `backend/email_verification.py`
- `backend/migrations/versions/0011_email_verification.py`
- `backend/offline_auth.py`
- `backend/test_email_verification.py`
- `backend/test_email_verification_postgres.py`
- `docs/email-verification-report.md`
- `docs/email-verification.md`
- `e2e/email-verification.spec.ts`
- `e2e/verified-fixture.ts`
- `playwright.verification.config.ts`
- `scripts/email_verification_test_fixture.py`
- `scripts/email_verification_test_server.py`
- `src/components/EmailVerificationView.test.tsx`
- `src/components/EmailVerificationView.tsx`
- `src/contexts/AuthContext.test.tsx`
- `src/services/authAuthorization.test.ts`
- `src/services/authAuthorization.ts`

## Files modified

- `.env.example`
- `.env.production.example`
- `Dockerfile`
- `architecture.md`
- `backend/database.py`
- `backend/dev_seed.py`
- `backend/integrations.py`
- `backend/main.py`
- `backend/migrations/adopt.py`
- `backend/migrations/versions/0001_current_schema.py`
- `backend/request_security.py`
- `backend/runtime_config.py`
- `backend/test_analytics.py`
- `backend/test_auth.py`
- `backend/test_day_notes.py`
- `backend/test_integrations_logic.py`
- `backend/test_migrations.py`
- `backend/test_release_security.py`
- `backend/test_runtime_config.py`
- `backend/test_saas_access.py`
- `backend/test_stripe_checkout.py`
- `backend/test_support.py`
- `backend/test_vouchers.py`
- `backend/worker.py`
- `conftest.py`
- `deploy/Caddyfile`
- `design.md`
- `docker-compose.yml`
- `e2e/add-lift-dialog.spec.ts`
- `e2e/add-lift-search.spec.ts`
- `e2e/calendar.spec.ts`
- `e2e/copy.spec.ts`
- `e2e/e1rm-rpe-floor.spec.ts`
- `e2e/helpers.ts`
- `e2e/link.spec.ts`
- `e2e/login.spec.ts`
- `e2e/navigation.spec.ts`
- `e2e/offline.spec.ts`
- `e2e/reorder.spec.ts`
- `e2e/session.spec.ts`
- `e2e/sessions-list.spec.ts`
- `e2e/shared-plan.spec.ts`
- `e2e/sheets-cell-edit.spec.ts`
- `e2e/sync-overlay.spec.ts`
- `index.html`
- `playwright.config.ts`
- `src/components/AthleteProfilePanel.tsx`
- `src/components/InsightsView.tsx`
- `src/components/LoginView.test.tsx`
- `src/components/LoginView.tsx`
- `src/contexts/AuthContext.tsx`
- `src/contexts/PeriodizationContext.tsx`
- `src/contexts/SyncContext.tsx`
- `src/main.tsx`
- `src/services/api.test.ts`
- `src/services/api.ts`
- `src/services/sync_engine.ts`
- `src/vite-env.d.ts`

Generated tracked Python bytecode is restored to the reference version and is excluded from this inventory. Test logs and browser artifacts are local ignored outputs. Existing source-of-truth documents were reviewed and extended for the new auth/offline policy; canonical math, athlete ownership, coach codes, session-first navigation and one-way Sheets export are retained.
