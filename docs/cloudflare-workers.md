# Cloudflare Workers Static Assets

Cloudflare Workers Static Assets is the selected frontend host. This repository
prepares a local configuration only; it does not create Cloudflare resources or
deploy a Worker.

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
