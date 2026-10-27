# Production status

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
- **PENDING:** Recheck and perform the existing hostname Worker-route cutover
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
