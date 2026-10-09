# Supabase runtime

Supabase Edge Functions and PostgreSQL are the sole active application backend.
The API, email verification worker, Google Sheets worker, and scheduled jobs run
through Edge Functions and Postgres Cron/pg_net. Supabase Realtime provides the
live update channel. Cloudflare Workers Static Assets is the selected frontend
host; the repository configuration is being prepared and has not been deployed.

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

See STAGING_VALIDATION.md for staging evidence, route reconciliation, and
provider configuration gates. Historical records there are not rewritten.

## Migrations and local checks

The checked-in SQL migrations are the deployment source. Staging has all 62
migration names. The completed audit reconciled 24 historical migration
version-prefix mismatches and recorded one harmless ordering swap between the
independent email retry and day-note migrations. No staging migration history
was rewritten or replayed.

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
