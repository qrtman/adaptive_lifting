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

### Supabase origin gate

The deployed Worker preserves the browser's `Origin` and `Referer` so the
Supabase API can apply its existing CSRF checks. The staging API currently
accepts `http://localhost:3000` but does not allow the Worker origin. Before
authenticated browser checks, append the exact workers.dev origin to the
staging API's `CORS_ALLOWED_ORIGINS` value, preserving every existing entry and
without wildcards. Set staging `APP_URL` to this exact origin if the current
staging setting points elsewhere. Keep `COOKIE_SECURE=true`; session cookies
must remain HttpOnly, Secure, and SameSite=Lax. These settings must be changed
in the Supabase staging project only. The deployment session had no Supabase
secret-management or Dashboard write surface, so this gate remains pending.

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
