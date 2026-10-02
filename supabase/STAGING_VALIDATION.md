# Isolated staging validation runbook

Target only the existing Free project named `adaptive-lifting-staging` in
`ap-northeast-2`. Confirm its actual project ref in the Supabase Dashboard or
official MCP/CLI account listing before any SQL, secret, setting, or deploy
operation. The foundation commit is `c37ebfe373b11c843707e17a13bbe26178ed5d93`;
`local-save` at `29c81fb395c62cc2ac3c775d2a7d8ef3106d9328` is frozen.
No script here guesses a project ref or reads production credentials.

## Observed staging validation — 2026-10-02 (partial)

The confirmed target is `adaptive-lifting-staging`, ref
`admyuepbbtstayaydjmo`, region `ap-northeast-2`, Free plan. The project-scoped
Supabase MCP URL resolved to that ref. No production project or credential was
used.

### Existing catalog-reader migration

`20261002090404_edge_catalog_reader.sql` was applied through the official
project-scoped MCP `apply_migration` tool. Supabase recorded version
`20261002090404`, name `edge_catalog_reader`. The schema matched the migration's
expected `public.users` and `public.sessions` columns before application.

Live effective privilege inspection after application found:

- `al_edge_catalog_reader`: `CONNECT` on `postgres`, `USAGE` on `public`, no
  `CREATE`, 11 effective column-level SELECT grants, zero writable public
  tables, zero public sequence USAGE, zero owned public tables, and no
  `LOGIN`, `SUPERUSER`, `CREATEROLE`, `CREATEDB`, or `BYPASSRLS` attributes.
- Its SELECT grants are exactly `sessions(id,user_id,jwt_id,revoked_at,expires_at)`
  and `users(id,google_sub,email_verified_at,email_verification_required,
  email_verification_legacy_exempt,deleted_at)`. Queries selecting those
  columns completed under the role; `SELECT 1` also succeeded.
- `anon` and `authenticated` each retain `CONNECT` and `public` `USAGE`, but
  have zero effective application-table column SELECT privileges and zero
  writable public tables. No grants were added to either browser role.
- Under the restricted role, attempted INSERT/UPDATE/DELETE on users and
  sessions, reads of verification tokens, integration credentials and
  workouts, workout writes, public object creation, users table ALTER/DROP,
  role creation, a grant to `anon`, and an `authenticated` role alteration
  were all denied. PostgreSQL returned permission-denied/owner-required errors.
- These probes ran inside transactions that were rolled back. The temporary
  `SET` membership used to exercise the role was rolled back too. No probe role
  or fixture rows remain.

The SQL MCP session itself is `postgres`. Therefore its successful ability to
switch back to `postgres` is not a valid runtime-role escalation test. Catalog
inspection shows `al_edge_catalog_reader` has no escalation attributes and
cannot assume `postgres`; an actual LOGIN connection test is still needed.

### Runtime LOGIN migration

`20261002092347_al_edge_catalog_runtime.sql` was applied through the
project-scoped MCP after confirming its URL still resolved to
`admyuepbbtstayaydjmo`. The migration created `al_edge_catalog_runtime` with
LOGIN, INHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, and
NOBYPASSRLS. It contains no password. The role has exactly one membership:
`al_edge_catalog_reader`, with `INHERIT TRUE`, `SET FALSE`, and `ADMIN FALSE`.
This makes the reviewed group column grants usable while preventing role
switching or membership delegation.

Live catalog inspection after application confirmed:

- The runtime role has `CONNECT` through its inherited reader membership and
  `USAGE` on `public`; it has no `CREATE` on `public`.
- `has_database_privilege` confirms `CONNECT` to `postgres`; the six required
  session columns and five required user columns are selectable.
- Exactly the same 11 expected column SELECT privileges are effective. It has
  zero effective public-table writes, zero sequence USAGE/UPDATE, zero owned
  public objects, and zero direct public-object ACL entries.
- Effective privilege checks deny `UPDATE` on users/sessions and `SELECT` on
  `email_verification_tokens`, `integration_credentials`, and `workouts`.
- It cannot `SET ROLE` to either `al_edge_catalog_reader` or `postgres`.
- The roles retain no superuser, createdb, createrole, replication, or
  bypass-RLS capability.
- Effective `anon`/`authenticated` access remains zero for public application
  table column reads and writes.

Supabase `list_migrations` records `20261002092347`
`al_edge_catalog_runtime`.

### Migration-history filename reconciliation

On 2026-10-02, project-scoped MCP confirmed ref `admyuepbbtstayaydjmo` and
reported exactly these records: `20261002090404 edge_catalog_reader` and
`20261002092347 al_edge_catalog_runtime`. MCP `execute_sql` inspection of the
two corresponding `supabase_migrations.schema_migrations.statements` entries
matched each local SQL file after normalizing CRLF/LF and trailing whitespace.
The file contents were not edited; filenames were aligned to the remote
versions:

- `20261002071547_edge_catalog_reader.sql` →
  `20261002090404_edge_catalog_reader.sql`
- `20261002092326_al_edge_catalog_runtime.sql` →
  `20261002092347_al_edge_catalog_runtime.sql`

The local migration directory now orders these two files in dependency order:
the reader group migration precedes the runtime LOGIN membership migration.
Both versions match `list_migrations`; no SQL was reapplied and the remote
migration-history table was not changed.

These are live catalog/ACL checks through MCP, not queries executed as the
runtime LOGIN. Actual `current_user`/`session_user` and attempted forbidden
operations must be validated after a password is set and `DATABASE_URL` is
installed securely.

The MCP schema listing reports 36 public tables with RLS disabled. A separate
effective ACL check confirms no `anon` or `authenticated` application-table
read/write privileges at this time. This is recorded for later hardening
review; no RLS changes were made in this milestone.

### Runtime connection and secrets

Supabase's current Edge Functions documentation lists `SUPABASE_DB_URL` as an
automatically supplied URL for the project Postgres database. Supabase's
documented default connection examples use the `postgres` database role. I
infer the built-in URL uses that elevated default identity; this project's
injected URL value cannot be inspected with the available MCP tools. In any
case, the built-in URL is not a least-privilege runtime identity. The current
function implementation requires `DATABASE_URL`, so the intended runtime
remains a separate PostgreSQL transaction-pooler connection string for
`al_edge_catalog_runtime`, whose only role membership is
`al_edge_catalog_reader`. The MCP SQL tool cannot provide or test that
separate network login.

The available MCP tools include `apply_migration`, `execute_sql`, and
`deploy_edge_function`, but do not include a function-secret listing/get tool
or `create_edge_function_secret`. Secret presence cannot be checked through
this connection. The operator confirmed the API secrets were entered through
the Dashboard; no secret values were read or changed. The API function
requires `DATABASE_URL`, `JWT_SECRET_CURRENT`, and `CORS_ALLOWED_ORIGINS`.
`JWT_SECRET_PREVIOUS` is optional and is not needed for synthetic sessions
using a new staging-only key. The implementation does not require
`JWT_KID_CURRENT` or `JWT_KID_PREVIOUS`. `EMAIL_VERIFICATION_ENFORCE_LEGACY`
is optional. The Realtime function additionally requires
`REALTIME_ISSUER_DATABASE_URL`, `REALTIME_SIGNING_JWK`, and
`REALTIME_SIGNING_KID`.

The existing `api` Edge Function is deployed to staging as version 1 with
platform JWT verification disabled because the handler validates the separate
application JWT and database session. The operator confirmed `DATABASE_URL`,
`JWT_SECRET_CURRENT`, and `CORS_ALLOWED_ORIGINS` are configured; secret values
remain unavailable and were not requested.

### Routes and Realtime status

Live API and routing checks on 2026-10-02:

- `GET /functions/v1/api/health` returned HTTP 200 and `{"status":"ok"}`;
  this route executes `SELECT 1`, so it proved the deployed Edge function could
  connect to staging through its configured runtime connection.
- The configured CORS origin `http://localhost:3000` was echoed exactly on the
  health response, unauthenticated catalog response, and OPTIONS preflight.
  Preflight returned HTTP 204 and allowed `GET, OPTIONS`; no wildcard origin
  was observed.
- A health request carrying `Origin: https://not-allowed.example` returned
  HTTP 200 without `Access-Control-Allow-Origin`.
- `GET /functions/v1/api/analytics/catalog` without credentials and with a
  malformed bearer token each returned HTTP 401 with `WWW-Authenticate: Bearer`.
- An initial request to `/functions/v1/api/api/health` returned 404. This
  exposed an extra `/api` segment in the coexistence proxy rewrite. The rewrite
  now targets `/functions/v1/api/health` and
  `/functions/v1/api/analytics/catalog`; no function code or production
  routing was changed.
- The authenticated catalog payload and application-session cases were not
  exercised: the function secret values were deliberately neither retrieved
  nor exposed, and no local signing key/session fixture was provided. No
  synthetic database rows were created.

The Edge Function code, its configured database URL, and the manually tested
runtime identity identify `al_edge_catalog_runtime` as the application DB
login. The operator separately confirmed `current_user` and `session_user`
both equal that role and that selecting from `workouts` is denied.

Local-only checks rerun on 2026-10-02:

- `npm.cmd test -- src/services/coexistenceProxy.test.ts`: passed, 3 tests
  after correcting the Edge path rewrite. The tests confirm only the two
  exact routes target Edge, headers pass through, and other API paths use the
  legacy backend.
- `npm.cmd run lint`: passed (`tsc --noEmit`).
- `npm.cmd run build`: passed; Vite emitted the existing large-chunk warning
  (636.23 kB minified JavaScript chunk).
- `python -m pytest -q backend/test_auth.py backend/test_email_verification.py`
  using a temporary venv populated from `backend/requirements.txt`: passed,
  66 tests (79 warnings).
- `python supabase/tests/check_catalog_parity.py` using the same temporary
  venv: passed.
- Deno checks were not rerun because `deno` is not installed/on PATH.

The earlier recorded Deno 12-test pass, catalog parity, and Python
auth/email-verification 66-test pass are historical results, not rerun here.
The proxy tests check exact-path routing, query/header forwarding, and legacy
fallback. No hosted `GET /api/health` or `/api/analytics/catalog` response has
been validated. No Edge Function deployment was made.

Realtime remains a prototype only. The checked-in issuer uses ES256 and emits
`sub`, `role=al_realtime_subscriber`, `purpose=workout_broadcast_spike`, exact
`rt_topic`, `iat`, `jti`, and a 60-second `exp`. No live Realtime policy,
subscription, Broadcast, token refresh, or revocation-window measurement was
performed. No Realtime roles, policy, key, secret, setting, or function were
created.

## Restricted database credential

The applied migration `migrations/20261002090404_edge_catalog_reader.sql`
creates `al_edge_catalog_reader` as a NOLOGIN group with:

- `CONNECT` on `postgres` and `USAGE` on `public`;
- `SELECT` on `sessions(id,user_id,jwt_id,revoked_at,expires_at)`;
- `SELECT` on `users(id,google_sub,email_verified_at,email_verification_required,email_verification_legacy_exempt,deleted_at)`.

The two routes need no sequence privilege, function grant, table write, or
workout-table read. `SELECT 1` needs no table privilege. No grant is made to
`anon` or `authenticated`. Effective privileges must still be checked against
inherited and `PUBLIC` grants in the live project.
Future RPCs should receive individual `EXECUTE` grants only after their SQL
and security mode are reviewed; this read slice needs no application RPC.

The staging LOGIN role `al_edge_catalog_runtime` now exists and inherits only
`al_edge_catalog_reader`; it has no password until assigned securely. Generate
a strong, unique staging-only password in a password manager or local password
generator, then use a trusted interactive `psql` session connected to the
staging database as an administrator and run `\password al_edge_catalog_runtime`.
Enter the password only at the two hidden prompts;
do not use `ALTER ROLE ... PASSWORD '...'` in SQL Editor history.

In the staging Dashboard, open **Connect**, choose **Transaction Pooler**, and
copy its actual host and connection details. Do not infer the host from the
region. The Edge secret must use the shared transaction pooler, port 6543, and
this username format (with the actual Dashboard host and password URL-encoded
if needed):

`postgresql://al_edge_catalog_runtime.admyuepbbtstayaydjmo:<PASSWORD>@<ACTUAL-POOLER-HOST>:6543/postgres`

In **Project > Edge Functions > Secrets**, securely enter these required
names for the existing API function: `DATABASE_URL`, `JWT_SECRET_CURRENT`,
and `CORS_ALLOWED_ORIGINS`. Generate a new staging-only `JWT_SECRET_CURRENT`
locally or in a password manager; synthetic sessions and JWT fixtures must use
that same key. Do not copy a production key. Do not add
`JWT_SECRET_PREVIOUS`, `JWT_KID_CURRENT`, or `JWT_KID_PREVIOUS` for this
synthetic-only validation. The MCP cannot create or inspect Edge secrets, so
secret setup is a manual Dashboard step and no values should be sent in chat.

The Edge function's server-side `DATABASE_URL` must point to this restricted
login; never use the default elevated `SUPABASE_DB_URL` for this slice. The pooler
supports no named prepared statements or query pipelining; the adapter's
parameterized queries require a live compatibility check before use.
The previously validated session pooler remains a valid staging connection
path for long-lived tools, while Supabase recommends the transaction pooler
for short-lived Edge Function connections.

The Deno harness is an optional supplemental end-to-end check, not a
prerequisite for MCP migration or SQL privilege validation. If it is run,
`deno run --allow-env --allow-net tests/staging_live.ts` from `supabase/`
expects `STAGING_PROJECT_NAME`, `STAGING_PROJECT_REF`,
`STAGING_ADMIN_DATABASE_URL`, `STAGING_RUNTIME_DATABASE_URL`, and staging
`JWT_SECRET_CURRENT` in its environment. Those harness-specific variables are
not Supabase services and need not be created when an equivalent check can be
performed through MCP. The script refuses a URL whose host/username does not
match the confirmed ref. It creates only synthetic `@example.invalid` users
and sessions and deletes them in `finally`. It checks the actual adapter,
eleven expected column grants, CONNECT/USAGE, negative writes and sensitive
reads, role escalation, browser roles, and application-session cases. Its
output is evidence only if the harness actually runs; a failed cleanup needs
manual review before a rerun.

Rotate the login by changing its password interactively, updating the staging
Edge secret, verifying a new connection, and terminating the old credential's
connections. If this architecture is rejected after validation, remove it by
deleting the Edge secret, revoking group membership, and dropping the login.
Keep the NOLOGIN reader group and LOGIN role if this runtime architecture is
adopted.

## Same-origin coexistence

Set `API_EDGE_TARGET=https://<confirmed-ref>.supabase.co` and
`API_PROXY_TARGET` to the existing legacy backend origin in the **staging
development** environment. `vite.config.ts` uses `deploy/coexistenceProxy.ts`
to route exact `/api/health` and `/api/analytics/catalog` paths to
`/functions/v1/api/...`; other `/api/...` paths retain the legacy proxy.
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
