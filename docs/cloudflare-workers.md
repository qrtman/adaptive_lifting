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

APP_URL-dependent redirects could not be observed during this run: Stripe
checkout and Google Sheets OAuth returned their expected fail-closed 503
responses because those providers are unconfigured, and the email delivery
worker is not configured to send verification links. The authenticated
Supabase management surface in this session does not expose Edge Function
environment values, so `APP_URL` also needs owner confirmation in the staging
Dashboard. Set and verify these values in staging only; production remains
untouched.

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

The staging owner confirmed the API Edge Function configuration as
`COOKIE_SECURE=true`, `APP_ENV=staging`,
`APP_URL=https://adaptive-lifting-staging.gartman-bekaali.workers.dev`, and an
exact HTTPS origin allowlist. Runtime cookie, CORS, health, and session tests
were performed against the deployed URL. The management interface used here
does not return Edge Function environment values, so `APP_ENV` and `APP_URL`
could not be independently read back. Provider-dependent redirects were not
available to observe because those integrations are disabled; keep this as an
explicit evidence gap.

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
