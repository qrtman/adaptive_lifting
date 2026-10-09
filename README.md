# Adaptive Lifting

Adaptive Lifting is an auto-regulatory periodization app for coaches and
athletes. The training plan remains athlete-owned; linked coaches receive
shared access through the coach-code relationship flow.

## Runtime architecture

Supabase Edge Functions and PostgreSQL are the sole active application backend.
Private database interfaces, Postgres Cron/pg_net, and Supabase Realtime
support API requests, workers, scheduled jobs, and live updates. The custom
application authentication remains separate from Supabase Auth: HS256 app
JWTs use the application sessions table; offline grants and Realtime tokens
use separate ES256 keys.

Cloudflare Workers Static Assets is the selected frontend host. It serves the
Vite bundle directly with SPA fallback and invokes a small Worker only for
same-origin /api/* requests. That Worker forwards to the Supabase api Edge
Function. This repository prepares the configuration but does not deploy it.

See architecture.md for application contracts and supabase/README.md for the
Supabase runtime and migration layout.

## Local development

Install dependencies with npm ci, set API_EDGE_TARGET to the Supabase project
origin, then run Vite:

    API_EDGE_TARGET=https://<project-ref>.supabase.co npm run dev

Vite proxies every /api/* request to the corresponding
/functions/v1/api/* Edge path, preserving credentials and request data. If
API_EDGE_TARGET is missing, API requests return an explicit configuration
error; they never fall back to a Python server. The Python implementation
under backend/ is retained for compatibility and math parity tests only.

## Frontend hosting

The app is built to dist/. Wrangler configuration uses Cloudflare Workers
Static Assets, SPA fallback, and selective Worker-first routing for /api.
Realtime stays connected to Supabase directly. Stripe and Telegram provider
webhooks continue to use Supabase Edge endpoints directly. Configure only
public Vite build values; all application secrets remain in Supabase Edge/Vault
configuration. Never put private keys, database credentials, provider secrets,
or app signing keys into the frontend build.

See docs/cloudflare-workers.md for preview and configuration details and
supabase/PRODUCTION_CUTOVER.md for release preparation. No deployment or
production cutover is performed by this change.

## Checks

    npm test
    npm run lint
    npm run build

Python compatibility tests remain under backend/; Supabase Edge tests and
migrations are under supabase/
