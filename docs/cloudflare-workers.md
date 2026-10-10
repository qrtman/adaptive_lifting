# Cloudflare Workers Static Assets

Cloudflare Workers Static Assets is the frontend host. The isolated staging
Worker is `adaptive-lifting-staging` at
<https://adaptive-lifting-staging.gartman-bekaali.workers.dev>.

## Staging deployment

The first staging deployment used the Workers Free quota confirmed by the
account owner. It did not create paid resources, a custom domain, or a
production route. Supabase staging remains project `admyuepbbtstayaydjmo`.

From the repository root, verify Wrangler is logged into the intended account,
build, and check the asset bundle before deploying:

    npx wrangler whoami
    npm ci
    npm run build
    npx wrangler deploy --dry-run
    npx wrangler deploy --message "staging deployment"

The checked-in `wrangler.jsonc` names only `adaptive-lifting-staging`, binds
`dist/` as Workers Static Assets, uses SPA fallback, and routes `/api/*` through
the same-origin proxy to the Supabase staging project. Do not add a production
route or custom domain to this config.

Deployed checkpoint:

- URL: <https://adaptive-lifting-staging.gartman-bekaali.workers.dev>
- Version: `a57abdff-8e50-40b2-b97b-e484f4729cee`
- Source: `db1daddf8313209f87a4f732f355b31d66ad5f89`
- Initial HTTP and browser smoke: root, deep route, JS/CSS assets, service
  worker, and `/api/health` passed. Health identified the expected Supabase
  staging ref and returned `Cache-Control: private, no-store`.

To run the Node-based browser smoke against the deployed Worker after building,
run:

    $env:STAGING_URL = "https://adaptive-lifting-staging.gartman-bekaali.workers.dev"
    node scripts/cloudflare-staging-smoke.mjs

This Playwright runner does not start the retired local FastAPI test server.
Authenticated checks require a disposable staging account and the Supabase
staging origin configuration described below.

### Supabase origin and security settings

The Supabase staging API now accepts the exact Worker origin. A browser
preflight from the deployed app returned 204 with that exact
`Access-Control-Allow-Origin` and credentials enabled. A preflight from
`https://attacker.example` returned 405 without an allow-origin header. The
Worker preserves `Origin` and `Referer` on proxied requests.

The staging owner previously confirmed **Enable Data API: Off** in the
Dashboard; the latest staging audit records the REST and GraphQL endpoints as
unavailable. Production settings were not changed.

The initial authenticated live check found a blocking cookie configuration
issue: `Secure` was absent and cross-origin logout returned 200. The staging
owner corrected the Edge Function configuration, and the final security gate
below supersedes that initial result. The shared mutation-origin guard was
deployed to the staging API Edge Function; the Worker itself was not changed
or redeployed.

At the time of this initial audit, APP_URL-dependent redirects could not be
observed: Stripe checkout and Google Sheets OAuth returned their expected
fail-closed 503 responses because those providers were unconfigured, and the
email delivery worker was not configured to send verification links. The
management surface did not expose Edge Function environment values. The
staging owner has since reported the intended APP_URL; that value remains
owner-reported until verified through an actual provider flow. Keep providers
disabled until that separate validation is complete.

### Initial live staging validation — 2026-10-09 (superseded)

Validation used Node Playwright against the deployed workers.dev URL and the
Supabase staging Edge API. It did not start FastAPI or modify or redeploy the
Worker.

| Check | Result and evidence |
| --- | --- |
| Static assets and SPA | PASS — React root and deep link returned 200; both loaded JS/CSS assets returned 200 and deep-link refresh rendered the app shell. |
| PWA | PASS — `/sw.js` registered and the service worker activated with root scope. |
| Same-origin API proxy | PASS — `/api/health` returned 200, identified project `admyuepbbtstayaydjmo`, and included `Cache-Control: private, no-store`. |
| Credential scan | PASS — built assets contained none of the checked private credential variable names; checked-in Wrangler config contains only the staging Supabase project origin. |
| Login, session, logout | PASS — password login and logout returned 200; `/api/auth/me` returned the same athlete after refresh and 401 after logout. |
| Cookie security | FAIL at initial check — `HttpOnly` and `SameSite=Lax` were present; `Secure` was absent. Corrected and rechecked in the final security gate below. |
| Authenticated training | PASS — synthetic athlete read microcycles, created a session and lift, wrote sets, then read the canonical training tree. |
| Coach/athlete boundaries | PASS — linked coach read and updated the athlete's session; unrelated coach and athlete reads/writes returned 403. A repeated coach-code link was rejected as already linked. |
| CSRF/origin protection | FAIL at initial check — the authenticated cross-origin logout probe returned 200 while `COOKIE_SECURE` was effectively off. Corrected and rechecked in the final security gate below. |
| Private Realtime | PASS — browser WebSocket joined the exact private synthetic workout channel using the 60-second app-issued Realtime token. |
| Provider fail-closed | PASS — Stripe plans/checkout and Google Sheets OAuth returned 503 while unconfigured; no provider redirect URL was issued. |
| Synthetic cleanup | PASS — 3 test users, 34 app sessions, 10 workouts, 8 exercises, 16 sets, verification/outbox records, coach link/workspace/grant/invites, audit rows, and test rate-limit events were removed. Post-cleanup prefix checks were zero, and all 41 public foreign keys had zero orphan rows. |

Regression checks after the live run: `npm.cmd test` passed 356 tests with one
skipped; `npm.cmd test -- cloudflare/worker.test.ts` passed all 5 Worker tests;
and `npm.cmd run build` passed. The build retains its existing warning for a
JavaScript chunk over 500 kB. The deployed browser smoke passed assets, SPA
fallback, service worker, health, and unauthenticated `/api/auth/me`; rerun it
with `node scripts/cloudflare-staging-smoke.mjs` after `npm run build`.

At the initial check, cookie and CSRF failures blocked authenticated use.
`APP_URL`-based redirects were not observable because the relevant providers
were disabled. See the final staging security gate below for the corrective
Edge deployment and current verification status.

### Final staging security gate — 2026-10-09

The staging owner reported the API Edge Function configuration as
`COOKIE_SECURE=true`, `APP_ENV=staging`,
`APP_URL=https://adaptive-lifting-staging.gartman-bekaali.workers.dev`, and an
exact HTTPS origin allowlist. Runtime cookie, CORS, health, and session tests
were performed against the deployed URL. The management interface used here
does not return Edge Function environment values, so `APP_ENV` and `APP_URL`
could not be independently read back. Provider-dependent redirects were not
available to observe because those integrations are disabled; keep this as an
explicit provider-validation gap, not a failed application test. The core
Cloudflare staging application and authenticated browser validation passed.

The shared CSRF/origin policy is enforced before application route dispatch
for POST, PUT, PATCH, and DELETE. It allows exact allowlisted origins, rejects
`Origin: null`, missing or mismatched Origin/Referer, and does not use
forwarded headers. Originless server-to-server Bearer requests remain
compatible. Stripe and Telegram webhook routes retain their independent
signature/secret checks. GET and HEAD behavior is unchanged. API Edge Function
version `101` deployed this change to staging project
`admyuepbbtstayaydjmo`; the Cloudflare Worker remained at version
`a57abdff-8e50-40b2-b97b-e484f4729cee`.

Node Playwright and direct HTTP checks against the real workers.dev origin
passed: `/api/health` returned 200 for the staging project; login returned
200; `session_id` carried `HttpOnly; Secure; SameSite=Lax; Path=/`; `/api/auth/me`
remained authenticated after refresh and returned 401 after same-origin
logout. A cross-origin logout using the real cookie returned 403 and the
original session still authenticated. Thirteen cross-origin mutation cases
covering auth/profile, session create/update/delete, set logging, notes,
analytics, voucher redemption, and realtime token returned 403 without
persisted changes. Same-origin training reads/writes, linked coach access,
outsider denial, private Realtime channel join, PWA service-worker activation,
and fail-closed provider responses passed. REST and GraphQL generated endpoints
remained unavailable (HTTP 503/PGRST002), corroborating the owner-confirmed
Data API Off setting.

Classification: `CLOUDFLARE_STAGING_CORE=PASS`,
`COOKIE_SECURITY=PASS`, `CSRF_ORIGIN_VALIDATION=PASS`, and
`AUTHENTICATED_BROWSER_E2E=PASS`. `APP_URL_CONFIGURATION=OWNER_REPORTED`,
`APP_URL_RUNTIME_READBACK=UNAVAILABLE`, and
`APP_URL_PROVIDER_REDIRECT_E2E=NOT_CONFIGURED_STAGING`.
`PROVIDER_ACTIVATION_READINESS=REQUIRES_SEPARATE_VALIDATION`: verify APP_URL
through an actual provider flow before enabling that provider.
`PRODUCTION_CUTOVER=NOT_AUTHORIZED`.

Disposable athlete, coach, and outsider fixtures were removed. Post-cleanup
checks found zero synthetic users, sessions, workouts, exercises, sets, notes,
coach links, audit rows, verification/outbox records, workspaces, grants,
security events/subjects, or voucher limit rows. All 41 public foreign-key
checks had zero orphan rows.

The live validation commands were `node scripts/cloudflare-staging-smoke.mjs`,
the temporary authenticated Node Playwright CSRF runner, `npm.cmd test`,
`npm.cmd test -- cloudflare/worker.test.ts`, `npm.cmd run build`, and the
Supabase Edge tests (69 passed with Deno `--no-check`; focused changed tests
passed 11). The temporary credential-bearing runner was removed after the
test. Full npm suite: 356 passed, 1 skipped. Build passed with its existing
large-chunk advisory. Deno type-check still reports the previously known
WebCrypto `BufferSource` diagnostics in `fernet.ts` under Deno 2.9.

Rollback is staging-only. Roll back the Worker only if its own version changes:

    npx wrangler rollback a57abdff-8e50-40b2-b97b-e484f4729cee --name adaptive-lifting-staging

If the Edge API change must be reverted, use Supabase Dashboard project
`admyuepbbtstayaydjmo` to restore API Function version `100`, or redeploy the
reviewed version-100 source to that project. Do not change production.

### Rollback

For a later staging update, return to a known-good Worker version with:

    npx wrangler rollback a57abdff-8e50-40b2-b97b-e484f4729cee --name adaptive-lifting-staging

For a future release, record its known-good version ID and use that ID in the
rollback command. The initial deployment had no earlier Worker version; this
version becomes the rollback target after a later update. Rollback affects only
this staging Worker; it does not revert Supabase settings or database changes.

## Routing

Vite builds the React application to dist/. Wrangler serves matching files
directly from Static Assets and uses single-page-application handling for
navigation paths without a matching file. Worker-first routing is limited to
/api/*, so normal asset requests do not execute Worker code.

The Worker accepts same-origin API path shapes and constructs the upstream URL
from the configured Supabase project origin plus /functions/v1/api/<path>.
The origin must be HTTPS and match a Supabase project hostname. Request input
cannot choose the upstream host. Missing or invalid configuration fails
closed.

For API requests, the Worker preserves method, path, query, body, Origin,
Referer, Cookie, Authorization, content headers, response status, body, and
response headers. It removes hop-by-hop and client-supplied forwarding headers,
then adds private no-store cache directives to requests and responses. Separate
Set-Cookie headers are preserved, including HttpOnly, Secure, SameSite=Lax,
and Path attributes. Upstream transport failures return an uncached 502.

Set SUPABASE_PROJECT_ORIGIN as a Cloudflare Worker runtime variable in each
environment. If the Supabase Edge gateway requires an apikey header, set
SUPABASE_PUBLISHABLE_KEY as a Worker runtime variable. This is a public
publishable key, not a service-role key. Neither variable belongs in Vite
settings or the browser bundle.

The Worker does not implement application logic or use D1, KV, R2, Supabase
Auth, or another database. Realtime connects directly to Supabase. Stripe and
Telegram provider webhook URLs remain direct Supabase Edge endpoints at
/functions/v1/api/billing/stripe/webhook and
/functions/v1/api/integrations/telegram/webhook; they do not need the browser
Worker route.

## Local preview

Install dependencies with npm ci and build the frontend:

    npm run build

Create a local, ignored .dev.vars file beside wrangler.jsonc:

    SUPABASE_PROJECT_ORIGIN=https://<confirmed-project-ref>.supabase.co
    # Optional only when the Edge gateway requires it:
    SUPABASE_PUBLISHABLE_KEY=<public-publishable-key>

Keep provider tokens and other secrets in their owning services. Start the
local Workers preview with:

    npm run preview:cloudflare -- --ip 127.0.0.1 --port 8787

Then check a static asset, the SPA fallback, and the root PWA service worker:

    curl -I http://127.0.0.1:8787/
    curl -I -H "Sec-Fetch-Mode: navigate" http://127.0.0.1:8787/verify-email
    curl -I http://127.0.0.1:8787/sw.js

A GET to /api/health reaches the configured Supabase Edge function. Preview
should use a confirmed project origin only when intentionally exercising that
read-only health route. Without a configured origin, the Worker returns 500;
an unreachable upstream returns 502.

Worker unit tests run with npm test. Wrangler dry-run can validate the Worker
bundle and Static Assets manifest without uploading or deploying:

    npx wrangler deploy --dry-run

No production or staging Supabase database is touched by these checks.

## Staging offline conflict release — 2026-10-10

Release commit `d72a45dd1e72a11059fb9622f44eff445d3b7a18` was deployed to the
existing staging project `admyuepbbtstayaydjmo` and Worker
`adaptive-lifting-staging` at
`https://adaptive-lifting-staging.gartman-bekaali.workers.dev`. Migration
`20261010120000_workout_offline_conflict_revisions` was applied from its
checked-in SQL after a pre-change schema/data checkpoint. The exact version was
then recorded with targeted Supabase migration repair. The ledger contains 63
entries; the preceding 62 version/name pairs were verified unchanged. The
release migration SHA-256 was
`A3E3B2842D806D9792A7E89AB5592681CE3968D4688A4FAA1301167BE413681B`.

The `api` Edge Function is version `103`. The Cloudflare Worker is version
`0d4bc0a0-3399-4354-b1b5-c2d977753b11`. The Worker still serves the Vite static
assets and routes only `/api/*` to the staging Supabase origin. No Worker
secret or private credential is part of the frontend build.

The live Node Playwright regression used two isolated browser contexts on the
workers.dev origin. Both authenticated with the custom session cookie, whose
`HttpOnly`, `Secure`, `SameSite=Lax`, and `Path=/` attributes were asserted.
Device A queued an edit at exercise revision 16 while offline. Device B saved
a newer value, advancing the revision to 18. On reconnect, the API returned
HTTP 409 `STALE_REVISION`; the canonical server value remained `130`, while
the queued `125` edit remained in IndexedDB. The conflict survived refresh,
export retained the original mutation, and confirmed Keep Server persisted
`RESOLVED_SERVER` locally without changing the canonical value. A schema-v1
mutation without a baseline returned HTTP 409 `BASELINE_REQUIRED`, remained
recoverable, and did not change the server value. Cross-origin logout returned
403 while `/api/auth/me` remained authenticated; same-origin logout then
revoked that session.

Post-deployment static smoke passed: JS/CSS assets returned 200, the
`/verify-email` SPA route loaded, the root service worker activated,
`/api/health` reached the staging project with `private, no-store`, and
unauthenticated `/api/auth/me` returned 401 with `private, no-store`. The
private Realtime channel flow had passed its separate live staging validation
and its route was not changed by this release. External providers remain
disabled pending their separate `APP_URL` redirect tests.

After verification, the disposable staging account and its 38 sessions,
workout, exercise/set, microcycle, eight client devices, eight sync mutation
records, verification token, queued verification job, and eight workout domain
events were removed. Scoped counts returned to zero. Existing staging user,
session, workout, audit, and outbox totals returned to their pre-release
values. Migration 63 remains applied.

The migration changes the API function contract. If a release problem occurs,
halt staging writes while assessing it and use a reviewed forward fix. Do not
assume that restoring only the prior Edge Function or Worker restores
compatibility with migration 63. Verify live authenticated reads, writes, and
conflict recovery before resuming writes. Production and DNS were untouched.

## Production Worker preparation (not deployed)

`wrangler.production.jsonc` is a separate production-only Worker configuration:
`adaptive-lifting-production`, Static Assets from `dist/`, SPA fallback, and
the same `/api/*` proxy to a required production Supabase project origin. The
origin is deliberately `https://REQUIRED_PRODUCTION_PROJECT_REF.supabase.co`;
the production project does not exist yet, and the committed config fails
closed. It contains no service-role/publishable key, JWT or provider secret and
has `workers_dev` disabled. The staging `wrangler.jsonc` and existing Worker
remain unchanged.

The production Vite build sets `VITE_CLIENT_DATA_GENERATION=production-fresh-v1`.
On `app.goatedmethod.me`, the app opens a separate IndexedDB database and uses
a namespaced localStorage keyspace. It does not migrate old IndexedDB records,
offline grants, device IDs, or queued mutations. New mutation records are
scoped to the authenticated account, and account switches hide the prior
account's pending/conflict UI. Staging keeps its existing database and
legacy-migration behavior. The production service worker has a distinct cache
identity and checks for updates before continuing under a newly activated app.

Validate it and build an isolated production frontend with:

```text
npm run validate:production
npm run build:production
npm test -- cloudflare/productionConfig.test.ts
```

The build leaves API calls relative to the production hostname and scans the
result for the staging Supabase origin, staging Worker URL and private
credential markers. Browser code does not currently configure a direct
Realtime WebSocket client; private token issuance remains under `/api`, and
any future browser Realtime client must derive its `wss://<production-ref>.supabase.co`
endpoint from the same verified production project, never staging. The Worker
proxies only HTTP `/api/*` requests and does not proxy WebSockets.

After production provisioning and a separate deployment approval, generate an
ignored local Wrangler config from the committed template:

```text
node scripts/prepare-production-wrangler.mjs <verified-production-project-ref>
npm run build:production
npm run validate:production:local
npx wrangler deploy --config wrangler.production.local.jsonc --dry-run
```

Then, only after separate production release authorization, deploy the exact
reviewed commit with the same config. The generator rejects the staging ref
and writes no cloud resources. Inspect the generated origin and selected
Cloudflare account before any deploy; record the resulting Worker version for
rollback. Restore a recorded previous production Worker version for code
rollback; do not remove the hostname route unless a live alternate origin has
been confirmed. Use `npx wrangler versions list --config
wrangler.production.local.jsonc --name adaptive-lifting-production` to record
available versions, then `npx wrangler rollback <recorded-version-id>
--config wrangler.production.local.jsonc --name adaptive-lifting-production`
for a Worker-only rollback. This does not roll back database migrations or
guarantee an older API is schema-compatible; API rollback requires a separately
reviewed database compatibility decision.

### Existing hostname and future connection procedure

A read-only Cloudflare zone/DNS/routes inspection on 2026-10-10 found the
`goatedmethod.me` zone active, `app.goatedmethod.me` on a proxied CNAME to a
Cloudflare Tunnel hostname, and no Worker route for the app hostname. No DNS,
route, Worker or zone setting was changed. The prepared production config uses
a route (`app.goatedmethod.me/*`) rather than a Custom Domain, preserving the
current DNS record. Cloudflare documents that Custom Domains cannot be created
while a hostname has an existing CNAME; do not delete/replace the current
record as part of this preparation. See Cloudflare's
[Custom Domains limitations](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
and [Worker Routes configuration](https://developers.cloudflare.com/workers/configuration/routing/routes/).

Future connection steps, after separate approval: verify the zone/account and
current DNS record again; confirm the old Tunnel target and any route ownership
with the domain owner; dry-run and deploy the verified production
Worker/config, which attaches the exact app-host route while preserving the CNAME;
verify TLS, SPA,
PWA, `/api/health`, cookie origin and no-store responses; then monitor and keep
the prior Worker version available. The CNAME points to historical tunnel
infrastructure, so route precedence and rollback behavior must be confirmed
in a controlled cutover. The app domain is not attached to staging.
