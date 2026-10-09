# Supabase runtime

Production API routes are handled by `functions/api`, with narrow private SQL
interfaces in `al_private`. Scheduled email and Sheets work runs through the
private `email-verification-worker` and `google-sheets-worker` Edge Functions
with Postgres Cron/`pg_net` dispatch. The frontend uses same-origin `/api`
paths; the production Caddy host rewrites these to `/functions/v1/api/...`.
There is no production FastAPI, Python worker, or Python database process.

The project keeps the existing custom app authentication: an HS256 app JWT and
`sessions` table, a separate ES256 offline grant, and a separate ES256 Realtime
token. Supabase Auth is not adopted. Training rows remain athlete-owned.

## Route and data boundaries

The API Edge handler contains explicit method/path dispatch for account and
security, coach access, microcycles and session/exercise/set writes, Workout
Sync, analytics, Insight Cards, day notes, exports, integrations, billing,
health, and Realtime token issuance. It does not forward unknown paths to a
legacy service; unmatched routes return 404. The former local/demo login and
SSE handler are not deployed. FastAPI's schema/docs endpoints are not exposed.

Runtime access is through route-specific functions and the restricted
`al_edge_catalog_runtime` database role. Browser roles have no direct
application table access or private schema usage. Private operator voucher
functions are unavailable to browser and runtime roles. See
[`STAGING_VALIDATION.md`](STAGING_VALIDATION.md) for the route reconciliation,
staging evidence, current project posture, and known provider configuration
gates.

## Migrations and local checks

The checked-in SQL migration files are the deployment source. Apply them in
lexical version order to a clean target project and compare the applied history
to the release manifest. Staging retains historical version identifiers for
21 matching migration names; the staging report records the mapping and the
single harmless ordering swap between the independent email retry and day-note
migrations. Do not rewrite staging migration history.

```sh
cd supabase
deno check functions/api/index.ts tests/auth_test.ts tests/routes_test.ts
deno test tests/auth_test.ts tests/routes_test.ts
cd ..
npm test
npm run lint
npm run build
```

Python under `backend/` remains the authoritative compatibility reference and
test source; it is not a production runtime dependency. The production
frontend host and rollback preparation are documented in
[`PRODUCTION_CUTOVER.md`](PRODUCTION_CUTOVER.md).
