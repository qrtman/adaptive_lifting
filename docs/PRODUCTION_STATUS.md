# Production status

## Production rollout of launch-gap branch — 2026-11-08 (CURRENT)

**CONFIRMED:** Owner-authorized ("go production") rollout from branch `ux-and-prod-smoke` (commit c1ca390 plus the uncommitted status-doc edits) to production project `gadusaizqnshxqcckibq` and Worker `adaptive-lifting-production`.

Steps, in order:
1. Pre-migration backup: manual `db-backup.yml` run 42476078997 — success.
2. Local gates: `tsc -b` clean; vitest 504 passed / 1 skipped; `validate-production-config` PASS (66 migrations).
3. `supabase db push` applied 20261108120000_password_reset_change, 20261108130000_auth_login_account_limit, 20261108140000_coach_code_link_hardening. Vault secret `adaptive_lifting_coach_code_hmac_key` present. Run from a scratch copy of `supabase/` because the CLI cannot parse the repo `.env` (bare age key line).
4. New `CLIENT_IP_SIGNING_KEY` generated once and set on Edge secrets and the production Worker (never printed; temp file deleted). Note: the first Edge attempt failed (`secrets set` does not accept `--linked`), so the key was regenerated and set on both sides again; they match.
5. Edge functions `api` and `email-verification-worker` deployed.
6. `npm run build:production` (PASS incl. staging/private-marker scan), Wrangler dry-run, then deploy with the cutover config. Active Worker version `4201cac7-bf48-4e22-82f7-3ef7aa8bd4c5`, route `app.goatedmethod.me/*`. The generated `wrangler.production.local.jsonc` was deleted after deploy.

Post-deploy smoke (production):
- `/` 200, `/api/health` 200, `/api/auth/me` 401 unauthenticated; `/privacy` and `/terms` 200 (`.html` 307-redirects to the extensionless path) and show the support email.
- Signed client IP: a failed login sent with spoofed `X-Forwarded-For` and `x-al-client-ip` headers produced a LOGIN_FAILED audit event whose address_hash matches the real client IP.
- E2E account: login 200, `/api/auth/me` 200, JSON export 200, password change with wrong current password 400 (no change made).
- Password reset: `POST /api/auth/password/forgot` for the owner address returned 202 generic; one reset token created; outbox row `password-reset` status success, result "Password reset email accepted" (Resend). Owner to confirm the email arrived and the link works.

Still PENDING: owner confirms reset email delivery/link; merge `ux-and-prod-smoke` to `main` via PR (production now runs code ahead of `main`); optional PIPA additions to the privacy page (named privacy officer/contact, retention periods); restrict/rotate the full-access Resend key; uptime monitor; remaining a11y/screen-pass/security findings listed below.

### Legal pages finalized — 2026-11-08

**CONFIRMED:** Placeholders filled in `public/privacy.html` and `public/terms.html` (commit 5771882): operator "Bekali Gartman", governing law "the Republic of Korea", effective date "8 November 2026". The hidden "Replace every [PLACEHOLDER]" comment was removed; the "DRAFT – needs legal review" comment remains. Owner deployed with `npm run build:production` and the cutover config; active Worker version `19fb6d1a-5d49-4ba6-a926-3b928a485d12`. Readback: `/privacy` and `/terms` show the new values with no placeholders left; `/api/health` 200; temporary `wrangler.production.local.jsonc` removed.

## Staging rollout of launch-gap branch — 2026-11-08

- Owner-approved. Branch `ux-and-prod-smoke` (commit `c1ca390` plus later local changes). Production NOT touched.
- Staging project `admyuepbbtstayaydjmo`:
  - Applied 3 migrations via `supabase db query -f` and recorded them in `supabase_migrations.schema_migrations`: `20261108120000_password_reset_change`, `20261108130000_auth_login_account_limit`, `20261108140000_coach_code_link_hardening`.
  - `supabase db push` was refused because staging's migration history uses different version numbers for the original 63. The schema is equivalent.
  - Verified: 6 new/updated `al_private` functions present, Vault secret `adaptive_lifting_coach_code_hmac_key` present, table `auth_login_failures` present.
- Secrets:
  - Generated `CLIENT_IP_SIGNING_KEY` (never printed) and set it on the staging Edge (`supabase secrets`) and the staging Worker (`wrangler secret put`).
- Deployed:
  - Staging Edge functions `api` and `email-verification-worker`.
  - Staging Worker `adaptive-lifting-staging`, version `a1c7d5de-62bd-4d96-ac91-4b09a3a7e00f`, built with the staging offline public key derived from staging Vault (private key never printed).
- Checks passed on `https://adaptive-lifting-staging.gartman-bekaali.workers.dev`:
  - `/` 200. `/privacy` and `/terms` 200 (`/privacy.html` 307-redirects to `/privacy`). `/reset-password` 200. `/api/health` 200. `/api/auth/me` 401 when signed out.
  - Password forgot with an untrusted Origin: 403. Reset with a bogus token: 400 `INVALID_RESET_TOKEN`. Bad login: 400 generic. `POST /api/auth/link` unauthenticated: 401.
  - Signed-IP fix CONFIRMED: the `LOGIN_FAILED` audit rows' `address_hash` equals `sha256("auth:" + my real client IP)`, including a request carrying forged `x-al-client-ip` headers. The Worker-egress shared bucket is fixed and spoofed headers are ignored.
- Not tested on staging:
  - Password forgot returns 503 "temporarily unavailable" because staging has no email provider configured (no Resend key or sender in staging secrets). This fails closed as designed. The reset email delivery leg needs a staging email setup to test end to end.
  - Browser E2E and the prod smoke suite.
- GitHub environment `production-recovery`:
  - Secret `RESEND_API_KEY` (owner chose to reuse the full-access `.env` key).
  - Vars `ALERT_EMAIL_TO=gartman.bekaali@gmail.com` and `ALERT_EMAIL_FROM="Adaptive Lifting <no-reply@mail.goatedmethod.me>"`.
- Note: local `dist/` now holds a staging build. Production deploys must rebuild with `npm run build:production`.
- Production rollout order (pending owner approval):
  1. Same 3 migrations. Production history matches the repo, so `db push` should work.
  2. Edge secret `CLIENT_IP_SIGNING_KEY` (new value).
  3. Deploy `api` and `email-verification-worker`.
  4. Worker secret `CLIENT_IP_SIGNING_KEY`.
  5. `npm run build:production` and Worker deploy.
  6. Smoke.

### Staging end-to-end flow test — 22 passed, 0 failed

- Script: session scratchpad `stg/flowtest.sh` (not in repo).
- Fixtures: two disposable accounts (`al-staging-e2e-*@example.invalid`), a verified athlete and a coach with a 1-day `coach_beta` operator grant. Provisioned by SQL, as in `scripts/staging-authenticated-e2e.mjs`, and deleted afterwards. Cleanup verified: 0 fixture users left.
- Password change:
  - A wrong current password returns 400 and keeps the user signed in.
  - The correct current password returns 200 and revokes the session (`/me` 401).
  - The old password is rejected. The new password signs in.
- Password reset:
  - A token seeded directly in the database (staging has no email provider, so the email leg is untested) resets with 200.
  - The token is single use (second attempt 400).
  - All sessions are revoked. The new password signs in.
- Data export: `/api/export/csv` and `/api/export/json` return 200.
- Coach code:
  - Created in `XXXXX-XXXXX` format.
  - The athlete links with it (200). The response does not contain the coach email.
  - The code is single use (400 on reuse).
  - The coach unlinks the athlete (200).
  - Six bad codes all return the identical 400 "Invalid or expired code", so rate-limited and invalid responses cannot be told apart.

## Launch-gap work in progress — 2026-11-08 (NOT DEPLOYED)

Nothing in this section is live. Production is still Worker `c7f2c2ae-...`.

### Combined on branch ux-and-prod-smoke (uncommitted)

- All nine worktrees are merged into the main working tree on branch `ux-and-prod-smoke`, based on `main` `edda6c4` (includes prod-fixes PR #49). The worktrees are superseded.
- Merge fixes:
  - Login-limit migration renamed to `20261108130000_auth_login_account_limit.sql` (it clashed with `20261108120000_password_reset_change.sql`).
  - Expected migration count is now 66.
  - Password-reset routes and the coach-link rate limit use the async signed-IP helper.
  - `SecurityView` shows `ChangePasswordPanel`, `DataExportPanel` and `LegalLinks`.
- Verification:
  - `tsc` clean.
  - Vitest: 504 passed, 1 skipped.
  - Deno `_shared`: 91 passed.
  - `supabase/tests`: 32 passed.
  - `deno check` on `api` and `email-verification-worker` clean.
  - `validate-production-config` PASS (66 migrations).
  - Playwright `--list`: 53 tests (default), 8 (prod).
- Not run: browser e2e, the SQL migrations against any database, the GitHub workflows.
- Owner decisions (2026-11-08):
  - Finished sessions stay fully editable. Only a session locked by another writer is read-only (`src/features/plan/sessionReadOnly.ts`). This overrides the AGENTS.md "Finished sessions cannot mutate" line.
  - Support email is `gartman.bekaali@gmail.com` (`src/config/support.ts`, `public/privacy.html`, `public/terms.html`). `[OPERATOR_NAME]`, `[JURISDICTION]` and `[EFFECTIVE_DATE]` remain.
  - Sign-up stays open.
- Next:
  1. Owner commits and opens a PR.
  2. Staging: apply the 3 migrations; set `CLIENT_IP_SIGNING_KEY` on the Edge and the Worker; check the Vault coach-code HMAC key; deploy the `api` and `email-verification-worker` Edge functions; deploy the Worker and frontend; run the checks.
  3. Production only after owner approval.

### Committed

- `prod-fixes` (merged in PR #49): first-visit offline, phone sidebar and cards, card menu clipping, stray proxy cookie strip.

### Worktrees

Paths are under `.claude/worktrees/`. File lists come from `git -C <path> status -s` on 2026-11-08. Every change listed is uncommitted.

| Worktree | Contains | Status | Merge notes |
| :--- | :--- | :--- | :--- |
| `agent-ae5bbfa8cfdfec84e` (base `316bcfc`) | Voucher access refresh (keeps access across reconnect and user switch). Readable conflict card: camelCase labels, per-reason copy, names the session/lift/set via new `src/services/conflictTarget.ts`. | Done. 56/57 tests pass. The one failure is the $29 locale test, already fixed on `prod-fixes`. | Touches `SyncContext.tsx` (overlaps `a5ed99e`) and `api.ts` (overlaps `ab017c1`). |
| `agent-ac69b212ec21f79b6` (base `316bcfc`) | Production Playwright suite `e2e/prod/`, `playwright.prod.config.ts`, `npm run test:e2e:prod`. | Review fixes done: coach unlink only on the test coach's side, no cookie values in output, fresh-context persistence checks, loads `E2E_*` from `.env`. Never run against production. | Edits `package.json` and `playwright.verification.config.ts`. |
| `agent-aa05fc6429a86e028` | Backups: post-upload size check in `db-backup.yml`; new `backup-alert.yml` (workflow_run, Resend email on non-success); new `restore-drill-reminder.yml` (monthly issue). | Not run on GitHub. | Needs environment `production-recovery`: secret `RESEND_API_KEY`; vars `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM`. |
| `agent-a2363ab73235d637a` | Draft `public/privacy.html` and `public/terms.html`; `LegalLinks` on login and Security; support line in coach billing; `src/config/support.ts`. | Placeholders unfilled: `[SUPPORT_EMAIL]`, `[OPERATOR_NAME]`, `[JURISDICTION]`, `[EFFECTIVE_DATE]`. Needs owner/legal review. | Overlaps `SecurityView.tsx`, `CoachBillingPanel.test.tsx`, `cloudflare/worker.test.ts`. |
| `agent-a84d9ba2ca7fe102d` | "Download my data" CSV/JSON in Security via `DataExportPanel`; `VITE_INTEGRATIONS_ENABLED` flag (off in production by default) hides Integrations; Telegram "Not available yet" state. | Tests added. Staging also defaults to off. | Overlaps `SecurityView.tsx`, `App.tsx`, `Sidebar.tsx`. Also edits `.env.*.example` and `scripts/validate-production-config.mjs`. |
| `agent-ab017c1c80379c97d` | Password reset and change: `passwordRoute.ts` (+ test), migration `20261108120000_password_reset_change.sql`, `PasswordResetView`, `ChangePasswordPanel`. | Done. Deno 81 and vitest 453 pass; SQL not executed. | Migration timestamp clashes with `a844e58d`; rename one. Overlaps `onboardingRoute.ts` (`a844e58d`), `api.ts` (`ae5bbfa8`), `index.html` (`a5ed99e4`). |
| `agent-a5ed99e49d533db8d` | A11y batch: finished-session read-only lock (`sessionReadOnly.ts`, `lockedWorkoutIds` from `SyncContext`), calendar opens on the real month, calendar keyboard and touch access, zoom re-enabled, `CenteredDialog` fixes, aria labels. | Done. 446 unit tests pass; e2e not run. | Overlaps `SyncContext.tsx` (`ae5bbfa8`), `App.tsx` and `Sidebar.tsx` (`a84d9ba2`), `index.html` (`ab017c1c`). |
| `agent-a844e58d9b1567ef7` | IP signing (`x-al-client-ip` HMAC, `clientIp.ts`) and per-account login limit. Touches `config.ts`, `billingRoute.ts`, `accountSecurityRoute.ts`, `onboardingRoute.ts`, `cloudflare/worker.ts`. Migration `20261108120000_auth_login_account_limit.sql`. | Done. Vitest 452 pass; Deno and SQL not executed. | Migration timestamp clashes with `ab017c1c`; rename one. Overlaps `onboardingRoute.ts` (`ab017c1c`). |
| `agent-a4c65c72ac7ccc172` | Coach-code hardening; no `access_token` in response bodies. Migration `20261108140000_coach_code_link_hardening.sql`. | Done. Deno 84 and vitest 447 pass; SQL not executed. | Apply the migration and deploy `api` together. |

Merge notes:

- The main checkout's uncommitted list also shows `package.json`, `playwright.verification.config.ts`, `e2e/prod/`, `playwright.prod.config.ts`, `ConflictReviewCard`, `AccessContext` and `api.ts`. Reconcile these with the worktrees before merging so no change is applied twice.
- `ae5bbfa8` and `ac69b212` branch from `316bcfc`, before PR #49. Rebase or check them against `edda6c4`.

### Worktree results (2026-11-08)

- **Migration timestamp clash:** `ab017c1c` (`20261108120000_password_reset_change.sql`) and `a844e58d` (`20261108120000_auth_login_account_limit.sql`) share `20261108120000`. Rename one (e.g. `20261108130000`) before merge.
- **Migration count:** three worktrees set the count to 64 in `scripts/validate-production-config.mjs` and `cloudflare/productionConfig.test.ts`. The true final count is 66.
- **Accessibility (`a5ed99e4`, done):** finished sessions are read-only. Calendar opens on the real month. 13 e2e specs are pinned to 15 Sept 2026 via `pinCalendarClock` in `e2e/helpers.ts`. Not run.
  - Open owner question: should a finished session's date and labels also be locked?
- **Password reset (`ab017c1c`, done):** forgot, reset and change routes in `passwordRoute.ts`. Migration `20261108120000_password_reset_change.sql`. SQL not executed.
  - Deploy: migration, then `api` and `email-verification-worker` Edge functions, then frontend.
- **IP signing and login limit (`a844e58d`, done):** the Worker signs `x-al-client-ip` with HMAC, and `clientIp.ts` verifies it. Secret `CLIENT_IP_SIGNING_KEY` is needed on both Worker and Edge. Wrangler configs now require it. Per-email login limit: 10 failures per 15 min, dummy bcrypt, `LOGIN_FAILED` audit. SQL not executed.
  - Deploy order: Edge secret, Edge deploy, migration, Worker secret, Worker deploy.
- **Coach codes (`a4c65c72`, done):** 10-character codes, Vault HMAC key, single use with 15-min expiry. Limits are 5/min and 20/h per account and per IP. Errors are generic. The coach email is not returned. `access_token` is removed from response bodies. Migration `20261108140000_coach_code_link_hardening.sql`. SQL not executed.
  - Apply the migration and deploy `api` together.

### Production screen pass (2026-11-08, read-only, athlete account with no sessions)

- Integrations cards clip their buttons at 360px.
- Athletes see the Sheets panel error "Could not load your active athlete roster" (roster 403).
- Insights editor overflows at 360px and shows raw ids (`avg_intensity`, `inol`, `acwr`, `e1rm` instead of e1RM/INOL/ACWR). Insights "Del" has no confirm. Titles truncate on phone.
- Telegram and Sheets panels hardcode dark colours in light mode.
- Compare menu is clipped at 360px.
- Security shows an enabled "Unlink coach" with no coach linked, and an unbounded device/session list (about 13 devices from E2E logins).
- New session date defaults from UTC (wrong day in KST before 09:00).
- Login page ignores the saved dark theme.
- The first Escape in the New session dialog is swallowed.
- Service worker registration error when the registration is missing.
- Fixed in the a11y worktree: the calendar Sept-2026 bug and phone calendar actions.
- Screenshots are in the session scratchpad `screenpass/shots` (not in repo).
- Not covered: session grid, roster, billing (needs a coach account).

### Launch blockers (readiness review)

- No privacy policy or terms in production. Drafts are in `a2363ab7`, unreviewed.
- No account deletion. No worktree covers it.
- No password reset. In progress in `ab017c1c`.
- No support contact. Drafted in `a2363ab7`; owner address pending.
- Data export not wired in UI. Built in `a84d9ba2`.
- No uptime monitor or client error reporting.
- Telegram/Sheets visible but unconfigured. Hidden in production by the flag in `a84d9ba2`.
- Revoke the full-access Resend key.
- Consider Turnstile on sign-up.
- Confirm the daily backup keeps Supabase from pausing.

### Security audit (2026-11-08): two launch blockers

1. All users likely share one IP rate-limit bucket. The Worker proxy makes `cf-connecting-ip` the Worker's egress IP, so one attacker can lock out logins, drop signups and block voucher redeems. Not yet confirmed on staging. Fix in `a844e58d`.
2. Coach codes can be brute-forced: 6 hex characters, unsalted hash, 365-day expiry, no rate limit on `/api/auth/link`, and the response reveals whether a code is valid. Fix in `a4c65c72` (no changes on disk yet).

Also open:

- No per-account login limit or failed-login audit.
- Sheets OAuth state is not bound to the session that started it.
- The session token is returned in the response body.
- No RLS backstop on public tables.
- Workout locks apply only to sync.
- Request lists are uncapped.
- All SECURITY DEFINER functions were checked: `search_path` fixed, EXECUTE revoked. Ended links are blocked. CSRF origin checks hold.

### Owner decisions pending

- ~~Support address.~~ Resolved 2026-11-08: `gartman.bekaali@gmail.com`.
- ~~Keep sign-up open, or set `EMAIL_ONBOARDING_ENABLED=false` until legal pages and password reset are live.~~ Resolved 2026-11-08: sign-up stays open.
- ~~Finished sessions read-only (open question in `a5ed99e4`).~~ Resolved 2026-11-08: finished sessions stay editable; only a session locked by another writer is read-only.
- Uptime monitor on `/api/health`.

### DNS

- Owner chose to leave the `app` record as is.

### Accessibility audit findings not yet addressed

- Phone tap targets under 44px in the set grid.
- No plan loading/error state in Calendar/Sessions.
- No persistent online/offline indicator or last-sync indicator.
- Expanded sidebar squeezes content at 360px.
- Telegram terminal steppers are not buttons, and they hide errors.
- Set delete has no confirm or undo.

### Security findings not yet addressed

- Sheets OAuth state not bound to the session.
- No RLS/default-privilege backstop on public tables.
- Workout locks only enforced in sync.
- Uncapped request lists.
- Pre-registration of a victim's email.
- Inconsistent 404/403 leaks.
- `decodeURIComponent` 500s.
- Unlink-snapshot date-text comparison.
- Device revoke not enforced.
- Sync upsert can un-delete sets.
- Runtime role can read all Vault secrets.

## Untested-areas pass — 2026-11-08

Latest Worker version `c7f2c2ae-d44e-48c8-a6fe-2db90164aa15` (owner-approved deploy) adds the
phone session-card fix below. Earlier versions in this section: `bf948840-...`, `2d9c2c2d-...`,
`47140e32-...`.

- **Session-card text overlap on phones (FIXED, DEPLOYED, verified on production):** with a
  logged set the Plan/Log columns shrank to 0 width and the non-wrapping text ("182.5 x 5")
  ran over the e1RM/Tonnage column. Columns now use `minmax(min-content, ...)` in
  `src/components/SessionsView.tsx`. Verified in a fresh 360 px browser: card 276 px wide, no
  overlapping or overflowing children, no page-level horizontal scroll. Desktop card unchanged.
  Note: the phone sidebar default only applies to browsers with no stored preference; a phone
  that already opened the app keeps its stored (expanded) sidebar until the user collapses it.
- **Realtime (DECIDED: stays off, not a launch dependency):** the web client contains no Realtime
  subscription code (no websocket or channel use; only server-side token issuance and tests exist),
  so turning on `REALTIME_TOKENS_ENABLED` would change nothing for users. Cross-device sync works
  through the pull/sync path (verified with two devices above), and conflicts are surfaced.
  Revisit only if live push is wanted: it needs client subscription code plus the signing-key
  setup, token issuance, private-subscription and revocation tests listed under PENDING below.
- **DNS record `app` (NOT CHANGED, needs owner action):** still a proxied CNAME to the deleted
  tunnel; harmless because the Worker route answers the hostname. The Wrangler login has no DNS
  scope, and an attempt to attach the Worker as a Custom Domain (which would replace the record)
  was refused by the permission classifier. To tidy: set `app.goatedmethod.me` to a proxied
  `A 192.0.2.1` in the dashboard (do not delete it), or add a DNS-Edit token as
  `CF_DNS_API_TOKEN` in `.env` so it can be done and verified from here.

Worker version `bf948840-afb3-4e65-b28f-6385761df7a4` (deployed with the owner's
explicit approval) ships the offline first-visit precache, the collapsed phone sidebar,
the card-menu fix and the foreign-cookie strip. Verified on production with Playwright:
360 px viewport starts with `data-sidebar=collapsed` and 300 px content width; a first
visit followed by offline reopen shows the sign-in screen (2 `/assets` files precached);
no `Domain=supabase.co` Set-Cookie reaches the browser; the first-row card menu's Delete
passes click actionability. Test sessions deleted afterwards.

Browser checks against https://app.goatedmethod.me with the E2E account (service
worker allowed, which real users always have; the earlier smoke test blocked it).

- **FIXED and DEPLOYED (Worker version `47140e32-2b9f-48f3-a235-89bfe30e485c`):**
  first-time visitors could lose their sign-in. On a first visit the new service
  worker took control and `registerAppServiceWorker` reloaded the page 1-2 s in,
  wiping the form or aborting a sign-in in flight. Measured before: 3/6 logins
  failed with the service worker on, 6/6 ok with it blocked. After: 6/6 ok both.
  Fix: reload on `controllerchange` only when a previous worker was already
  controlling the tab (`src/services/serviceWorkerRegistration.ts`, test added;
  returning users keep the update reload).
- **PWA:** manifest `/manifest.webmanifest` serves 200; service worker registers
  and activates with scope `/`.
- **FIXED and DEPLOYED (Worker version `2d9c2c2d-7bda-4c65-8d63-6f39de8368e6`):
  offline sign-in.** Closing the app and reopening it with no network used to show
  the sign-in screen because production had no offline-grant keys. Set Edge secret
  `OFFLINE_AUTH_PRIVATE_KEY` (fresh P-256 key, generated and set by a script that
  printed nothing; no copy kept, the server only needs it there) and built with
  `VITE_OFFLINE_AUTH_PUBLIC_KEY` read from the gitignored `.env.production`. Verified
  on production: `/api/auth/me` returns `offlineGrant`, and after sign-in plus one
  online reload, a closed-and-reopened app with the network off shows the signed-in
  app. **If the key is ever rotated, set the new private secret and rebuild with the
  matching public key in `.env.production`, or offline sign-in silently stops.**
  Grants last up to 24 h by design.
- **KNOWN GAP:** a brand-new visitor who goes offline before any second online
  visit sees a blank page, because the service worker only caches files it fetched
  itself and the first page load happens before it takes control. Fix would be to
  precache the built asset files in `public/sw.js`.
- **KNOWN GAP (FIXED, DEPLOYED and verified):** a brand-new visitor who goes offline
  before any second online visit saw a blank page. `public/sw.js` now precaches the
  `/assets/*` files named in `index.html` at install time.
- **Mobile layout (FIXED, DEPLOYED and verified):** at 360/390 px the desktop sidebar
  used about 60% of the width. On a first visit with a viewport under 768 px the
  sidebar now starts collapsed (`src/App.tsx`); a stored user choice still wins.
- **Session-card menu clipped (FIXED, DEPLOYED and verified):** the "..." menu's
  Delete item was hidden behind the next row of cards. The card holding an open
  menu now gets `z-30` (`src/components/SessionsView.tsx`).
- **Two devices, same account (VERIFIED on production):** device B sees device A's
  work; A edits offline while B edits online, then A reconnects: server answers 409
  `STALE_REVISION`, A shows the "Sync conflict needs review" dialog (server vs your
  edit, Keep Server / Export my edit, the offline edit stays saved on the device),
  and both devices end on the server value. Note: the dialog shows raw JSON, which
  is not coach-friendly (UI follow-up).
- **Test data:** all `E2E smoke*` sessions were deleted afterwards.
- **Billing test** no longer depends on the machine locale (`CoachBillingPanel.test.tsx`).
- **Coach-athlete linking (VERIFIED on production, owner-approved test data):** with a
  throwaway coach account that had a 1-day `coach_starter` access grant: coach generated a
  6-character code; athlete entered it and linked; coach roster showed the athlete; coach
  created a session on the athlete's plan and the athlete saw it; athlete unlinked, coach
  roster no longer showed the athlete, athlete kept the session ("plan stays with the
  athlete"). All test sessions, the coach account, workspace, membership, grant, invite
  code, relationship and history snapshot were deleted afterwards (production back to
  1 user). The test coach's `E2E_COACH_*` lines were removed from `.env`.
- **DECIDED and VERIFIED, coach access = vouchers (owner chose vouchers over Stripe):**
  Created Vault secrets `adaptive_lifting_voucher_code_secret` (random 64 hex chars, no
  copy kept) and `adaptive_lifting_voucher_billing_enabled=true`, and set Edge secret
  `VOUCHER_BILLING_ENABLED=true` (the Edge value overrides Vault; it was off, so redeem
  returned 503 `VOUCHER_UNAVAILABLE`). Proven end to end on production with a throwaway
  coach: register, operator verify + promote, operator-issued 1-day voucher, redeemed in
  Security, Generate code enabled and an invite code created. All test rows deleted.
  Stripe stays off (`STRIPE_BILLING_ENABLED` false); `/api/billing/plans` 503 is expected.
  **Operator procedure to onboard a coach** (run with `supabase db query --linked --yes`
  from outside the repo directory, see the `.env` note below):
  1. Coach registers and verifies their email in the app.
  2. `select al_private.al_operator_promote_coach('<email>');`
  3. `select al_private.al_billing_operator_create_voucher('<email>','coach_starter',<days>,<valid_days>,'<payment ref>','<notes>');`
     returns the one-time code (`VCH-XXXXX-XXXXX-XXXXX-XXXXX`); deliver it securely, it is
     not stored in plaintext and cannot be shown again.
  4. Coach pastes it under Security, Billing, "Have a voucher?", then reloads the page.
  Known UI nit: right after redeeming, the page still shows "Coaching access inactive"
  until a reload.
- **Dead Tunnel (DONE):** deleted tunnel `adaptive-lifting-prod` (was down, 0 connections);
  site still 200, `/api/auth/me` 401 when signed out. Do NOT delete DNS record `app`: the
  Worker route needs a proxied record for the hostname. It is now a proxied CNAME to the
  deleted tunnel and is harmless. Optional tidy-up needs a DNS-Edit token (the Wrangler
  login cannot edit DNS): change it to a proxied `A 192.0.2.1` placeholder.
- **Registration:** the owner chose to keep it open (athletes can sign up and log now).
- **Stray Supabase cookie (FIXED, DEPLOYED and verified):** the Worker now drops upstream
  `Set-Cookie` headers scoped to `Domain=supabase.co` (`__cf_bm`), which browsers reject
  anyway. Test added in `cloudflare/worker.test.ts`; it fails without the change.

## Database backups — 2026-11-08

**CONFIRMED:** Daily encrypted backup is live and a restore was proven.

- Workflow `.github/workflows/db-backup.yml` (PR #48), daily 03:17 UTC and
  `workflow_dispatch`, runs under environment `production-recovery`. It does
  `pg_dump` (PG17 client, custom format, schemas `public`, `al_private`,
  `supabase_migrations`, `auth`) over the Session Pooler with `verify-full`,
  streams it into `age` (recipient = repo variable `RECOVERY_AGE_RECIPIENT`),
  uploads to R2 and deletes backups older than 30 days. No unencrypted file is
  written. This replaces the unused, inventory-gated `recovery-daily-backup.yml.template`
  pipeline for now.
- R2 location: bucket `adaptive-lifting-production-recovery`, key
  `production/gadusaizqnshxqcckibq/recovery/daily/db-<UTC stamp>.dump.age`.
  The R2 keys cannot write to `goatedmethod-production-backups` (AccessDenied),
  so environment variable `RECOVERY_R2_BUCKET` was changed to the recovery bucket.
- `production-recovery` no longer has a required reviewer (so scheduled runs are
  unattended); the `main`-only branch policy remains.
- First run: ~657 KB encrypted. Restore drill (`scripts/recovery/restore-drill.sh`):
  decrypted with the owner's private key (matches the repo recipient) and restored
  into PostgreSQL 17 in Docker; row counts match production (users 1, workouts 12,
  exercise_sets 10, sync_mutations 14). Only error: `schema "public" already exists`
  (harmless). `auth.users` is 0, the app uses `public.users`.
- Not in the dump: Supabase Vault secrets, Edge Function secrets, Cloudflare
  settings, Resend config. Recreate by hand after a disaster.
- The age private key lives only in the owner's gitignored `.env` (plus whatever
  copy the owner keeps). Losing it makes all backups unreadable.
- Known gap: the Supabase CLI cannot parse `.env` while it holds a bare
  `AGE-SECRET-KEY-1…` line; run it with `--workdir` from another directory, or move
  the key out of `.env`.

## Hostname cutover — 2026-11-08

**CONFIRMED:** Owner-authorized deploy of Worker `adaptive-lifting-production`
(account `05a07c48f5e8e3afb784e11931502508`) with the exact route
`app.goatedmethod.me/*` (zone `goatedmethod.me`), using the cutover config with
project ref `gadusaizqnshxqcckibq`. Active version
`462d5577-fd31-4136-b133-2edd192c1a57`. Built with `npm run build:production`;
`validate:production:local` and a Wrangler dry-run passed first; type check and
432 tests passed (one billing test is locale-dependent, see below). No DNS record
was changed: the existing proxied `app` record is overridden by the Worker route.

Pre-cutover readback: `app.goatedmethod.me` returned Cloudflare 530/1033 because
Tunnel `adaptive-lifting-prod` (`744f508c-41d1-44f1-bc89-de5dd6abd914`, status
down) pointed at a retired local origin (`127.0.0.1:8088`) and served only this
hostname. The Worker had no routes or custom domains.

Post-deploy smoke checks (unauthenticated, no accounts created):
`/` 200 (app); `/api/health` 200 `{"status":"ok"}`; `POST /api/auth/register`
503 (registration still disabled); `/api/auth/me` 401. The deploy reported
Preview URLs disabled by default, replacing the earlier "Version URLs enabled
behind Access" state; not separately re-verified.

Still **PENDING / NOT TESTED:** production email sender and enabling
registration; private Realtime; browser end-to-end on the live origin
(cookie/CSRF/session); backup/restore (free Supabase tier, no managed backups);
retiring the dead Tunnel and its DNS record (cleanup only); security/monitoring
checks. Public launch is not authorized. Known test note: `CoachBillingPanel`
asserts `$29.00` and fails when `LC_ALL` is a non-US locale such as `en_AU`
(component is correct; test should pin `en-US`).

**Email sender progress — 2026-11-08:** Owner-authorized. Resend domain
`mail.goatedmethod.me` (id `5e020c74-bffb-412f-aa41-af8fa12b1c58`, region
`ap-northeast-1`, open/click tracking off) was created via the Resend API using
a key the owner stored in the gitignored `.env`. Using an owner-created
Cloudflare token (Zone DNS Edit, `goatedmethod.me` only), five DNS-only records
were added: DKIM TXT `resend._domainkey.mail`, SPF MX and TXT on `send.mail`,
CNAME `rsend.mail`, and TXT `_dmarc.mail` (`v=DMARC1; p=none;`). Resend then
reported the domain **verified** (DKIM and SPF records all verified). Existing
records were not changed. Real-inbox header authentication (SPF/DKIM/DMARC pass)
is NOT TESTED.

**Vault secrets — 2026-11-08:** Owner-authorized ("you write them"). Seven
Vault secrets were created in one SQL run on project `gadusaizqnshxqcckibq`:
`adaptive_lifting_email_payload_encryption_key` (generated Fernet-format key),
`adaptive_lifting_resend_api_key` (new Resend **sending-only** key limited to
`mail.goatedmethod.me`, key id `5be6be4b-9692-49d4-b0f7-58afb31fd136`),
`adaptive_lifting_email_from` (`Adaptive Lifting <no-reply@mail.goatedmethod.me>`),
`adaptive_lifting_email_app_url` (`https://app.goatedmethod.me`),
`adaptive_lifting_email_worker_edge_url`, `adaptive_lifting_email_worker_publishable_key`
and `adaptive_lifting_email_worker_internal_secret` (generated). Verified by name
and creation time only (the CLI role cannot decrypt; values were never printed
or stored in the repo). Existing readback: `pg_cron`, `pg_net`, `supabase_vault`
installed; cron job `email-verification-edge-worker` active (`* * * * *`).
The `RESEND_API_KEY` in `.env` is a full-access key; revoke or restrict it after
setup.

**Email worker deploy — 2026-11-08:** Owner-approved (exact command) deploy of
Edge Function `email-verification-worker` (v1, ACTIVE, `verify_jwt=false`) to
`gadusaizqnshxqcckibq` via `supabase functions deploy --use-api --no-verify-jwt`.
The first attempt failed at bundling (no change to the project) because the
function lacked an import map; a new `supabase/functions/email-verification-worker/deno.json`
(same `@db/postgres` and `jose` pins as `api`) fixed it. `api` is unchanged (v3).
CONFIRMED: before deploy, cron requests returned 404; at 2026-11-07 16:10 UTC
(2026-11-08 local) the `email-verification-edge-worker` job reached the function
and got HTTP 200 `{"status":"ok","claimed":0,...}` (no jobs queued).

**Registration opened for controlled test — 2026-11-08:** Owner-authorized.
`EMAIL_ONBOARDING_ENABLED=true` was set as a production Edge secret. An empty
`POST /api/auth/register` now returns 422 (field required) instead of 503, so the
gate is open to the public internet. Controlled test mailbox:
`gartman.bekaali@gmail.com`. **If the test fails or is not finished promptly, set
`EMAIL_ONBOARDING_ENABLED=false` again.**

**Controlled registration result — 2026-11-08:** The owner registered the test
mailbox, received the verification email, confirmed it and logged in.
CONFIRMED by read-only database query: 1 user, 1 verified, newest verification
token consumed and not invalidated. This establishes end-to-end delivery and
verification on the real path. CONFIRMED from the owner's Gmail "Show original":
spf=pass (smtp.mailfrom `send.mail.goatedmethod.me`), dkim=pass with
`d=mail.goatedmethod.me` (aligned), dmarc=pass (`p=NONE`); the message has a
plain-text part and the token only in the URL fragment, no tracking. CONFIRMED
by the owner: reusing the consumed link fails. Resend on the already-verified
account sent no email, which matches the documented generic no-send behavior for
verified addresses (so it is not a defect). Not done / NOT TESTED: resend
invalidating a prior link (needs a second, unverified account), link expiry, rate
limits, deployed-log check for token/URL capture, delivery monitoring.
Registration remains open (`EMAIL_ONBOARDING_ENABLED=true`) pending the owner's
decision to keep or close it.

**Production browser smoke test — 2026-11-08:** Headless Chromium (Playwright,
service workers blocked; script kept outside the repo) against
`https://app.goatedmethod.me` with the owner's account. CONFIRMED: login works;
the only cookie is `session_id` (HttpOnly, Secure, SameSite=Lax, 7-day Max-Age);
session survives reload; create session, add Deadlift, online log of kg/reps
returns sync 200 with an empty mutation queue; offline log queues, reconnect
flushes with sync 200; values persist after reload; sign out; no 5xx responses.
**FINDING (open):** if the user goes offline within seconds after an online sync
and edits the same exercise, the offline flush returns 409 `SYNC_CONFLICT_REVIEW`
(`STALE_REVISION`, client `base_revision` 2 vs server 5): the client does not take
the new revision from the sync response and relies on the later
`sync-server-state-restored` refresh (`src/services/sync_engine.ts`). Waiting 4 s
before going offline made it pass. The repo's e2e tests mock the sync call, so
they do not cover this. **Fix DEPLOYED and verified (2026-11-08):** Owner-approved redeploy of Worker
`adaptive-lifting-production` (version `c2e6e292-7f2b-48d5-b2c8-53b1ffce0bd8`,
route `app.goatedmethod.me/*`, built from commits `39018a2` and `ca9aa65`; `/` and
`/api/health` return 200). With no settle delay the offline-edit smoke test passed
3 of 3 runs: after reconnect the sync responses were 409, 409, 200, no
conflict reached the user, the queue emptied and values persisted. Note that two
automatic re-bases were needed (cap is 3); if a flow ever needs more, the user would
see a conflict card, so watch for it. Test data was deleted afterwards. Also: a
`CLOUDFLARE_API_TOKEN` (DNS-only) left in the project `.env` made Wrangler fail
with "Authentication error 10000" because Wrangler auto-loads `.env`; it was
removed. Keep deploy credentials out of `.env`.
Original analysis and fix description follow. `sync_engine.ts`
now re-bases an edit and retries once the server reports `STALE_REVISION` but the
server's values for every field the edit changes still equal the values it was
based on (a self-conflict); real differences still go to conflict review, with a
cap of 3 re-bases per edit (new `rebase_count` on stored mutations). Seven new
tests cover it, including a flow test built on the captured production 409 body
(typecheck clean, 439 tests pass, production build passes). NOT TESTED: service-worker/PWA behaviour, mobile layout,
a second user/coach link, multi-device conflict. Test data (6 `E2E smoke`
sessions) was created and then deleted; the account has no sessions. Other
notes: the Worker passes through a Supabase `__cf_bm` Set-Cookie with
`Domain=supabase.co` (browsers ignore it; worth stripping); the session card
shows overlapping text for a logged set ("100 × 5 @ 8" over the e1RM line). `EMAIL_ONBOARDING_ENABLED` remains false. The key in
`.env` can manage domains; use a separate sending-only key for Vault.

Sections below are dated history. Where they say the hostname cutover is
pending or the Worker has no public address, this section supersedes them.

## Request admission verification — 2026-10-28

The maintenance admission patch in [draft PR #47](https://github.com/qrtman/adaptive_lifting/pull/47)
now passes [native PostgreSQL protocol checks](https://github.com/qrtman/adaptive_lifting/actions/runs/40541430859)
and [repository CI](https://github.com/qrtman/adaptive_lifting/actions/runs/40541440938)
at code commit `016a239af26e9760976efc9df19b366705264fe3`: 27 Node checks,
66 shared Edge tests, three entrypoint typechecks, and 17 PostgreSQL assertions.
The bundled real Deno driver rejects post-termination writes/reconnect and admits
a fresh request; independent container and executable cleanup passed.

This resolves the native fixture implementation failure. Production remains
unchanged and capture is disabled. Guarded deployment/version retirement,
Data API closure, provider/admin drain verification, production CLI integration,
Vault/application dependencies, sequence reconciliation and two complete
isolated restores remain unfinished. Dashboard computer access was denied by
the tool; no setting was changed. See the [detailed evidence](recovery-request-gate-2026-10-27.md).
The historical checkpoints below do not supersede this update.


## Recovery database connection verified — 2026-10-22

The owner-approved [hosted connection test](https://github.com/qrtman/adaptive_lifting/actions/runs/39770197340)
passed using the protected `production-recovery` database password and CA.
Password authentication, certificate/hostname verification (`verify-full`), client
TLS, expected database and role, PostgreSQL 17, a read-only transaction and normal
temporary-file cleanup all passed. The check read no application rows and issued
no database writes. See [the evidence and limits](recovery-db-connectivity-2026-10-22.md).

This verifies source connectivity only. Encrypted production capture, fresh-job
retrieval, isolated restore, dependency recovery and measured RPO/RTO remain
**NOT TESTED**; the owner-only recovery rehearsal has not passed. This check did
not activate capture, scheduling or retention and did not change the deployed API.

**Authoritative continuation checkpoint — 2026-10-17**

**Continuation branch:** `main` after the repository consolidation PR is merged.
Historical deployments below retain their original branch and commit identifiers.

**Last verified production API release commit:**
`367fa8a1ddb7329086ce0e9afb17a93a5d040da9`

**Project:** `gadusaizqnshxqcckibq` (Seoul / `ap-northeast-2`)
**Status source:** owner-provided release history and dated read-only
Cloudflare/Supabase readbacks. Each section distinguishes historical release
evidence from later configuration readbacks.

Use this page for changing production facts. Use
[the architecture](../architecture.md) for stable system decisions and
[the cutover runbook](../supabase/PRODUCTION_CUTOVER.md) for release procedures.

## Repository consolidation — 2026-10-18

Recovery, staging E2E, production bootstrap, and main histories are consolidated
for review on the existing recovery branch. See [repository state](repository-state.md)
for the exact source tips and cleanup rules. This is a source-history operation;
it does not change the deployed API, Worker, database, or release gates below.
Staging validation and synthetic recovery workflows are manual-only on `main`.
Prepared production backup and monitor workflows are inert templates outside
`.github/workflows/`; their schedules cannot activate by merging this PR.

## Confirmed completed

- Production Supabase project `gadusaizqnshxqcckibq` is in Seoul.
- Production PostgreSQL was initialized. All 63 SQL migrations were applied
  and validated. **Do not bootstrap the project or reapply these migrations.**
- The restricted application database runtime role is configured. Its
  restricted login was tested against the production Session Pooler with
  `sslmode=verify-full`; client-to-pooler TLS 1.3 and the Supabase CA hostname
  check passed. The role and connection details are not repeated here.
- The production `api` Edge Function was deployed. Its health endpoint returned
  HTTP 200 with `{"status":"ok"}`.
- Safe direct API smoke checks returned: unauthenticated protected route HTTP
  401; registration while onboarding is disabled HTTP 503; Realtime token route
  HTTP 503; untrusted mutation Origin HTTP 403; disabled billing webhook HTTP
  503; and unavailable Google sign-in HTTP 503.
- One synthetic login attempt with spoofed forwarding headers returned HTTP
  400. Full rate-limit enforcement and trusted-ingress behavior remain
  **NOT TESTED**; that response alone does not prove rate-limit enforcement.
- All 13 required production configuration names were verified present.
  Name-only inspection did not verify their values or prove every runtime path.
- The deployed API release includes the Supabase API bundling fix at the
  verified commit above.

### Production Cloudflare Worker deployment — 2026-10-17

- **CONFIRMED:** Deployed `adaptive-lifting-production` from branch
  `production-bootstrap`, release commit
  `3d4dd591a94116a7fc1eb1e5c487a4b284a973cb`, in account
  `05a07c48f5e8e3afb784e11931502508` (Gartman.bekaali@gmail.com's Account).
- Wrangler 4.149.0 reported a successful upload of 10 static assets at
  `2026-10-17T10:47:32.850655Z`. Worker version
  `1e0c6269-0794-4068-b0f0-ffb901d35883` is active at 100% in deployment
  `2c3b2d0e-20bf-45f6-a91b-64c21b993a9c`.
- Deployed config: Worker-only `wrangler.production.local.jsonc`, origin
  `https://gadusaizqnshxqcckibq.supabase.co`, Static Assets from `dist/`,
  SPA fallback and `/api/*` Worker-first routing. The config omits `routes`
  and `custom_domains`; `workers_dev` is false. At deployment-time readback,
  the workers.dev subdomain and preview/version URLs were disabled. See the
  current configuration readback below; preview/version URLs were enabled
  later, without changing the production Worker version.
- Read-only post-deploy checks found no Worker route in the `goatedmethod.me`
  zone and no custom domain for `app.goatedmethod.me`. DNS, Tunnel, staging,
  Supabase settings, and database configuration were not changed.
- Production validation, local config validation, production build, full test
  suite (432 passed, 1 skipped), lint, audit (zero vulnerabilities), and
  `npx wrangler deploy --config wrangler.production.local.jsonc --dry-run`
  passed before deployment. Browser E2E was not run because this route-free
  Worker has no public address; production-origin cookie and CSRF behavior
  remain unverified in a browser.

## Pending and blocked gates

- **BLOCKED / NOT TESTED:** Production-origin browser end-to-end validation is
  incomplete. The Worker remains without a production hostname route or custom
  domain, and its general `workers.dev` route is disabled. Version URLs are
  enabled and a Cloudflare Access application is configured for preview
  traffic, but Access enforcement has not been independently tested. Treat the
  Version URL as internet-routable until unauthenticated denial is verified.
  No local HTTPS origin-preserving harness is implemented or verified.
  Production-origin cookie/CSRF and authenticated session behavior remain
  unverified. Do not enable onboarding or create synthetic production accounts
  under existing authorization.

### Production preview endpoint configuration — read-only check 2026-10-17

A fresh Cloudflare API readback confirmed the production Worker deployment
remains version `1e0c6269-0794-4068-b0f0-ffb901d35883` at 100%, with the
production Supabase origin, Static Assets, SPA fallback, and `/api/*`
Worker-first routing. Its general `workers.dev` route is disabled, while
Version URLs are enabled. The account has no Worker custom-domain bindings;
the `goatedmethod.me` zone's Worker route list is empty in the current
read-only check. No production hostname route, DNS record, or Tunnel
configuration was changed for this test path.

The Worker has a Cloudflare Access application named
`adaptive-lifting-production - Cloudflare Workers`, targeting the
`preview_worker` destination only. Its attached reusable Allow policy,
`Cloudflare Workers Preview URLs`, includes only
`gartman.bekaali@gmail.com` and has no Exclude or Require selectors. Cloudflare
readback reports one application using that policy. This documents the
configured rule; it does not prove enforcement. Unauthenticated denial and
authenticated operator access have not been independently tested, and no
production-origin browser smoke test has been run. The Version URL is enabled
and internet-routable, so keep the production browser acceptance gate
**BLOCKED / NOT TESTED** until enforcement and the required browser conditions
are exercised safely. Do not use the route-free state as evidence that the
Version URL is inaccessible.

An earlier read-only preflight on 2026-10-17 observed Access and Version URLs
disabled and could not read billing profile/subscription details because the
API identity lacked permission. The current readback shows Zero Trust and the
preview Access application are now configured; the earlier observation is
historical, not current state. No local HTTPS harness is implemented. No DNS,
Tunnel, production hostname route, Worker version, staging, or Supabase
configuration was changed as part of that preflight or this documentation
update.

Cloudflare documents that enabled Version URLs are publicly routable unless
protected by Access and that Access can target a Worker's preview deployments
([Version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/),
[Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)).
Use the account's current Access policy readback above as configuration
evidence only; browser enforcement remains untested.

If this temporary test path is later retired, disable Version URLs for this
Worker and verify `previews_enabled=false` before removing its Access
application attachment. Then verify the general `workers.dev` route remains
disabled and recheck Worker custom domains and the `goatedmethod.me` route
list. Do not delete the reusable preview policy if another application uses
it. Recheck DNS and Tunnel state separately; neither is part of this test
endpoint's teardown.
- **DONE 2026-11-08 (see top section):** Hostname Worker-route cutover. Original text: Recheck and perform the existing hostname Worker-route cutover
  only after separate authorization. Preserve current DNS and Cloudflare
  Tunnel routing until then.
- **PENDING:** Verify a production email sender and worker dispatch, then run
  controlled end-to-end onboarding tests. Registration remains disabled.
- **PENDING:** Configure private production Supabase Realtime signing and
  verification, then test token issuance, private subscription, and revocation
  end to end. Realtime token issuance remains disabled.
- **BLOCKED / NOT TESTED:** Establish an independent encrypted production
  PostgreSQL backup and complete a restore into a genuinely isolated target.
  Owner-selected target architecture: GitHub Actions with Cloudflare R2 Standard;
  AWS is rejected. This is a design decision only. No bucket, lifecycle rule,
  credentials, production capture, or schedule is configured or authorized.
- **Recovery engineering checkpoint — 2026-10-18:** Work remains on
  `test/production-recovery-gate`, starting from `a063b570504279af5e1c3ebb090c3350e9584252`.
  `SYNTHETIC_RECOVERY=PASS` was verified on commit
  `f9a9da0bec6872c0b224e50af85a16bf7ea10837` by hosted run
  [39111285578](https://github.com/qrtman/adaptive_lifting/actions/runs/39111285578).
  This continuation adds fail-closed catalog and archive-TOC comparison helpers,
  synthetic lifecycle checks, archive cleanup on snapshot failure, and failure-path
  workflow cleanup verification. Local and hosted verification are 81/81 recovery
  tests and TypeScript lint PASS; the hosted drill and independent cleanup step also
  passed. These helpers do not collect a complete production inventory or establish
  a real backup/restore. `PRODUCTION_RECOVERY=BLOCKED / NOT TESTED`; production data
  and credentials have not been accessed.
- **PENDING:** Complete final security, monitoring, recovery, and operational
  checks.
- **NOT AUTHORIZED:** Public launch or public traffic cutover.

## Operational constraints

- Keep email onboarding, Realtime token issuance, and billing disabled until
  their respective gates pass and separate activation approval is given.
- Google sign-in is unconfigured and unavailable; do not configure it without
  its separate provider and redirect review.
- Keep existing DNS, Cloudflare routes, and Tunnel behavior unchanged until
  cutover is explicitly authorized.
- Do not rerun production bootstrap or the 63 completed migrations. Do not
  modify staging as part of production continuation.
- Do not infer secret correctness from secret-name presence. Never copy
  credential values into this repository or documentation.
- No public launch has been authorized.

## Evidence labels

**CONFIRMED** means an observed result or owner-provided release evidence
recorded above, with the date and scope preserved where known. **PENDING** means
work remains. **BLOCKED** means a prerequisite prevents safe completion.
**NOT TESTED** means there is no accepted evidence. **HISTORICAL** means a past
result or proposal that does not describe present state. For new deployments,
update this page only with dated evidence: exact target and commit, action,
result, test scope, and any limits. Do not promote a proposal or a secret-name
check into a verified production result.
