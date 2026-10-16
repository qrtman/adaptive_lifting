# Supabase runtime

Supabase Edge Functions and PostgreSQL are the sole active application backend.
The API, email verification worker, Google Sheets worker, and scheduled jobs run
through Edge Functions and Postgres Cron/pg_net. Supabase Realtime provides the
live update channel. Cloudflare Workers Static Assets is the selected frontend
host. Staging is deployed at
`https://adaptive-lifting-staging.gartman-bekaali.workers.dev`. The production
API is deployed and its initial health/security checks passed; the Cloudflare
production Worker and hostname route remain pending. See the
[authoritative production status](../docs/PRODUCTION_STATUS.md).

The existing custom app authentication remains in use: an HS256 application
JWT backed by the sessions table, a separate ES256 offline grant, and a
separate ES256 Realtime token. Supabase Auth is not adopted. Training rows
remain athlete-owned.

## Route and data boundaries

The API Edge handler has explicit method/path dispatch for account and
security, coach access, sessions and exercise/set writes, Workout Sync,
analytics, Insight Cards, day notes, exports, integrations, billing, health,
and Realtime token issuance. Unknown routes return 404. Browser roles have no
direct application table access or private schema usage. The Edge runtime uses
restricted, route-specific PostgreSQL interfaces.

Stripe and Telegram provider webhooks remain direct Supabase Edge endpoints.
The frontend Worker proxies same-origin browser API traffic only. Realtime
WebSocket traffic connects directly to Supabase.

See [STAGING_VALIDATION.md](STAGING_VALIDATION.md) for historical staging
evidence; it does not establish current production state. The
[PRODUCTION_READINESS_AUDIT.md](PRODUCTION_READINESS_AUDIT.md) is a superseded
planning audit and its bootstrap gap and launch checklist are not current.

## Migrations and local checks

The checked-in timestamped Supabase SQL migrations are deployment deltas, not a
complete clean-database application schema bootstrap. The production project
has already received its audited baseline and all 63 migrations; do not replay
or repair them. The bootstrap baseline and guarded deploy script are retained
for historical evidence and any separately approved, genuinely empty future
target only. Staging's initial reconciliation recorded 62 version/name pairs;
the later forward-only workout revision migration was applied and recorded
separately. The audit reconciled 24 historical migration version-prefix
mismatches and one harmless ordering swap between independent migrations. No
production or staging migration replay is authorized by this documentation.

    cd supabase
    deno check functions/api/index.ts tests/auth_test.ts tests/routes_test.ts
    deno test tests/auth_test.ts tests/routes_test.ts
    cd ..
    npm test
    npm run lint
    npm run build

Python under backend/ remains a compatibility reference and parity-test
source; it is not part of the active frontend/API runtime. Cloudflare Workers
Static Assets preview instructions are in docs/cloudflare-workers.md.
