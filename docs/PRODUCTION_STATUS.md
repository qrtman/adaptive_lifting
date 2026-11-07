# Production status

## Hostname cutover — 2026-11-08 (CURRENT)

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
