# Email verification staging validation

> Historical pre-migration planning and validation record (2026-09-28). Its
> Docker/Caddy topology and proposed deployment steps are superseded. Do not use
> this file as a deployment runbook; use `supabase/PRODUCTION_CUTOVER.md` for
> the current provider-neutral Supabase deployment contract.

**Repository:** `qrtman/adaptive_lifting`

**Branch:** `local-save`

**Reference commit:** `c8c0181a90c9962e779f633c2bc48bca1b971435`

**Validation date:** 2026-09-28

**Release decision:** **Not ready for production deployment.** Local checks and an isolated PostgreSQL rehearsal passed, but there is no configured staging host, sender domain, staging provider key, Google client, or Telegram bot. Those are needed to validate external delivery and identity flows. No production credentials, DNS, deployment, or database were used.

## Implementation reviewed

Read `docs/email-verification-report.md`, `docs/email-verification.md`, `architecture.md`, `design.md`, and `knowledge.md`. The existing code supplies a hash-only 24-hour verification token, database-backed atomic consumption and abuse limits, an encrypted durable integration outbox, the Resend adapter and worker retries, guarded password sessions, Google `sub` identity handling, Telegram and relationship eligibility checks, a signed offline capability, a migration, and registration, verification, and resend screens. New registration and existing-account enforcement are independently controlled; the default legacy exemption remains in place.

The deployment topology is the repository's Docker Compose stack: Caddy serves the frontend and proxies privately to API and worker containers; PostgreSQL persists application state. `architecture.md` already describes staging on a separate host. No GitHub workflow, staging environment, staging Compose profile, deployment connection, `.env.staging`, or deployment credential is configured in this checkout or runtime. Docker is available locally, but local Docker is not staging infrastructure.

Added a non-secret [.env.staging.example](../.env.staging.example) and read-only [staging preflight](../scripts/check_staging_config.py). The template configures `APP_ENV=staging`, new-account verification on, legacy enforcement off, separate Google and Telegram settings, and test-mode billing defaults. It contains no credentials. The preflight validates production-like email configuration, the staging HTTPS origin, PostgreSQL, Google browser/server client agreement, feature flags, and matching P-256 offline keys. The template passes `docker compose --env-file .env.staging.example -p adaptive-lifting-staging config --quiet`; preflight correctly reports **BLOCKED** because the template has empty secrets and placeholder hosts. It makes no network requests, sends no mail, and deploys nothing.

## Automated validation

| Check | Status | Result |
| --- | --- | --- |
| Backend `pytest -q` | **PASSED** | 280 passed, 207 warnings in 161.59 seconds. This run included the disposable PostgreSQL concurrency suite and the added staging configuration/legacy Telegram/token-log checks. |
| Frontend `npm run test` | **PASSED** | 219 passed across 30 files. |
| Frontend `npm run lint` | **PASSED** | `tsc --noEmit` exited 0. |
| Frontend `npm run build` | **PASSED** | Vite build exited 0. Existing warning: a minified chunk exceeds 500 kB. |
| `npm run test:e2e` final complete suite | **FAILED: 52 passed, 1 timed out** | `shared-plan.spec.ts` timed out waiting for the sign-in form on test 49 after 30 seconds. It passed on immediate isolated retry (1 passed in 11 seconds), consistent with suite-load/browser infrastructure contention; no assertions were removed or disabled. |
| Original broader Playwright run, before test corrections | **FAILED / REPRODUCED** | 39 passed, 14 failed in 8.3 minutes. The same 14 named failures were reproduced against the reference commit in an isolated worktree. |
| Focused browser suite after corrections | **PASSED** | 19 tests passed, 0 failed, including the previously failing session grid, responsive week-board, and comparison checks. |
| Isolated `shared-plan.spec.ts` retry | **PASSED** | The full-run timeout case passed alone; full-suite browser/resource contention remains unverified. |
| Compose configuration with the public staging template | **PASSED** | `docker compose ... config --quiet` exited 0. This checks Compose syntax and interpolation only, not service connectivity. |
| API Docker image build | **PASSED** | Built locally as `adaptive-lifting-staging-validation-api`; not pushed or deployed. |
| Web Docker image build | **PASSED** | Built locally as `adaptive-lifting-staging-validation-web`; not pushed or deployed. |
| Staging credential preflight on the example template | **BLOCKED as expected** | Rejected the empty Fernet key. No credential values were printed. |

The backend run retains existing PyJWT short test-key and dependency deprecation warnings. The frontend build retains its chunk-size warning. Neither warning caused a failed check.

## Classification of the 14 Playwright failures

Each named case below failed on both the feature branch and the `c8c0181` baseline using the same assertions. A detached baseline worktree used a separate temporary SQLite database, ports and test identity fixtures; it did not carry feature code into the baseline. The training, session, catalog, sorting and session-list component sources compared for these cases are unchanged from the reference commit. That evidence rules out email verification as the cause of these failures.

| # | Original failing case | Classification | Correction / disposition |
| --- | --- | --- | --- |
| 1 | `calendar.spec.ts` — New session hierarchy required title weight greater than 600 | Existing test expectation | The Cal title and label both use semibold weight 600; size carries the documented hierarchy. Assert size hierarchy and allow equal weight. |
| 2 | `calendar.spec.ts` — catalog filter expected `Knee Dominant`, `Hip Dominant`, and `Horizontal Push` category options | Outdated test expectation | Catalog selection now uses exercise search and a separate movement-pattern filter. Exercise source has only Catalog/User Defined. Tests use stored movement-pattern controls and retain category × pattern × tier filter coverage. |
| 3 | `e1rm-rpe-floor.spec.ts` — Squat selection used an old category option | Outdated test expectation | Use the movement-pattern filter and expand the collapsed set grid before entering logs. The e1RM ordering assertions remain intact. |
| 4 | `reorder.spec.ts` — old categories, “Competition …” headings and Up button | Outdated test expectation | Select by movement pattern, use plain catalog names, drag using the existing reorder handle, and verify order after reload. |
| 5 | `session.spec.ts` — typed kg and completion flow stopped at old category selector | Outdated test expectation | Use the current pattern filter, plain name, and expand the initially collapsed grid. Typed kg and later-set suggestion checks remain. |
| 6 | `session.spec.ts` — filled-plan update suggestion stopped at old category selector | Outdated test expectation | Use the current catalog picker. Existing plan kg, opt-in suggestion, no-log-overwrite and completion checks remain. |
| 7 | `session.spec.ts` — header assertion expected `Adj %` at an obsolete physical column index | Outdated test expectation | Check stable grid-header test IDs, retaining Plan/Log/metric column and no inline ×/@ checks. |
| 8 | `session.spec.ts` — set-percent scaling used old catalog selection | Outdated test expectation | Use the pattern filter. Keep the -5% scaled suggestion, no automatic Plan kg write, and acceptance flow. |
| 9 | `sessions-list.spec.ts` — catalog headings expected “Competition Deadlift/Squat” | Outdated test expectation | Catalog names are now plain “Deadlift” and “Squat”; API fixtures intentionally named “Competition Squat” remain so. |
| 10 | `sessions-list.spec.ts` — mobile week column expected the board and column to have the same width | Existing test expectation | Week columns intentionally fit content within a 32rem bound and scroll inside their board. Assert bounded columns and no document-level horizontal overflow. |
| 11 | `sessions-list.spec.ts` — a thin horizontal scrollbar was required even when all weeks fit | Existing test expectation / viewport-dependent behavior | Keep scrollbar and reset assertions when a board actually overflows; do not require a scrollbar for a board that fits. The session board remains the horizontal scroll container. |
| 12 | `sessions-list.spec.ts` — comparison tonnage expected `+50 kg (+7.1%)` in superseded copy | Outdated test expectation | Assert rendered text `Tonnage 750 kg+7.1%` and `Tonnage 725 kg-3.3%` while retaining comparison reset and metric toggle checks. |
| 13 | `sheets-cell-edit.spec.ts` — asserted there were no `@` characters in cells | Outdated test expectation | `@` is the current RPE/percentage mode button, not an inline Plan/Log separator. Assert that every match is that control; the keyboard navigation assertions remain. |
| 14 | `sync-overlay.spec.ts` — flushing-flow lift setup used an old category selector/name | Outdated test expectation | Use the current pattern filter, plain “Deadlift”, and expand its grid; retain offline flush, spinner and layout invariants. |

The comparison also uncovered a pre-existing rendering defect in the RPE/percentage popup: it was supplied to `AnimatePresence` as a portal, so the menu never mounted. `PrescriptionEditor.tsx` now puts `AnimatePresence` inside the portal. That focused UI correction is covered by the existing RPE/percentage E2E flow. It is **not** an email-verification regression.

The full suite initially exposed an intermittent sessions-card failure outside the original 14 cases. Its target check raced the asynchronous Deadlift save and reproduced on the reference commit. The test now waits for the PUT response before checking `5 @ 8`, and it passed in the final full run. A different suite-load timeout remained at `shared-plan.spec.ts`; its immediate isolated retry passed.

## Email delivery and DNS

| Validation | Status | Evidence / limit |
| --- | --- | --- |
| Registration writes user, hashed token, and encrypted durable email job together | **PASSED locally** | Backend transactional tests; outbox uses the existing integration worker. |
| HTML, plain text, labeled link, 24-hour expiry, provider retry and cleanup | **PASSED locally** | `backend/test_email_verification.py` exercises the deterministic fake and the Resend adapter request with a mocked HTTP boundary. This is not provider delivery. |
| Concurrent processing and stale/superseded-link protection | **PASSED locally** | SQLite backend tests and PostgreSQL concurrent-claim, shared-limit, verify-winner and resend serialization tests against an isolated database/schema. |
| Expiration, reuse, resend invalidation | **PASSED locally** | Backend lifecycle tests and frontend POST-confirmation flows. |
| Real Resend API acceptance and inbox receipt | **BLOCKED** | No staging API key, verified sender domain or destination test mailbox is configured. No message was sent. |
| DNS SPF and DKIM | **BLOCKED** | There is no owned/configured staging sender domain to query, and Resend provides the exact record names and values per domain in its Domains dashboard. No DNS query or change was performed. |
| DMARC policy and delivered-header alignment | **BLOCKED** | No domain or delivered staging message exists to inspect. |
| Token absence from local API/provider-error logs | **PASSED locally** | A test captures application logs and response bodies for successful and repeated tokens; the secret token is absent. Production APM/proxy logs remain uninspected. |

The adapter targets Resend’s send-email API and includes both HTML and text with an outbox-job idempotency key. Fake-provider tests and a successful Compose configuration do **not** demonstrate sending, inbox placement or authenticated DNS. Resend requires an owned verified domain; its dashboard is authoritative for that domain’s SPF and DKIM records. For DMARC, start at `_dmarc.<sending-domain>` with a monitored aggregate-report mailbox and `p=none`; review real headers for `dmarc=pass`, then tighten only after validating all sending sources. Tracking should remain disabled for verification links.

## Google authentication

| Validation | Status | Evidence / limit |
| --- | --- | --- |
| Stable Google `sub`, verified-email requirement and token-verifier audience | **PASSED locally** | Backend tests use the official verifier boundary with controlled token claims; the code rejects false/missing verified-email claims. |
| Existing Google subject login and explicit linking/identity collision policy | **PASSED locally** | Backend authentication tests cover an existing Google user, distinct stable subjects, pending-password collision retirement without credential/data transfer, and verified-account linking policy. |
| Real staging Google login, collision and account preservation | **BLOCKED** | No staging OAuth project/client ID, browser client ID, authorized origin or real staging ID token is available. Production OAuth was not accessed or changed. |

## Telegram and coach relationships

| Validation | Status | Evidence / limit |
| --- | --- | --- |
| Signed Telegram Mini App init data and session eligibility | **PASSED locally** | Backend auth/integration tests reject forged or mock input; new tests exercise verified and legacy-exempt account sessions. |
| Telegram webhook training commands | **PASSED locally** | Tests cover pending-account denial for `/today`, `/done`, `/status` and preserve eligible legacy users' access; webhook updates can still complete a fixture workout for eligible accounts. |
| Coach invitations/linking and pending participants | **PASSED locally** | Backend tests reject pending coach/athlete linking. Existing links and workspace entitlements are checked in the migration fixture. |
| Existing training snapshots, sessions and sync/offline authorization | **PASSED locally** | Backend direct-API denial and frontend signed-capability/pending-profile tests; full offline E2E is still part of the pending full browser run. |
| Staging BotFather/Telegram Web App and webhook operation | **BLOCKED** | No separate staging bot token, Web App URL or webhook secret is configured. No production bot or webhook was contacted. |

## Migration and deployment safety

| Validation | Status | Evidence / limit |
| --- | --- | --- |
| SQLite migration preservation, repeatability and schema checks | **PASSED** | `backend/test_migrations.py` covers historical rows, relationships, subscriptions/grants, repeat upgrades, downgrade/re-upgrade and Alembic schema check. |
| PostgreSQL upgrade twice, `alembic check`, downgrade and re-upgrade | **PASSED** | Run against a new local PostgreSQL 16 validation database. |
| PostgreSQL preservation and legacy-session acceptance | **PASSED** | A seeded pre-0011 coach, athlete, stable Google subject, signed cookie session, coach relationship, workspace, subscription and access grant were snapshotted, upgraded and compared. The existing signed session authenticated under the default legacy exemption; the password timestamp stayed NULL. New password registration issued no session and login returned `EMAIL_VERIFICATION_REQUIRED`. Core data survived downgrade/re-upgrade in the disposable database. |
| PostgreSQL concurrent verification/resend/IP/outbox behavior | **PASSED** | Optional PostgreSQL suite ran within the 280-pass backend test run using an isolated schema; exactly one verification wins and replacement/claims/limits serialize. |
| Staging database backup/restore rehearsal and migration | **BLOCKED** | No staging database, staging backup, or database-provider credentials were available. Only locally created throwaway databases were used. |
| Feature flags | **PASSED locally** | Default new-account verification enabled; legacy enforcement disabled. Preflight and backend tests reject dangerous staging values and show pausing new registration does not release a pending account. |
| Production database, sessions, subscriptions or deployment | **NOT TESTED / NOT MODIFIED** | No production credential was used and no production system was changed. |

The migration preserves historical password accounts as exempt with a NULL verified timestamp; it does not fabricate historical proof. A migration downgrade is not a production rollback method after accounts/jobs depend on the new state.

## Security issues found

- **Existing UI popup bug, fixed:** the RPE/percentage menu portal was outside the animated presence tree. Moving the presence wrapper inside the portal mounts the popup while preserving its close animation.
- **No email-verification regression in the 14 original Playwright failures:** each was reproduced on the clean reference commit with the same isolated browser fixtures. Current fixes target stale selector, naming, grid-position, copy and viewport assumptions.
- **Token logging, direct API denial, legacy flag behavior, pending coach/athlete restrictions, Google collision safety, Telegram denial and encrypted payload lifecycle: PASSED in deterministic tests.**
- **Deployed access logs/APM and rate-limit behavior behind an actual staging reverse proxy: NOT TESTED.** Local Caddy configuration overwrites forwarded client IP; only a real stage host can validate the production network path.

## Outstanding dependencies

Staging validation is blocked by the missing stage host/application domain, separate PostgreSQL database and restorable test copy, deployment secret manager/profile, Resend staging key and verified sender domain, a controlled recipient mailbox, staging Google OAuth web client, and a separate staging Telegram bot. None are configured in the environment. Automated fake-provider and verifier-boundary tests cannot replace these checks.

## Actions Required From the Owner

1. **Provide or provision a separate staging host and hostname.** Point an `A` record for the chosen app hostname to the staging host (add `AAAA` only if that host is reachable over IPv6), allow inbound TCP 80/443 for Caddy, and keep PostgreSQL private to the application host. Choose a hostname outside the production OAuth, mail and Telegram setup. The Compose stack already supplies API, standalone worker, frontend/Caddy and migration services. The host must have Docker Compose and a separately managed persistent PostgreSQL database. Enable a staging database backup before migration; if historical-access validation needs realistic data, restore a protected copy into staging and verify its counts before/after. Never point staging at production PostgreSQL.

2. **Create the ignored staging env file on the staging host from the committed template.** Copy `.env.staging.example` to `.env.staging`, replace the example app/database hosts, and restrict file access (for a Linux host, `chmod 600 .env.staging`; a platform secret manager is preferred). Put all credential values in the host/platform secret manager, then inject them into the API and worker at runtime. Required variables are `DATABASE_URL`, `JWT_SECRET_CURRENT`, `INTEGRATION_ENCRYPTION_KEY`, `EMAIL_VERIFICATION_NEW_ACCOUNTS=true`, `EMAIL_VERIFICATION_ENFORCE_LEGACY=false`, `EMAIL_PROVIDER=resend`, `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM`, `EMAIL_PAYLOAD_ENCRYPTION_KEY`, `APP_DOMAIN`, and `APP_URL`. Set the exact HTTPS origin in `CORS_ALLOWED_ORIGINS`; use the same persistent email-encryption key in API and worker. Generate distinct staging-only JWT/integration/email-encryption secrets. Store offline P-256 private signing material only on the backend and its matching DER/SPKI base64 public key in `VITE_OFFLINE_AUTH_PUBLIC_KEY`; the matching public key is public build configuration. Keep Stripe and voucher billing disabled for this validation.

   Before startup, run `python scripts/check_staging_config.py --env-file .env.staging` and `docker compose --env-file .env.staging -p adaptive-lifting-staging config --quiet`. The first should report a successful configuration/key match without printing values; the second should exit 0. The current example file correctly fails the preflight because its secret and host fields are intentionally empty/placeholders.

3. **Set up Resend in its dashboard using an owner-controlled transactional subdomain**, such as `accounts.<your-domain>`, and create a staging-only sending API key. Set `EMAIL_FROM` to an address at that verified subdomain. In the DNS provider, add the **exact SPF and DKIM records Resend displays for this particular domain** (record names, types, targets/values and proxy mode); do not copy guessed values or replace an existing SPF policy. Disable click/open tracking for this verification sender. Resend’s [verified-domain guide](https://resend.com/docs/dashboard/domains/introduction) describes domain setup; the dashboard indicates verification after DNS propagates. Add `_dmarc.<sending-domain>` as a TXT record with `v=DMARC1; p=none; rua=mailto:<monitored-report-mailbox>` using a mailbox that can receive aggregate reports. Verify the records with `dig TXT <selector-or-domain>` / `dig CNAME <selector>` as appropriate, then send to an owner-controlled test inbox and inspect the received headers for `spf=pass`, `dkim=pass`, alignment, and `dmarc=pass`. Tighten DMARC to quarantine/reject only after monitoring all legitimate senders. Resend’s [DMARC guide](https://resend.com/docs/dashboard/domains/dmarc) documents the staged policy rollout.

4. **Create a separate Google Cloud OAuth Web client/project for staging.** Add the exact staging HTTPS app origin as its Authorized JavaScript origin. Put its client ID in both `GOOGLE_CLIENT_ID` and the frontend build variable `VITE_GOOGLE_CLIENT_ID`. If staging will exercise Google Sheets too, separately set a staging Sheets OAuth client/secret and register the redirect URI `https://<staging-app-host>/api/integrations/google-sheets/callback`. Use staging test users/accounts; do not change production client settings. Google documents the [Web client and authorized-origin setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

5. **Create a separate Telegram test bot.** Save its token and a random webhook secret in the staging secret manager as `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`. Configure that bot's Mini App domain/URL to the staging hostname and set only that bot's webhook to `https://<staging-app-host>/api/integrations/telegram/webhook`, supplying the configured Telegram secret-token header. Do not reuse a production bot token or webhook. Telegram documents [`setWebhook`](https://core.telegram.org/bots/api#setwebhook).

6. **Once the stage endpoint, test mailbox and staging-only service credentials are provisioned, provide access to the staging environment through the configured secret manager/deployment platform.** This task already authorizes staging validation; no extra approval or credential sharing in this conversation is needed. I can then rerun the preflight, migration, inbox, OAuth and Telegram checks. Keep `EMAIL_VERIFICATION_ENFORCE_LEGACY=false` for initial release validation.

## Production readiness

**NO - production deployment is not approved or ready from the evidence available here.** Local deterministic security, migration, worker, frontend and Docker-build checks passed, and all 14 original browser failures were shown to exist on the pre-feature reference. The 19-test focused group passed; the full E2E run ended 52/53 because of one test-49 timeout that passed in isolation. Rerun the full suite without contention, then complete the blocked real staging mail/DNS, Google, Telegram, proxy, and restore/migration smoke checks. Production deployment and migration still require separate owner authorization after staging acceptance.

### External setup references

- [Resend verified sending domains](https://resend.com/docs/dashboard/domains/introduction)
- [Resend DMARC rollout](https://resend.com/docs/dashboard/domains/dmarc)
- [Google Identity Services Web client setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)
- [Telegram Bot API `setWebhook`](https://core.telegram.org/bots/api#setwebhook)

## Local pre-commit review — 2026-09-29

All 77 files in the original implementation report's created/modified inventory are present. The staging template, preflight script/tests, documented popup correction, this staging report, and the serverless feasibility report are also included in the reviewed 84-file change set. Existing source changes were retained.

The current tracked and nonignored candidate files were scanned for provider keys, credential URLs, literal JWTs, private keys and suspicious secret assignments. No real credentials or private key material were identified. The three `.env*.example` files contain empty values or explicit placeholders; literal test credentials and the deterministic browser-test Fernet key are restricted to test fixtures. Actual `.env`, `.env.production`, `.env.staging`, database files, build outputs and browser artifacts remain ignored. Four tracked Python cache files regenerated by browser tests were restored to their pre-review versions and excluded from the change set.

| Check rerun before commit | Result |
| --- | --- |
| Full backend pytest suite, disposable SQLite | **270 passed, 10 skipped**, 139.32s. PostgreSQL suites were skipped because `EMAIL_VERIFICATION_POSTGRES_URL` and `PHASE4D_POSTGRES_URL` are unset; prior PostgreSQL evidence above remains historical. |
| Frontend unit tests | **219 passed**, 30 files. |
| TypeScript check (`npm run lint`) | Passed. |
| Production frontend build (`npm run build`) | Passed; existing large-chunk warning remains. |
| Focused Chromium verification/login/offline/shared-plan tests | **9 passed**, 41.1s, against isolated local test servers and disposable data. Includes the previous shared-plan timeout case. |
| Git whitespace and implementation-inventory checks | Passed; no missing reported implementation files. |

The complete browser suite was not rerun in this review. Real staging mail/DNS, Google, Telegram, reverse-proxy and restore checks remain outstanding. Existing short test JWT keys and TestClient dependency deprecation generated warnings. No production system, deployment, provider account, DNS or paid infrastructure was modified or provisioned.
