# Production status

**Authoritative continuation checkpoint — 2026-10-17**

**Branch:** `production-bootstrap`

**Last verified repository/release commit:**
`367fa8a1ddb7329086ce0e9afb17a93a5d040da9`

**Project:** `gadusaizqnshxqcckibq` (Seoul / `ap-northeast-2`)
**Status source:** owner-provided release history in the current launch record;
items below are not a fresh live inspection by this documentation update.

Use this page for changing production facts. Use
[the architecture](../architecture.md) for stable system decisions and
[the cutover runbook](../supabase/PRODUCTION_CUTOVER.md) for release procedures.

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
  and `custom_domains`; `workers_dev` is false. Cloudflare readback reports
  the workers.dev subdomain and previews disabled.
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

- **PENDING:** Complete browser end-to-end validation of the production build
  and API before public launch. A non-public test path must be established;
  do not change the production hostname route just to test it.
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
  The backup method is undecided. R2/GitHub hosted proposals, VeraCrypt/local
  approaches, and other experiments are not approved architecture.
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
