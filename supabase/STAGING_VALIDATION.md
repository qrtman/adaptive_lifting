# Isolated staging validation runbook

Target only the existing Free project named `adaptive-lifting-staging` in
`ap-northeast-2`. Confirm its actual project ref in the Supabase Dashboard or
official MCP/CLI account listing before any SQL, secret, setting, or deploy
operation. The foundation commit is `c37ebfe373b11c843707e17a13bbe26178ed5d93`;
`local-save` at `29c81fb395c62cc2ac3c775d2a7d8ef3106d9328` is frozen.
No script here guesses a project ref or reads production credentials.

## Restricted database credential

Apply `migrations/20261002071547_edge_catalog_reader.sql` to the confirmed
staging project. It creates `al_edge_catalog_reader` as a NOLOGIN group with:

- `CONNECT` on `postgres` and `USAGE` on `public`;
- `SELECT` on `sessions(id,user_id,jwt_id,revoked_at,expires_at)`;
- `SELECT` on `users(id,google_sub,email_verified_at,email_verification_required,email_verification_legacy_exempt,deleted_at)`.

The two routes need no sequence privilege, function grant, table write, or
workout-table read. `SELECT 1` needs no table privilege. No grant is made to
`anon` or `authenticated`. Effective privileges must still be checked against
inherited and `PUBLIC` grants in the live project.
Future RPCs should receive individual `EXECUTE` grants only after their SQL
and security mode are reviewed; this read slice needs no application RPC.

For a staging login, create `al_edge_catalog_login LOGIN` and grant it only
`al_edge_catalog_reader`. Set a generated, strong password using an interactive
database client (`\password al_edge_catalog_login` in `psql`) so the password
does not appear in SQL history or this repository. Supabase's shared **transaction
pooler** uses port 6543 and a custom username of
`al_edge_catalog_login.<confirmed-project-ref>`. The Edge function's
server-side `DATABASE_URL` must point there with TLS; never use the default
owner-level `SUPABASE_DB_URL` for this slice. Store the URL through the
staging project's Edge Function Secrets UI or `supabase secrets set --env-file`
with an ignored local file. Secret names are project scoped. The pooler
supports no named prepared statements or query pipelining; the adapter's
parameterized queries require a live compatibility check before use.
The previously validated session pooler remains a valid staging connection
path for long-lived tools, while Supabase recommends the transaction pooler
for short-lived Edge Function connections.

Run `deno run --allow-env --allow-net tests/staging_live.ts` from `supabase/`
with `STAGING_PROJECT_NAME`, `STAGING_PROJECT_REF`,
`STAGING_ADMIN_DATABASE_URL`, `STAGING_RUNTIME_DATABASE_URL`, and the staging
`JWT_SECRET_CURRENT` supplied through secure environment variables. The script
refuses a URL whose host/username does not match the confirmed ref. It creates
only synthetic `@example.invalid` users and sessions and deletes them in
`finally`. It checks the actual adapter, eleven expected column grants,
CONNECT/USAGE, negative writes and sensitive reads, role escalation, browser
roles, and application-session cases. It must be run and its output recorded;
the checked-in script is not evidence of a live pass. A failed cleanup needs
manual review before a rerun.

Rotate the login by changing its password interactively, updating the staging
Edge secret, verifying a new connection, and terminating the old credential's
connections. Remove it by deleting the Edge secret, revoking group membership,
and dropping the login. Keep the NOLOGIN group only if this architecture is
adopted; otherwise revoke its grants and drop it after the experiment.

## Same-origin coexistence

Set `API_EDGE_TARGET=https://<confirmed-ref>.supabase.co` and
`API_PROXY_TARGET` to the existing legacy backend origin in the **staging
development** environment. `vite.config.ts` uses `deploy/coexistenceProxy.ts`
to route exact `/api/health` and `/api/analytics/catalog` paths to
`/functions/v1/api/api/...`; other `/api/...` paths retain the legacy proxy.
Cookie and Authorization headers pass through the same-origin proxy. The
automated Vite proxy test exercises those paths, query strings, adjacent-path
fallback, and headers against local mock upstreams. It does not constitute a
hosted Edge Function response. The production-facing reverse proxy needs the
same two exact-path rules before the existing `/api/*` fallback. Its host and
deployment configuration must be confirmed separately; no production DNS or
deployment change belongs to this milestone.

## Realtime capability prototype

`realtime-token-spike` is a separate staging-only Edge Function. It verifies
the existing HttpOnly application cookie or bearer token through the shared
session adapter, then checks that `workouts.owner_id` matches the app user. It
does not support coach links or additional topics. Its separate issuer DB URL
needs a login in the `al_realtime_issuer` group, which inherits only the
catalog reader columns plus `workouts(id,owner_id,deleted_at)`. Do not widen
the two-route catalog reader role for this experiment.

The capability is an imported-key ES256 JWT with `kid`, application `sub`,
`role=al_realtime_subscriber`, `purpose=workout_broadcast_spike`, exact
`rt_topic=workout:<id>`, `iat`, `jti`, and `exp=iat+60`. It does not contain the
application session cookie or signing key. Generate a **new** staging-only
P-256 signing key, import the new private JWK into Supabase using
the supported signing-key flow, and store the same private JWK and kid as
`REALTIME_SIGNING_JWK` and `REALTIME_SIGNING_KID` in staging Edge secrets.
Never reuse the offline ES256 grant key. `prototypes/realtime_staging.sql`
defines the separate subscriber role and a receive-only
`realtime.messages` policy matching the token topic and purpose. Do not grant
the subscriber application-table access. The `realtime` schema is managed by
Supabase; do not alter its table or RLS setting. Validate each SQL grant in
staging before treating the prototype as supported.

For the live exercise, disable public Realtime channels **in staging only**;
deploy the token function there; create one synthetic owned workout and two
synthetic users/sessions; and join private `workout:<id>` with `setAuth()`.
Observe an authorized Broadcast, a denied unrelated topic, an expired token,
and refusal to reissue after revoking the app session. Keep the already joined
channel connected after revocation; send timed test Broadcasts until expiry or
disconnect, recording issue, revocation, last-received, and disconnect UTC
times. Repeat with `setAuth()` and reconnect to see when policy is reevaluated.
The expected upper bound is the 60-second token life **only if the live test
shows that Realtime disconnects at expiry**. The local token tests prove
claims and issuer behavior, not private-channel authorization or a measured
revocation window.

After the experiment, delete synthetic workout, sessions and users; remove
test messages if any were persisted; remove the function's experimental Edge
secrets and deployment; revoke the imported signing key when safe; and apply
`prototypes/realtime_staging_cleanup.sql` after dropping temporary login
roles. Restore the staging Realtime public-channel setting to its prior value.
SSE and the live-workout frontend remain untouched.

Official sources: [Postgres connection paths](https://supabase.com/docs/guides/database/connecting-to-postgres),
[database roles](https://supabase.com/docs/guides/database/postgres/roles),
[Edge secrets](https://supabase.com/docs/guides/functions/secrets),
[custom JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys),
[Realtime private-channel authorization](https://supabase.com/docs/guides/realtime/authorization),
[Realtime `setAuth`](https://supabase.com/docs/reference/javascript/setauth).
