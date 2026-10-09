# Isolated staging validation runbook

Target only the existing Free project named `adaptive-lifting-staging` in
`ap-northeast-2`. Confirm its actual project ref in the Supabase Dashboard or
official MCP/CLI account listing before any SQL, secret, setting, or deploy
operation. The foundation commit is `c37ebfe373b11c843707e17a13bbe26178ed5d93`;
`local-save` at `29c81fb395c62cc2ac3c775d2a7d8ef3106d9328` is frozen.
No script here guesses a project ref or reads production credentials.

## Observed staging validation â€” 2026-10-02 (partial)

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

- `20261002071547_edge_catalog_reader.sql` â†’
  `20261002090404_edge_catalog_reader.sql`
- `20261002092326_al_edge_catalog_runtime.sql` â†’
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

### Routes and Realtime status (historical checkpoint)

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
- The authenticated catalog payload and application-session cases were later
  completed in the catalog-auth milestone; that later validation supersedes
  this preliminary checkpoint. Realtime status is superseded by the final
  results below.

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
fallback. This was a historical state before the hosted route deployment.

Realtime remained unvalidated at this historical checkpoint. See the final
prototype results below.

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

## Realtime capability prototype (pre-validation draft; superseded below)

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

## Realtime prototype validation (2026-10-02)

This section supersedes the preliminary Realtime draft above. The staging API
uses the existing app JWT/session/eligibility validator, verifies
`workouts.owner_id`, and issues an ES256 Realtime token with the Current
imported key (`kid=ce24a866-49d1-4f0e-bde5-9c5e05a70210`). Token TTL is 60
seconds. Claims are limited to `sub`, `role=al_realtime_subscriber`,
`app_user_id`, `workout_id`, `purpose=adaptive_lifting_realtime`, exact
`rt_topic=workout:<id>`, `iat`, `exp`, and `jti`. The private signing key is
stored only as Edge secret `REALTIME_JWT_PRIVATE_JWK`.

Migration `20261002152646_realtime_private_broadcast_subscriber` was applied
to staging. It creates `al_realtime_subscriber` as NOLOGIN, NOINHERIT,
NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOBYPASSRLS, with no ownership or
application-table privileges. It has `USAGE` on `realtime` and `SELECT` on
`realtime.messages`; its only policy is receive-only for Broadcast, exact
topic/workout identity and the `adaptive_lifting_realtime` purpose. RLS on
`realtime.messages` was already enabled and was not changed. The API runtime
receives only `workouts(id,owner_id,deleted_at)` for the ownership check.
There are no direct sequence grants to `al_realtime_subscriber`. Effective ACL
inspection also found `PUBLIC` grants on the shared `net.http_request_queue_id_seq`
and cron job/run sequences; this role has no `USAGE` on the `net` or `cron`
schemas, so it cannot address those objects. Those global extension ACLs were
not changed because revoking from `PUBLIC` would affect the whole project.

Live tests:

- Valid app session, ownership, token claims, and private join: passed.
- Private Broadcast receive and post-`setAuth()` Broadcast receive: passed.
- Second eligible user requesting the first workout's token: denied (403).
- Token for workout A joining workout B: denied.
- Normal Adaptive Lifting app JWT joining private Realtime directly: denied
  (`JwtSignatureError`).
- Realtime token used on `/api/analytics/catalog`: denied (401); used as a
  Data API bearer for `workouts`: denied (403).
- Expired Realtime token starting a new subscription: denied
  (`InvalidJWTToken: Token has expired`).
- Revoked app session requesting a new Realtime token: denied (401).
- Reconnect with an already issued, unexpired Realtime token after app-session
  revocation: succeeded and received Broadcast. The capability JWT remains
  valid independently of the application DB session until its own expiry.
- Measured revocation window in the controlled run: PostgreSQL revoked the app
  session at `2026-10-02 15:54:27.475952 UTC`; token expiry was approximately
  `2026-10-02 15:55:17 UTC`, about 49.5 seconds later. Controlled Broadcasts
  continued to arrive until immediately before expiry; the reconnected channel
  closed at expiry, and no later Broadcast was observed. This observed window
  is specific to the run and is not a general guarantee.

The user subsequently switched **Allow public access to channels OFF**
in staging. On 2026-10-02, a fresh synthetic retest proved:

- a no-token public channel join was denied; Realtime logged
  `PrivateOnly: This project only allows private channels`;
- the valid ES256 capability token joined the private workout channel;
- a no-token private join and a wrong-topic join were denied;
- a different eligible app user could not obtain the owner's workout token;
- a WebSocket Broadcast was received on the authorized private channel.

For that Broadcast only, an exact-workout temporary INSERT policy and privilege
were added to `al_realtime_subscriber`, then removed immediately afterward.
The final role has SELECT but no INSERT on `realtime.messages`. A separate
database `realtime.send` probe inserted a row but did not deliver it during
this retest, so only WebSocket Broadcast delivery is claimed as live-validated.

Cleanup verified zero synthetic `stg-realtime-*` users, sessions, workouts,
and `realtime.messages` topics. No temporary policy or fixture route remains.
The staging API was redeployed from current source as version 14;
`GET /api/health` returned 200 and the temporary fixture route returned 404.
The token issuer, minimal receive policy, role, tests, and runbook remain as
the completed prototype. No SSE or frontend changes were made; Supabase Auth
was not adopted.

## Analytics query capability (2026-10-03)

This capability migrates only `POST /api/analytics/query`. The exact-path
coexistence proxy sends `GET /api/health`, `GET /api/analytics/catalog`, and
`POST /api/analytics/query` to the API Edge Function; other `/api/*` paths
remain on the legacy backend. The proxy test covers POST method/body, query
string, cookies, Authorization, and fallback for unmigrated paths.

Migration `20261002164804_analytics_query_read_interface` was applied to the
confirmed staging project. It adds only
`public.al_analytics_read_facts(...)`, a `SECURITY DEFINER` read interface
with an empty fixed `search_path`. The function repeats app-session validity,
account eligibility, athlete/coach relationship, and coach entitlement
checks, and returns only the fields used by analytics calculations. The only
application `SECURITY DEFINER` function in `public` is this RPC. Its
`EXECUTE` privilege is effective for `al_edge_catalog_runtime` and denied to
`anon` and `authenticated`. No raw workout/history grants were added.

Live staging validation used deterministic synthetic athlete, coach,
workspace, microcycle, workout, exercise, and set rows. The API Edge runtime
identity was directly probed as `current_user=session_user=
al_edge_catalog_runtime`. That login could call the analytics RPC, but direct
`SELECT` on `workouts`, `exercises`, `exercise_sets`, and `microcycles`, plus
`INSERT`, `UPDATE`, and `DELETE` on `workouts`, were all denied. It has no
`public` schema `CREATE`, no direct read privilege on those four tables, and
only the intended application security-definer RPC. Browser roles have no
`workouts` read privilege and cannot execute the RPC. Existing catalog-reader
session/user column access remains unchanged.

The staged `POST /api/analytics/query` behavior returned HTTP 200 and matched
the Python contract for canonical e1RM and tonnage, stored-column pattern
filtering (including a non-obvious exercise title), set counts, weekday
matrix columns (`Mon` through `Sun`), heatmap cells, session spacing, and
`math_version=linear-decay-v3`. Period comparisons passed for unequal lengths,
overlapping ranges, previous-equal ranges, previous-block ranges, and an empty
secondary period. Live ACWR week points for the synthetic workload were
`[4, 1.47, 1.11]`; ACWR begins at the first workout date and uses the 27-day
lookback for rolling values. Invalid ACWR/day configuration returned 422.
The live RBAC outcomes were: athlete self and linked coach allowed; unlinked
coach and unrelated athlete denied; coach without analytics entitlement
denied. Missing and malformed auth each returned 401. The fixture-only test
bridge used to exercise authenticated requests was removed before the final
deployment; no diagnostic route is retained.

Representative live request latency (one request each, including network
round-trip) was 436 ms for a simple tonnage query, 365 ms for six metrics,
and 369 ms for a comparison query. Each requested period is bounded in SQL;
the HTTP handler makes one RPC for the primary period and one more only when
a period comparison requires it. The fixture run showed no per-set or
per-exercise database round trips.

After removing the temporary fixture and runtime-privilege probes, the API
Edge Function was deployed to staging as version 19. The final `GET
/functions/v1/api/health` returned 200 with `{"status":"ok"}`;
unauthenticated `POST /functions/v1/api/analytics/query` returned 401.
Requests to the temporary runtime probe no longer reach a route.

All synthetic `stg-analytics-*` users, sessions, workspaces, workspace
members, access grants, coaching links, microcycles, workouts, exercises, and
sets were deleted. A final staging count query returned zero for every such
fixture category. No test policies or temporary routes remain. The analytics
RPC and least-privilege runtime role remain as intended architecture.

Local checks rerun for this capability on 2026-10-03:

- `npm.cmd test`: passed, 32 files / 230 tests.
- `npm.cmd test -- src/services/analyticsParity.test.ts`: passed, 8 tests.
- `npm.cmd test -- src/services/coexistenceProxy.test.ts`: passed, 3 tests.
- `npm.cmd run lint`: passed (`tsc --noEmit`).
- `npm.cmd run build`: passed; Vite emitted the existing large-chunk warning
  (665.69 kB minified JavaScript chunk).
- `git diff --check`: passed.
- Python analytics tests were not rerun because `pytest` is not installed in
  the available Python environment. Deno checks were not run because Deno is
  not installed/on PATH. Prior auth, email-verification, and catalog-parity
  checks are historical, not rerun for this capability.

## Insight Card CRUD capability (2026-10-03)

This capability adds only `GET`, `POST`, `PUT`, and `DELETE
/api/insight-cards`. `POST /api/insight-cards/sync` remains legacy. The local
coexistence proxy tests cover all four CRUD methods, query strings, cookies,
Authorization, JSON bodies, and verify sync POST still reaches legacy. A
method-aware Vite middleware handles sync POST so PUT/DELETE still reach Edge
even when the opaque card ID is literally `sync`.

Staging migration `20261002173155 insight_card_crud_private_interface` was
applied once. Its local filename is
`20261002173155_insight_card_crud_private_interface.sql`. It adds four
`SECURITY DEFINER` functions in the unexposed `al_private` schema, each with
an empty fixed `search_path`: list-or-seed, create, update, and tombstone.
Preset JSON is passed from the existing `catalog.json`; SQL contains no second
copy of preset definitions. First-load seeding takes a per-user transaction
advisory lock. Owner ID is only taken from the Edge principal, and the RPCs
validate that the supplied user and active app session are linked.

Observed ACLs: `al_edge_catalog_runtime` has EXECUTE on these four functions,
but no SELECT/INSERT/UPDATE/DELETE on `public.insight_cards`. It has no CREATE
on `public`. `anon` and `authenticated` have no effective read/write access to
Insight Cards and cannot execute these functions. The runtime is not a table
owner and its NOLOGIN reader membership and existing narrow app privileges are
unchanged. The deployed Edge connection reported both `current_user` and
`session_user` as `al_edge_catalog_runtime`.

Live CRUD results on staging:

- unauthenticated list/create/update/delete: all 401;
- two concurrent first GETs both returned six presets, and subsequent SQL
  showed exactly six live presets for that owner;
- the six seeded IDs, names, configs, and layouts matched the catalog payload;
- a user with one live custom card received only that card; after tombstoning
  the custom card, GET seeded the six presets as legacy does;
- create with an explicit ID preserved the ID; create without one returned a
  UUID and default layout `{ "order": 0, "col_span": 1 }`;
- update preserved the path ID and owner while changing name/config/layout;
- foreign-user and missing-card PUT/DELETE both returned
  `404 {"detail":"Card not found"}`;
- incompatible POST and PUT configs returned 422 `INCOMPATIBLE_CARD`; malformed
  config returned 422 with a validation detail array;
- DELETE retained the row with `deleted_at`, hid it from list, and returned
  `{"status":"tombstoned"}`. A second DELETE also returned 200 with the same
  body, matching the Python route's owner/id lookup without a live-row filter.

All synthetic cards, sessions, and users with `stg-insight-cards-` identifiers
were deleted. Final staging checks showed zero matching user/session/card rows.
The temporary synthetic-token test bridge was removed and API Edge Function
version 22 was deployed from the clean source. Health returned 200 with
`{"status":"ok"}`, an unauthenticated card list returned 401, and the removed
test bridge no longer issues tokens.

Local checks rerun for this capability:

- `npm.cmd test`: passed, 32 files / 231 tests.
- `npm.cmd run lint`: passed (`tsc --noEmit`).
- `npm.cmd run build`: passed; existing large-chunk warning (665.69 kB minified
  JavaScript chunk).
- coexistence proxy tests: passed, including legacy POST sync and Edge
  PUT/DELETE for card ID `sync`.
- `git diff --check`: passed.
- Deno tests and formatting were not rerun because Deno is unavailable.
- Python analytics/reference tests were not rerun because Pydantic/Pytest are
  unavailable in the environment. Live Edge behavior was checked against the
  inspected Python router/schema/registry semantics.

SSE, Realtime role/policies, and the analytics query route were not changed.
Supabase Auth was not adopted; production and `local-save` were untouched.

## Insight Card sync capability (2026-10-03)

This slice migrates only `POST /api/insight-cards/sync`; workout sync remains
legacy. The parity inventory was taken from `backend/analytics_router.py`,
`backend/sync_service.py`, `backend/database.py`, `backend/analytics_schemas.py`,
`backend/analytics_registry.py`, and `src/services/sync_engine.ts`:

- Modern `mutation_type: insight_card` payloads omit `workout_id`; legacy
  payloads with omitted `mutation_type` and `workout_id: insight-cards` remain
  accepted. `schema_version` is required to be an integer but is not restricted
  to `1` on this route. Missing `math_version` and a matching value pass; a
  mismatch returns 409 with the existing `MATH_VERSION_MISMATCH` envelope.
- Device IDs are first claimed as submitted. A raw ID already owned by another
  account resolves to `<user_id>:<raw_id>`; a revoked effective device returns
  403. Empty-string device IDs remain accepted as in the Pydantic/SQLAlchemy
  implementation; a rollback-only SQL probe confirmed the RPC creates that
  exact ID. The shared `sync_mutations` primary key was aligned to
  `(client_device_id, mutation_id)` after confirming there are no referencing
  foreign keys and no duplicate composite keys. Existing global uniqueness had
  prevented the requested per-device identity when two users reused a mutation
  ID.
- Only `InsightCard` is processed. Unknown entities and incompatible non-empty
  configs are rejected without durable rejection rows. Malformed non-empty
  CardConfig remains a request-level 422; empty/falsy config skips schema
  validation. Unknown fields are ignored. Missing-card deletes are accepted
  and recorded. Sync updates can resurrect a tombstoned owned card.
- Mutation application, device resolution, mutation recording, and canonical
  response run in one `SECURITY DEFINER` RPC transaction with fixed empty
  `search_path` and transaction-scoped advisory locks. Client timestamps are
  parsed as timestamp-without-time-zone; a timestamp with an offset was checked
  to preserve its wall-clock value, matching legacy `replace(tzinfo=None)`.

Staging migration history now records:

```text
20261002181420 insight_card_sync_private_rpc
20261002181756 sync_mutation_device_scoped_key
20261002182616 insight_card_sync_id_parity
```

The local migration filenames match those remote versions. The second
migration changes only sync mutation identity; the third removes unnecessary
identifier-format restrictions after parity review. Neither changes workout
sync routing. `al_edge_catalog_runtime` has no direct read/write privilege on
`insight_cards`, `client_devices`, or `sync_mutations`, no `public` CREATE, and
EXECUTE only on the sync RPC among browser/runtime roles. The RPC is
`SECURITY DEFINER` owned by `postgres` with fixed `search_path`; ACL inspection
showed EXECUTE for `al_edge_catalog_runtime` and none for `anon` or
`authenticated`. `anon` and `authenticated` have no effective read/write
privileges on the three application tables.

MCP SQL exercised: create/defaults, same mutation retry without replay, update,
tombstone, repeated/missing deletes, resurrection, mixed partial acceptance,
incompatible and unknown entity rejection, existing rejected mutation lookup,
raw-device namespacing across two users reusing the same mutation ID, revoked
device denial, expired/invalid session denial, client timestamp parsing, and
two concurrent duplicate calls. Both concurrent responses acknowledged the
mutation, while SQL showed one card effect and one mutation row. Malformed
CardConfig was also tested through the SQL rollback marker; the transaction
rolled back. That probe verified RPC rollback mechanics, not the HTTP 422
translation.

Authenticated Edge validation used a short-lived, staging-only, capability-
gated mint route for one fixed synthetic athlete/session. A random one-time
capability was generated locally; only its SHA-256 hash was included in the
temporary uncommitted Edge source, and its value was kept in a DPAPI-protected
local temporary file. The bridge signed with the already-configured Edge
`JWT_SECRET_CURRENT`; the secret was never read or exposed. Its JWT matched the
normal app format (`HS256`, `kid=current`, `sub`, `role`, `session_id`, `iat`,
`exp`) and was held only in the local test process.

Live authenticated results:

- catalog auth returned 200;
- modern `insight_card` sync returned 200 and accepted the mutation;
- retry returned 200 and accepted the same ID without replaying the original
  create/update (the card retained the first mutation's values);
- legacy sentinel sync (`workout_id=insight-cards`, omitted mutation type)
  returned 200 and updated the owned card;
- matching math version was accepted; a mismatched version returned 409 with
  `MATH_VERSION_MISMATCH`;
- incompatible config returned 200 with its mutation ID rejected and no
  mutation record;
- malformed config initially exposed a Postgres driver shape mismatch and
  returned 500. Logs showed SQLSTATE `P0001` and the marker under the driver's
  nested `fields`. The Edge error adapter now recognizes both nested and direct
  fields; retest returned 422 with the CardConfig validation detail array.

The live DB showed one accepted row for each modern/legacy mutation, the final
card name from the legacy update, and the expected user/device/session linkage.
No record was written for the incompatible or malformed mutation. Earlier
SQL-RPC checks cover concurrent duplicate calls, foreign-device namespacing,
revoked devices, ownership scoping, partial acceptance, missing-card delete,
resurrection, and tombstones.

The temporary bridge was removed from source and the API redeployed as version
26. Afterwards the bridge path returned 404, health returned 200, and
unauthenticated catalog/sync requests returned 401. No temporary route or
capability value remains in Git or the active deployment.

Local Deno tests were added in `supabase/tests/insight_card_sync_contract.test.ts`
but were not executed because Deno is unavailable in this environment. The
IndexedDB queue's existing `postSync` behavior is covered by the newly rerun
`src/services/sync_engine.test.ts`; no queue implementation changes were made.

Cleanup and regression (2026-10-03): all rows matching both the
`stg-card-sync-` and `stg-card-sync-auth-` fixture prefixes were deleted and
verified absent from `users`, `sessions`, `insight_cards`, `client_devices`,
and `sync_mutations`.
The sync RPC ACL and direct-table boundary were rechecked after cleanup:
runtime EXECUTE is true; `anon`/`authenticated` EXECUTE is false; runtime
SELECT on the three sync tables and `public` CREATE are false. Remote migration
history matches all three new local versions exactly.

Checks rerun for this capability: `npm.cmd test` passed (32 files, 233 tests),
`npm.cmd run lint` passed, `npm.cmd run build` passed with the existing large
chunk warning, and `git diff --check` passed. `python -m pytest
backend/test_analytics.py` could not run because `pytest` is not installed;
`python -m unittest backend.test_analytics` could not import tests because
SQLAlchemy is not installed. Deno format/lint/typecheck/tests could not run
because `deno` is unavailable. Production and `local-save` were untouched; no
paid resources were enabled, and no secret values were read or exposed.

## Workout sync migration

This capability migrates only `POST /api/workouts/{id}/sync`. The local parity
inventory was checked against `backend/sync_service.py`, `backend/main.py`,
`backend/set_writes.py`, `backend/math_utils.py`, `backend/database.py`,
`src/services/sync_engine.ts`, `src/services/db.ts`, and
`src/contexts/SyncContext.tsx`.

- Workout sync remains distinct from Insight Card sync. It requires a workout
  ID, defaults the mutation type to `workout`, rejects `insight_card` with 400,
  rejects schema versions other than 1 with 409, accepts missing math version,
  and uses `rejected_mutations` plus per-mutation `conflicts` in the response.
- The Edge route authenticates with the existing app-session validator. The
  exact coexistence allowlist sends only `/api/workouts/{id}/sync` to Edge;
  unrelated workout routes still fall back to the legacy backend.
- The route ID must equal `payload.workout_id`. The database RPC rechecks this
  binding and authorizes the current user against the workout owner's active
  athlete/coach relationship and required programming entitlement in the same
  transaction. The stable route also checks path/payload equality and calls
  `require_session_for_write`, which enforces plan access and coach programming
  access. Source inspection found no legacy authorization defect; the new
  database checks provide defense in depth.
- Device IDs are scoped by the effective device owner. Existing foreign raw IDs
  resolve to `<user_id>:<raw_id>`, and a revoked effective device is denied.
  Mutation idempotency uses the effective device plus mutation ID and database
  advisory/row locks. A concurrent duplicate HTTP retry produced two accepted
  acknowledgements but one persisted mutation and one effect; replay did not
  apply the retry body.
- Only `Workout`, `Exercise`, and `ExerciseSet` mutations are supported. Field
  allowlists, workout containment, tombstone conflicts, and the five-minute
  future-clock rejection are applied per mutation. Future-clock and tombstone
  outcomes are persisted; unknown-entity, foreign-parent, and forbidden-field
  rejections are not durably recorded, matching the legacy handler. Malformed
  client timestamps fall back to server time. Completed workouts remain
  writable, and an active foreign lock blocks with 409 while expired/current-
  holder locks do not.
- Nested `Exercise.fields.sets` uses the legacy replacement rules: generated
  IDs/ranks/labels, scope and intensity defaults, `plannedRpe` fallback,
  first-row `isTop`, resurrection of supplied tombstoned sets, and soft deletion
  of omitted live sets. The legacy replacement does not write note, velocity,
  readiness, or HRV from nested rows; the SQL interface preserves that behavior.
- Recalculation runs after per-mutation processing, including batches whose
  individual changes are rejected. It recalculates canonical tonnage and
  exercise top/volume fields and attempts the prior-microcycle delta lookup.
  Live synthetic data verified tonnage `1026`, exercise volume `1,026kg`, top
  `107.0kg x 3`, and delta `526`. The implementation includes tombstoned rows
  during recalculation because the legacy ORM relationship does not filter
  them. Each successful request writes a `WORKOUT_SYNCED` DomainEvent; live
  inspection verified the event payload carried the accepted count and
  canonical tonnage. SSE code was not changed.

Staging applied these migrations through the project-scoped Supabase MCP:

```text
20261002191614 workout_sync_private_rpc
20261002192833 workout_sync_top_repr_fix
20261002192943 workout_sync_route_binding
```

The local filenames match remote migration history. The final function
`al_private.al_workout_sync(text,text,text,text,text,boolean,integer,jsonb)` has
EXECUTE for `al_edge_catalog_runtime` only. The older seven-argument overload
is revoked from runtime and browser roles. Effective-privilege inspection after
the final deployment confirmed the runtime has no direct SELECT on workouts,
exercises, exercise_sets, sync_mutations, or workout_locks; no workout UPDATE;
and no `public` CREATE. It has LOGIN but no superuser, createdb, createrole, or
BYPASSRLS capability. `anon` and `authenticated` have no direct application
table privileges and cannot execute either RPC overload. The temporary Edge
diagnostic confirmed `current_user` and `session_user` were both
`al_edge_catalog_runtime`; direct sensitive-table reads and workout update
were denied from that actual identity. Supabase's advisor still reports RLS
disabled on 36 `public` tables. No RLS setting was changed in this milestone;
the effective ACL checks for the workout-sync tables show `anon` and
`authenticated` cannot access them, and the broader advisor item remains a
separate hardening review.

Authenticated staging HTTP validation used synthetic identities and fixtures
only. It covered the athlete's own write, linked coach write, unrelated athlete
and coach denials, ended coach, URL/payload mismatch, wrong mutation type,
schema/math mismatch, absent math version, active/expired/current-holder locks,
revoked device/session, completed workout, future-clock rejection and replay,
malformed timestamp fallback, tombstone and workout containment conflicts,
forbidden fields, nested-set replacement, mixed accepted/rejected batches,
duplicate retry, concurrent duplicate retry, canonical metrics, and the event
row. A synthetic Realtime-shaped JWT and missing/invalid app auth were rejected.
The stable route source enforces URL/payload match and `require_session_for_write`
with athlete ownership or active coach relationship plus programming access;
no unrelated-write defect was found.

The API Edge Function is active at version 30. The temporary staging-only test
session/diagnostic route was removed before that deployment; its GET path now
returns 404 and `/api/health` returns 200. All rows with the
`stg-workout-sync-` prefix were checked absent from users, sessions, coaching
relationships, microcycles, workspaces, workouts, exercises, exercise sets,
workout locks, devices, sync mutations, domain events, and insight cards.

Regression checks executed on 2026-10-03: `npm.cmd test` passed (32 files,
233 tests), `npm.cmd run lint` passed, `npm.cmd run build` passed with the
existing large-chunk warning, and `git diff --check` passed. The coexistence
proxy test verifies body, method, cookie, Authorization, query string, exact
workout-sync Edge routing, and legacy fallback for other workout paths. Deno
format/lint/typecheck/tests were not rerun because Deno is unavailable; Python
reference tests could not run because the local Python environment lacks the
repository's required test dependencies. Production and `local-save` remain
untouched; no secrets or `.env` files were added, and no paid resource was
enabled.

## Microcycles read migration (2026-10-03)

The local source review for the proposed `GET /api/microcycles` slice confirmed:

- Athlete reads default to the actor's own plan; an explicit different athlete
  returns 403 with `Athletes can only access their own plan`.
- A coach with `athlete_id` needs an active coaching relationship and receives
  `Not linked to this athlete` otherwise. A coach without `athlete_id` receives
  the union of all active linked athlete plans, or `[]` when there are none.
- The route does not create rows for an empty plan. `format_microcycle` orders
  roots and workouts by ID; exercises and sets by `(lexo_rank or '', id)`.
- `format_microcycle` filters deleted Workouts, Exercises, and ExerciseSets,
  but `get_visible_microcycles` and the root formatter do not filter deleted
  Microcycles. This is a confirmed legacy read-path tombstone defect; the
  proposed Supabase projection filters deleted Microcycles.
- The ORM defines no `planned` ExerciseSet property, so the current serializer
  does not emit that optional key. `tags` comes from comma-splitting and
  trimming `tags_raw`; stored `movement_pattern` precedes the legacy
  `pattern_for(title, lift_category)` fallback.

The staging project was confirmed by its API URL as
`https://admyuepbbtstayaydjmo.supabase.co`. The narrow `al_private.al_microcycles_read`
interface was applied and is recorded in remote migration history as:

- `20261003104637 microcycles_read_interface`
- `20261003110609 microcycles_workout_owner_guard`
- `20261003110904 microcycles_legacy_boolean_nulls`

The local filenames use these exact remote versions. The second migration hides
any child Workout whose `owner_id` differs from its Microcycle owner; the third
preserves nullable `isAuto` and `isTop` values as emitted by the legacy
serializer. All three migrations are additive and expose the Microcycle read
projection only through the restricted function.

The RPC is `SECURITY DEFINER`, `STABLE`, and has an empty fixed `search_path`.
It repeats app-user/session/eligibility checks and enforces athlete ownership
or an active coach relationship in its read snapshot. It returns only the
serialized plan projection. The runtime role has `EXECUTE`; `anon` and
`authenticated` do not. The runtime role remains LOGIN, inherits only
`al_edge_catalog_reader`, has no superuser/create-db/create-role/BYPASSRLS or
public schema CREATE capability, and has no direct SELECT or DML privileges on
Microcycles, Workouts, Exercises, ExerciseSets, or coaching relationships.
Browser roles likewise have no direct app-table access.

Authenticated staging checks used a temporary, capability-protected Edge
session issuer restricted to synthetic prefixed users. It was removed from the
handler and the clean API was redeployed as Edge Function version 33. The
temporary route now returns 404; health returns 200 and unauthenticated
`/microcycles` returns 401. Synthetic users, sessions, relationships,
Microcycles, Workouts, Exercises, and ExerciseSets were deleted; follow-up
counts for every fixture table were zero. The local capability and encrypted
token cache were removed.

Live authorization results: athlete own/default and explicit-athlete reads
returned 200; cross-athlete read returned 403; linked coach explicit read and
coach-without-athlete union returned 200; unrelated and ended coaches returned
403; coach with no active relationships and empty athlete returned `[]`.
Missing/malformed app credentials returned 401. Expired, revoked, and deleted
sessions returned 401, while email-verification-ineligible account returned
403. An ES256 bearer was denied by the app-session validator, which accepts
only the Adaptive Lifting HS256 application-token algorithm.
The empty-plan athlete had zero Microcycle/Workout/Exercise/Set rows before and
after GET, confirming no seeding or writes.

Live serialization checks passed for exact Microcycle/Workout/Exercise/Set
keys, camelCase fields, defaults, stored-pattern precedence and title fallback,
tags, numeric JSON types, optional-note omission/inclusion, absent `planned`,
nullable boolean parity, all four ordering rules, and descendant tombstones.
Tombstoned root Microcycles were also hidden. The stable Python read path does
not filter tombstoned Microcycles, so
`LEGACY_MICROCYCLE_TOMBSTONE_DEFECT_FOUND=yes` and
`MICROCYCLE_TOMBSTONE_HARDENING_APPLIED=yes`. A deliberately cross-owned child
Workout was hidden by the RPC owner guard. The exact returned array survived
the IndexedDB snapshot JSON serialization round-trip.

Five-request median staging latencies after the final SQL changes were:

- Empty plan: **365.1 ms**
- Small plan: **353.9 ms**
- Nested plan: **349.8 ms**

Each route uses one RPC round trip with bounded nested SQL aggregation; the Edge
layer has no per-Microcycle/Workout/Exercise/Set N+1 requests. No authorization
freshness cache was added.

Local checks run for this migration: `npm.cmd test`, `npm.cmd run lint`,
`npm.cmd run build`, the coexistence proxy tests included by the test suite, and
`git diff --check`. The build retains its existing large-chunk warning. Deno
format/lint/typecheck/tests were not rerun because Deno is unavailable; Python
reference tests could not run because the local Python environment lacks the
repository's required test dependencies (`python -m pytest ...` reports that
`pytest` is not installed). The offline authorization suite had a pre-existing
clock-sensitive overlong-grant fixture; its test expiry was moved from 86,401
to 172,800 seconds so it remains beyond the 24-hour policy after test startup
delay. Production and `local-save` remain untouched; no secrets or `.env` files
were added, and no paid resource was enabled.

## POST /api/sessions staging validation

The session-create implementation follows the stable route contract in
`backend/main.py`: athletes always write to their own plan and an incoming
`athleteId` is ignored; coaches must provide an athlete, have an active
relationship, and pass the workspace programming entitlement check. Coach
workspace resolution uses the coach-owned workspace and OWNER membership, then
the same recognized plan keys, active grant/subscription states, plan
precedence, period-end rules, and configured past-due grace. Every currently
configured plan includes programming, so a live `FEATURE_NOT_INCLUDED` fixture
cannot be created without changing the plan catalog; the denial remains
implemented and mapped, while live staging verified both no-active-plan denial
and an entitled coach write.

The RPC and route are in `al_private.al_session_create`, a fixed-search-path
`SECURITY DEFINER` transaction. It rechecks the application session, current
account eligibility, target ownership/relationship, entitlement, and live
Microcycle ownership. The runtime has no direct SELECT or DML on workouts,
Microcycles, coaching relationships, workspaces, members, grants, or
subscriptions. `al_edge_catalog_runtime` is the only role with function
EXECUTE; `anon` and `authenticated` lack both schema usage and function
EXECUTE. Their SELECT/INSERT/UPDATE/DELETE ACLs on those plan and entitlement
tables are all false. The runtime also has no public-schema CREATE, role
creation, database creation, superuser, or RLS-bypass capability. The deployed
Edge path successfully called the RPC with the restricted runtime connection.

The first empty-plan read returned `[]`; before and after counts were identical
(one pre-existing synthetic tombstoned Microcycle, zero Workouts, Exercises,
and Sets). Session creation then created a new live `Ungrouped` Microcycle,
never reused the tombstone, and inserted no Exercises or Sets. Two simultaneous
first-create requests both returned 200 and shared one live `Ungrouped`
Microcycle. A separate athlete with an existing live `Ungrouped` cycle reused
it. The stable helpers do not filter tombstoned roots for explicit or automatic
creation, while the canonical read hides them; this defect was confirmed and
the creation RPC rejects tombstones or creates a new live `Ungrouped` cycle.

Live HTTP checks passed for athlete self-create (including ignoring a foreign
`athleteId`), linked coach create, missing coach athlete ID (400), unrelated
and ended coach denials (403), coach without active workspace entitlement
(403 `WORKSPACE_ACCESS_REQUIRED`), explicit live/foreign/missing/tombstoned
Microcycle behavior, auto-creation and reuse, default and trimmed title,
day-label fallback and whitespace preservation, trimmed/empty labels, date
errors, read-after-write through `GET /api/microcycles`, coach visibility, and
cross-athlete isolation. The successful response was HTTP 200 with exactly
`id`, `date`, `dayLabel`, `title`, `status`, `blockLabel`, `weekLabel`,
`microcycleId`, `ownerId`, and `exercises`. Persisted workouts had the expected
owner, Microcycle, `PLANNED`/`mac-blue` defaults, zero tonnage/delta, and no
Exercises.

Source parity review found that Python `strptime("%Y-%m-%d")` accepts
unpadded month/day values and returns the original trimmed string. A live
`2026-1-5` request confirmed this behavior; a follow-up SQL migration preserves
it. Current remote migrations and local filenames match exactly:

- `20261003113739 sessions_create_private_rpc`
- `20261003114718 sessions_create_strptime_compat`
- `20261003114820 sessions_create_strptime_acceptance_fix`
- `20261003115405 sessions_create_microcycle_lock`

The first follow-up still had a normalized-string check; the final migration
removes that check while keeping an exact year-month-day shape and PostgreSQL
calendar validation. The last migration locks an explicitly selected or reused
live Microcycle row for the duration of creation, preventing a concurrent
tombstone update from hiding a newly created Workout. No migration SQL was
reapplied under an existing version. A transaction rollback probe executed the
current RPC with a synthetic session, asserted the persisted Workout and
Ungrouped Microcycle owner/default fields plus zero Exercises, and confirmed
the new rows rolled back together.

Authentication checks returned 401 for missing credentials, malformed JWT,
Realtime ES256 JWT, revoked app session, expired app session, and deleted user;
an email-verification-ineligible account returned 403 with
`EMAIL_VERIFICATION_REQUIRED`. The removed temporary token issuer now returns
404 for GET and POST. The clean API was redeployed as active Edge Function
version 36; health returned 200 and unauthenticated Microcycles returned 401.
The temporary capability and encrypted token cache were deleted. All prefixed
synthetic users, sessions, relationships, workspace/entitlement rows,
Microcycles, Workouts, Exercises, Sets, locks, and events were verified at zero.

Regression checks executed: `npm.cmd test` (32 files, 235 tests passed),
`npm.cmd run lint`, `npm.cmd run build` (existing large-chunk warning), and
`git diff --check`. Python reference tests were unavailable because `pytest`
is not installed; Deno format/lint/typecheck/tests were unavailable because
the Deno executable is not installed. The Supabase security advisor still
reports 36 public tables with RLS disabled. This milestone did not change that
separate posture; the verified `anon` and `authenticated` roles have no direct
table privileges on the session-create interface's plan or entitlement
tables, and cannot execute the private RPC.

## DELETE /api/sessions/{id} local draft

The parity matrix for the deletion path is: authenticate the existing app
session; load a Workout; resolve `owner_id` or parent Microcycle ownership;
enforce athlete ownership or active coach linkage and programming entitlement;
hide an already tombstoned row as 404; then set only the Workout root
`deleted_at` and `updated_at`, returning `{"status":"success"}`. Exercises,
ExerciseSets, WorkoutLocks, DomainEvents, SyncMutations, and the parent
Microcycle are deliberately untouched. The stable route and its integration
test confirm root-only deletion, outsider denial, 200 then 404 on repeated
delete, PATCH and Workout Sync rejection afterward, and preservation of an
existing DomainEvent.

Local draft adds `al_private.al_session_delete`, which delegates its locked
authorization and entitlement check to the established session PATCH RPC, then
performs one conditional root tombstone update in the same transaction. The
single-row lock makes duplicate DELETE requests serialize. The route returns
only the legacy success object. Coexistence routing matches only DELETE with a
single session-id path segment; exercise REST routes remain on legacy.

This draft is not staging-validated yet. The authenticated Supabase MCP
connection returned `MCP authentication required`; the official Supabase CLI
2.119.0 is available via `npx` but has no stored access token or environment
credential. The official CLI browser login has been started and is waiting for
its browser verification code. The SQL migration has not been applied, the
Edge API has not been redeployed, and no session-delete staging fixtures have
been created.

The frontend delete callbacks still use the same API contract and confirmation
dialog. They reload the canonical plan and close the dialog; the App session
view returns to the dashboard and clears the active Workout selection, while
the Sessions view clears the selection when it was the deleted Workout. The
active Workout UI preference is removed when its ID is cleared, preventing a
stale selected session after reload. Local regression checks pass: `npm.cmd
test` (32 files, 235 tests), `npm.cmd run lint`, and `npm.cmd run build` (the
existing large-chunk warning); `git diff --check` passes. Deno is unavailable,
and Python reference tests are unavailable because pytest is not installed.

## PATCH /api/sessions/{id} staging validation

The update route reuses the established Adaptive Lifting app JWT/session
validator and calls only `al_private.al_session_update`. Migrations
`20261003121444 sessions_update_private_rpc` and
`20261003121623 sessions_update_authorization_order` are recorded on staging
and match the checked-in filenames. The second migration preserves the legacy
owner-resolution and authorization order: resolve direct/parent Microcycle
owner, enforce plan access and coach programming entitlement, then conceal a
tombstoned Workout as `Session not found`.

The function is `SECURITY DEFINER` with an empty fixed `search_path`; only
`al_edge_catalog_runtime` has EXECUTE. Actual runtime identity was
`al_edge_catalog_runtime` for both `current_user` and `session_user`. Runtime
direct SELECT and title/owner UPDATE attempts on `public.workouts` failed with
`permission_denied`. Effective ACL checks also show no workouts SELECT/UPDATE
for the runtime role and no function EXECUTE or workouts SELECT/UPDATE for
`anon` or `authenticated`. No broad table grants were added. The function
rechecks current app session, account eligibility, athlete ownership or active
coach relationship, and coach workspace entitlement inside the transaction.
It updates only the six supported fields, atomically applies status/color,
trims and validates supplied dates, preserves raw title/day-label values,
trims block/week labels, and leaves no-op `updated_at` unchanged. It does not
inspect WorkoutLocks, recalculate metrics, emit DomainEvents, change ownership,
or move a Workout between Microcycles.

Live staging PATCH results included: missing/tombstoned sessions 404; foreign
athlete, unrelated coach, and ended relationship denied; linked coach allowed;
coach without an active plan returned the exact `WORKSPACE_ACCESS_REQUIRED`
403 envelope; owner fallback through a parent Microcycle succeeded, while a
row with neither owner returned 400. Missing, malformed, revoked, expired,
deleted-user, and valid ES256 Realtime-only credentials were denied by the
app-auth boundary (401); an email-verification-ineligible user received the
existing 403. A foreign active WorkoutLock did not block PATCH. Completed and
missed sessions remained writable. PLANNED/IN_PROGRESS mapped to `mac-blue`,
COMPLETED to `mac-green`, and MISSED to `gray`; invalid status returned 400.
Date trimming and malformed, impossible, datetime, and empty date rejection
matched the new `date must be YYYY-MM-DD` hardening. Raw padded/empty title and
day-label values persisted, block/week labels trimmed or cleared, and null
fields were unchanged. Empty PATCH returned 200 without changing the row or
`updated_at`. Concurrent title and week-label patches both persisted. The
response contained exactly the nine legacy keys, and canonical
`GET /api/microcycles` reflected date/title/label/status updates.

Stable PATCH source assigns a non-null date directly without calling
`require_iso_date`; this accepts malformed values at the route boundary and is
a data-integrity defect. The Edge RPC intentionally applies the session-create
date validation instead. The stable route also has no WorkoutLock check; that
behavior is preserved. No feature-not-included coach plan exists in the
current plan catalog (all recognized plans include programming), while the
existing entitlement denial mapping remains covered by the Edge unit test.

Cross-route compatibility was smoke-tested by creating a synthetic session,
PATCHing it, then sending an allowed Workout Sync title mutation. Sync returned
200/accepted and the migrated Microcycles read showed the canonical title.
The temporary staging token/runtime diagnostic paths were removed from the
checked-in API and deployment. The clean API is active as Edge version 41;
health returned 200, temporary diagnostic GET paths returned 404, and the
general non-GET unknown-route guard returned 405 for POST to those absent paths.
All synthetic users, sessions, plans, workouts, relationships, entitlements,
locks, devices, mutation records, and events for this test prefix were verified
at zero. No secret, `.env`, production resource, or paid resource was changed.

Local checks for this change: the focused coexistence proxy suite passed 7/7
after correcting the one-segment PATCH proxy matcher. Full `npm.cmd test`,
`npm.cmd run lint`, `npm.cmd run build`, and `git diff --check` are rerun for
this commit. Deno is not installed, so Deno format/lint/typecheck/tests were
not rerun. Python reference tests remain unavailable because this environment
does not have the repository test dependencies installed.

## DELETE /api/sessions/{id} staging validation

Migration `20261004130440_sessions_delete_private_rpc` is recorded on staging.
The API Edge Function was deployed as version 46 after the temporary staging
token bridge was removed. Health returned 200; the former bridge POST path
returns 404. No bridge capability or token remains in the repository or local
temporary directory.

Live requests used synthetic `stg-session-delete-*` users, sessions, plans,
relationships, and training rows. Missing/malformed/revoked/expired/missing-DB
session/deleted-user credentials returned 401; the unverified synthetic
password account returned the existing `EMAIL_VERIFICATION_REQUIRED` 403.
The ES256 Realtime-only JWT was rejected as an application credential. Athlete
own-plan and active linked-coach deletions succeeded. A foreign athlete,
unrelated coach, and ended relationship were denied. A coach with a relationship
but no active workspace access received `WORKSPACE_ACCESS_REQUIRED`; historical
owner fallback succeeded and a workout without any resolvable owner returned
400. A missing or already tombstoned workout returned 404.

The success response was exactly `{"status":"success"}`. PLANNED,
IN_PROGRESS, COMPLETED, and MISSED sessions were deletable; an active foreign
WorkoutLock did not block deletion. A concurrent duplicate delete returned one
200 and one 404. The live Workout root was soft-tombstoned and `updated_at`
matched `deleted_at`; its Exercise and ExerciseSet remained live with their
original timestamps, its parent Microcycle remained live, and the foreign lock
remained. Existing `WORKOUT_SYNCED` DomainEvents and accepted SyncMutation rows
survived. Workout Sync created one additional `WORKOUT_SYNCED` event before the
delete; no delete event was emitted and no post-delete mutation was recorded.
PATCH and both empty and writing Workout Sync requests returned 404 afterward.
The athlete and linked coach Microcycles trees omitted the Workout.

For analytics tombstone parity, the synthetic athlete's tonnage query returned
500 before deletion and an empty series afterward. The Realtime-only JWT could
not authenticate the app DELETE route. The Edge DB connection reported
`current_user = session_user = current_role = al_edge_catalog_runtime`; direct
SELECT on workouts, exercises, exercise_sets, sync_mutations, and workout_locks,
plus direct Workout UPDATE and DELETE probes, were denied. The narrow delete RPC
was executable by the runtime role only; effective EXECUTE was false for `anon`
and `authenticated`, which also retained no effective Workout table access.

All synthetic `stg-session-delete-*` fixtures were deleted after validation;
the post-cleanup count was zero across users, sessions, Microcycles, Workouts,
Exercises, ExerciseSets, DomainEvents, SyncMutations, devices, locks,
relationships, workspaces, memberships, grants, and subscriptions. Local
regressions rerun for the milestone: `npm.cmd test` (32 files, 235 tests),
`npm.cmd run lint`, `npm.cmd run build`, and `git diff --check` all passed. The
build retained the existing large-chunk warning. Deno is unavailable and
Python reference tests could not run because `pytest` is not installed.

## PATCH /api/sessions/labels staging validation

Migration `20261005124211_sessions_bulk_labels_private_rpc` is recorded on the
staging project and matches the checked-in migration filename. The route uses
the narrow `al_private.al_sessions_bulk_labels` SECURITY DEFINER interface;
it reuses `al_private.al_session_update` for app-session, account eligibility,
plan ownership/relationship, coach entitlement, owner fallback, and tombstone
checks. The Edge route ignores `athleteId` for target selection, rejects an
empty `sessionIds` list with the legacy 400 detail, and returns only
`status` and request-ordered `updated` IDs. The Vite coexistence proxy routes
only `PATCH /api/sessions/labels` to Edge; `PATCH /api/sessions/{id}` remains
the single-session route and other session methods/paths are not broadened.

The stable Python implementation skips missing and ownerless workouts, keeps
duplicate IDs in the returned list, and does not check `deleted_at` before
writing. That tombstone omission is a legacy defect. The staging RPC hardens
it by returning the compatible `Session not found` 404 for a tombstoned ID and
preflighting the full batch before writing, so a foreign or tombstoned member
rolls back the entire request. `athleteId` remains accepted for compatibility
but cannot broaden access. Block and Week values remain raw strings; each
clear flag takes precedence over its value. No-op requests report authorized
IDs without bumping `updated_at`. Completed and missed workouts remain
writable, WorkoutLocks are not consulted, and this route emits no DomainEvent.

Authenticated live staging checks covered athlete self-access, linked coach,
unrelated athlete/coach and ended relationship denial, missing/ownerless skip,
forged `athleteId`, programming-entitlement denial, empty IDs, raw/empty/
whitespace labels, independent clears, clear precedence, no-op timestamps,
request order and duplicate IDs, completed/missed sessions, active foreign
WorkoutLock, mixed authorization rollback, and tombstone rollback. Concurrent
Block-only and Week-only patches to the same Workout both persisted. The
Realtime-only JWT was rejected by this app-auth route. The exact success body
was `{"status":"success","updated":[...]}`; no synthetic DomainEvents were
created. Runtime connections reported
`current_user = session_user = al_edge_catalog_runtime`; direct Workout
SELECT/UPDATE were denied, and only the runtime role could execute the RPC.
`anon` and `authenticated` could neither execute the RPC nor access Workout
rows.

The temporary staging token/runtime probe was removed from source and the API
was redeployed clean as Edge version 51. After that deployment, health returned
200 and the temporary read/write token path returned 404 for GET (the generic
unknown non-GET guard returned 405 for POST). A final isolated athlete fixture
confirmed live `PATCH /api/sessions/labels` followed by `GET /api/microcycles`
returned the same Workout with both new labels. That temporary fixture was
deleted and prefix counts returned zero. All synthetic
`stg-session-labels-*` users, sessions, plans, workouts, locks, relationships,
devices, sync mutations, events, and entitlement rows were removed and verified
at zero.

## Exercise Set Replacement

The private transactional RPC for `PUT /api/sessions/{id}/exercises/{exercise_id}/sets`
was applied to staging as migrations `20261005161820` and
`20261005162355` and the API Edge Function was deployed as version 71. The
replacement route shares the Workout row serialization lock and the canonical
live-only `linear-decay-v3` metrics helper with Workout Sync. Only the Edge
runtime role can execute the replacement RPC; it has no direct SELECT, INSERT,
UPDATE, or DELETE privilege on Workouts, Exercises, or ExerciseSets, and the
`anon` and `authenticated` browser roles cannot execute the RPC.

Authenticated staging checks covered unauthenticated rejection, athlete owner
and foreign-plan behavior, linked coach access, unrelated and ended coach
denial, missing/ownerless session behavior, parent-Microcycle tombstone
hardening, live Exercise ownership, client Set IDs, deterministic fallback Set
IDs, update-in-place, omitted Set tombstones, preexisting tombstone rejection,
cross-Exercise Set-ID rejection, defaults/coercion, unposted log metadata
preservation, completed Workout write (the same guard does not branch on
Workout status), empty replacement, duplicate
IDs, and concurrent complete replacements. A live Workout Sync mutation after
REST replacement updated the canonical Set tree; the analytics query reported
320 kg while that logged Set was live and no result after a later empty
replacement. A subsequent queued mutation was rejected with
`TOMBSTONE_CONFLICT`. The migrated GET returned the same canonical tree and
metrics. The temporary runtime-privilege probe ran under
`al_edge_catalog_runtime` and every direct table operation was denied.

The temporary token/runtime routes were removed from source and Edge version 71
was redeployed. Both temporary paths returned 404. All prefixed fixture rows,
including users, app sessions, workspaces, access grants, relationships,
plans, Workouts, Exercises, ExerciseSets, SyncMutations, DomainEvents, and
client devices, were removed and each count verified zero. Health returned 200
after the clean redeploy.

Local checks for Set replacement: `npm.cmd test` passed (38 files, 261 tests),
`npm.cmd run build` passed with the existing large-chunk warning, and
`git diff --check` passed. `npm.cmd run lint` still reports only the unchanged
`Deno` global and `@db/postgres` resolution diagnostics in shared Edge files;
Deno, pytest, and Pydantic are unavailable in this environment, so legacy
Python/Pydantic reference tests could not run. The existing staging Advisor
warning about public tables without RLS was not changed. Production and
`local-save` were not modified.

Local checks for this change: `npm.cmd test` passed (33 files, 239 tests),
`npm.cmd run build` passed with the existing large-chunk warning, and
`git diff --check` passed. `npm.cmd run lint` is blocked by the existing
TypeScript project configuration including Supabase Deno sources without
Deno globals/import-map resolution (`Deno` and `@db/postgres`); Deno itself is
not installed, and Python reference tests remain unavailable because `pytest`
is not installed. Production and `local-save` were not modified.

## Set Replacement vs Set Log Compatibility

The missing `SET_REPLACE_VS_SET_LOG_COMPATIBILITY` gate was completed on the
confirmed `adaptive-lifting-staging` database. The test used two independent
Postgres transactions: one private SQL actor reproduced the stable Set Log
mutation and canonical recalculation, while the other called the deployed
`al_private.al_session_replace_exercise_sets` RPC used by
`PUT /api/sessions/{id}/exercises/{exercise_id}/sets`. This isolates database
serialization from the unavailable legacy FastAPI HTTP transport. No
`/api/sets/log` Edge route was created and no frontend Set Log routing changed.

The initial reverse-order overlap exposed a Set replacement defect: a stale
plan replacement overwrote `scope`, `actual`, `reps`, and `executedRpe` after
Set Log had committed. Corrective migrations `20261005170153` and `20261005170449`
now make existing Set IDs prescription-only updates, preserving Set Log's
scope/execution fields. New Sets are inserted with no execution values. The
deployed API route continues to use the same private RPC; no Edge code deploy
was needed for this SQL-only correction.

Forced-overlap results after the final correction:

- Replacement first, then Set Log: plan `105 kg × 4 @ 8`, log `111.5 kg × 3 @
  8.5`, `scope=both`; canonical `top=111.5kg x 3`, `vol=334kg`, `tonnage=334.5`,
  `delta=0`.
- Set Log first, then replacement carrying stale null execution fields: the
  same serial combination remained persisted; canonical metrics matched.
- Set Log first, then replacement omitting the Set: the Set became tombstoned;
  no live Set contributed, `top`/`vol` were `—`, and `tonnage=0`, `delta=0`.
- Replacement omitting the Set first, then Set Log: the later actor rejected
  the tombstoned Set with 404; there was no resurrection and metrics stayed at
  zero.
- A new Set replacement carrying stale execution values inserted a plan Set
  with `actual`, `reps`, and `executedRpe` all null.

After each overlap, persisted `ExerciseSet`, `Exercise.top`, `Exercise.vol`,
`Workout.tonnage`, and `Workout.delta` were compared with the shared
live-only `linear-decay-v3` helper. No duplicate ID or ownership change was
observed. Temporary functions were revoked from browser/runtime roles and
dropped; synthetic rows with the `stg-set-replace-` prefix were deleted and
verified absent. `anon` and `authenticated` still cannot execute the replacement
RPC or directly read/update `ExerciseSet`; only the Edge runtime can execute it.

Staging smoke checks: Edge API v71 health returned 200; unauthenticated
Microcycles and Set replacement returned 401; the old Set Log Edge path returned
405; the removed temporary staging token path returned 404. `local-save` and
production were untouched. `SET_REPLACE_VS_SET_LOG_COMPATIBILITY=PASS`.

Regression after the final migration: `npm.cmd test` passed (38 files, 261
tests); `npm.cmd run build` passed with the existing large-chunk warning;
`npm.cmd run lint` reported only the known missing `Deno` global and unresolved
`@db/postgres` import; both `git diff --check` and
`git diff --cached --check` passed.

## Set Log Edge Migration

`POST /api/sets/log` now routes to the Supabase Edge API and the narrow
`al_private.al_set_log` RPC. The request parser was checked against the stable
Pydantic model for missing/null required values, numeric coercions, zero and
negative values, fractional reps, invalid numbers, empty IDs, and omitted,
null, and empty optional telemetry. The RPC preserves execution/log semantics,
the plan-to-both scope upgrade, and unchanged prescription fields. It uses the
app JWT and session authorization path, allows an actively linked coach to log
without a Programming entitlement, rejects deleted Workout/parent Microcycle
and target rows, and never consults `WorkoutLock`.

Live staging covered athlete/coach authorization, a coach linked to two
athletes and its all-linked-plan response scope, completed/missed/locked
sessions, direct-owner sessions without a Microcycle, the owner fallback,
cross-Exercise/Workout Set rejection, telemetry updates, canonical response
and analytics reads, atomic rollback when metric recalculation was forced to
fail, and same/different Set concurrent writes. Set Log vs Set replacement
and Workout Sync serialized to coherent final rows. Set Log vs Exercise DELETE
initially showed that the existing delete RPC left cached metrics counting a
tombstoned Exercise; migration `20261005174414` now invokes the existing
canonical live-only metric helper inside that same delete transaction. A
fresh staging Set Log followed by Exercise DELETE produced matching cached
and live tonnage (`815`). This is a narrow metric-consistency dependency fix;
the Exercise DELETE HTTP route contract is unchanged.

The Set Log RPC emits no DomainEvent or SSE signal and does not write
SyncMutation history. The returned value is the canonical `MicrocycleData[]`
from the existing read interface; the same `apiService.logSet()` response
continues to serve the Telegram terminal and offline queue flow. Runtime
direct ExerciseSet reads and execution-field updates remain denied; only the
Edge runtime can execute the log RPC. The temporary staging token and runtime
privilege probe routes were removed before API Edge version 77 was deployed;
both now return 404. All `stg-set-log-*` staging rows, including sessions,
relationships, Workouts, Exercises, Sets, history rows, locks, devices, and
users, were removed and zero residue was verified.

Set Log regression: `npm.cmd test` passed (39 files, 285 tests),
`npm.cmd run build` passed with the existing large-chunk warning, and
`git diff --check` passed. `npm.cmd run lint` still reports only the existing
`Deno` global and `@db/postgres` resolution diagnostics; Deno and pytest are
unavailable. Production and `local-save` were not modified.

## Offline-auth signing key (staging)

The staging-only offline-auth ES256 private signing key is stored in Supabase
Vault under the name `adaptive_lifting_offline_auth_private_key`. The account
Edge runtime retrieves only that named value through
`al_private.get_offline_auth_private_key()` when the optional
`OFFLINE_AUTH_PRIVATE_KEY` Edge secret is not configured. Only
`al_edge_catalog_runtime` can execute the getter; browser roles cannot execute
it and have no Vault access. The getter is in the unexposed `al_private`
schema and is not routed through the Data API. The private key remains outside
Git and browser-visible data. Production is untouched. A future production
deployment may use its own `OFFLINE_AUTH_PRIVATE_KEY` Edge secret instead; no
production key has been installed or copied.

Staging validation confirmed `/api/auth/me` issues an ES256 grant with the
expected issuer, audience, current app session ID, user identity, and scopes;
the actual frontend verifier accepts it and rejects altered signatures,
payloads, algorithms, issuer/audience, expiry, future issue time, excessive
lifetime, missing session/subject, mismatched user identity, invalid role, and
invalid scope values. Browser reload with the API unavailable restores the
cached identity and only reads owners in the signed scope. Explicit logout and
the `auth-session-revoked` handler clear the locally stored grant. Online
session revocation rejects subsequent online authentication immediately; an
already-issued grant on a disconnected client remains cryptographically
verifiable until its own expiry, bounded by the app session expiry and 24
hours. After coach unlink, new `/auth/me` scopes and grants exclude the ended
athlete; an older grant already held by a disconnected client may retain that
scope only until its bounded expiry.

## Auth onboarding Edge migration

Registration, email verification, resend, and Google login now run through the
Supabase API Edge function and the custom application session architecture.
Supabase Auth remains unused. New password accounts default to ATHLETE and
queue hashed-token/encrypted-payload email work transactionally. The Python
outbox worker was narrowed to Google Sheets; a private Edge worker claims only
email-verification jobs through the one-minute Cron schedule.

Staging deployed API Edge version 87 and `email-verification-worker` version
3. Live registration returned the same generic response for new/duplicate
email, created an ATHLETE with bcrypt-compatible password, verification token
hash, and encrypted outbox payload, and created no training data.
Pre-verification login returned `EMAIL_VERIFICATION_REQUIRED`. Resend produced
the same generic reply for unknown and known addresses; the 60-second cooldown,
five-resend rolling limit, token replacement/ciphertext clearing, and
concurrent resend serialization were validated. The database verify RPC
consumed a generated token once and rejected replay; the resulting verified
password account then logged in through the Edge route and `/api/auth/me`
returned a frontend-verified ES256 offline grant.

The `email-verification-edge-worker` Cron job is scheduled every minute and
targets only its private Edge function. An invocation through the Vault-backed
dispatcher reached the worker; it returned 503 before claiming queued work
because no Resend key, sender, or app URL is configured in staging. Direct
unauthenticated worker invocation returned 401. Live delivery is therefore
`NOT_CONFIGURED_STAGING`; no message was sent. Google has no staging client ID,
so `/api/auth/google` fails closed with 503 and provider-live success is
`NOT_CONFIGURED_STAGING`. The cryptographic verifier and invalid-claim cases
passed local generated-key tests. Production and `local-save` were untouched.

The final live smoke after the API redeploy authenticated the verified fixture
through the migrated login route, received `/auth/me` with an offline grant,
read an empty `/microcycles` collection, queried the analytics catalog and
tonnage endpoint, received the expected 403 from an unrelated Realtime workout
request, and logged out successfully. A separate one-use synthetic token was
submitted through the live `/api/auth/verify-email` Edge route and returned the
exact success response; its user and token rows were immediately removed.
Afterward all `stg-auth-onboarding-*`
and retired takeover fixtures and their dependent rows were deleted. Targeted
counts report zero synthetic users, sessions, devices, tokens, outbox jobs,
relationships, history/audit rows, training rows, sync rows, events, and locks.
The staging Vault signing/encryption/worker configuration and the permanent
private RPCs/Cron job remain. No temporary diagnostic SQL functions remain.
The final API and worker deployments were version 87 and 3 respectively.

## Day Notes and exports Edge migration

Day Notes and CSV/JSON exports now run through the Supabase API Edge function.
Staging applied migration `20261006153607 day_notes_exports_domain` and
deployed API Edge version 89. The four routes are method/path-specific; the
unrelated integration, billing, Telegram, and Sheets routes remain outside
this migration. Supabase Auth remains unused.

DayNote reads and writes use narrow private RPCs, preserve the owner/date
unique key, tombstone clears, and resurrect the same row on a later non-empty
save. Runtime table access remains denied and browser roles cannot execute the
private RPCs. JSON export reuses the canonical live-only Microcycle reader.
CSV export uses canonical metric math, live-only training rows, stable coach
scope and ordering, exact filters/headers, standards-compliant quoting, and a
text-cell formula-injection prefix. Both export audit events are visible via
the existing audit route. Day Notes create no sync/domain events and do not
change training metrics.

Staging validated athlete/coach scope, unlink revocation, concurrent note
creation, update/clear/resurrection, calendar note API behavior, CSV filters,
CSV escaping/formula-like titles, JSON/CSV download headers and contents,
live-only tombstone exclusion, audit visibility, and no metric side effects.
The final health/auth/core-training/analytics/Realtime smoke passed. All
`stg-notes-export-*` users and dependent fixture rows were deleted; targeted
post-cleanup counts are zero for users, sessions, devices, invites,
relationships, snapshots, audit events, notes, training rows, sync mutations,
domain events, and locks. No temporary SQL helper was created; only the
permanent narrow RPCs remain. Production and `local-save` were untouched.

## Final pre-production audit (2026-10-09)

This is a staging/repository audit only; no production project or production
data was accessed. The starting checkpoint was `881dcc85b1eb63aabe79cda4e50deb356cfd2ae0`,
branch `supabase-staging-validation`, with a clean worktree. The `local-save`
ref remained `29c81fb395c62cc2ac3c775d2a7d8ef3106d9328`.

### Route reconciliation and runtime

The AST inventory from `local-save` found 65 explicit route registrations in
non-test Python modules and four FastAPI generated docs/schema routes. The
complete 69-route reconciliation, including exact method/path, handler source,
classification, and direct staging response, is in
[`FINAL_AUDIT_ROUTE_INVENTORY.md`](FINAL_AUDIT_ROUTE_INVENTORY.md).

Results: 63 migrated to the deployed `api` Edge dispatcher; one local/demo
login is development-only and fails closed on Edge; one old workout SSE route
has no frontend EventSource caller and returns 404; four generated OpenAPI/docs
routes are intentionally removed; unresolved production route count is zero.
Direct unauthenticated calls to all 63 migrated method/path pairs included
`sb-project-ref=admyuepbbtstayaydjmo`: 53 protected calls returned 401, five
empty public bodies returned validation errors, three unconfigured provider
routes returned 503, `/api/health` returned 200, and idempotent logout returned
200. A synthetic registered athlete then completed live Edge password login,
`/api/auth/me`, `/api/account/access`, `/api/microcycles`, analytics catalog,
session create/delete, and logout. No request used FastAPI.

Staging Edge inventory is exactly three active functions: `api` v96,
`email-verification-worker` v3, and `google-sheets-worker` v4; all have
platform `verify_jwt=false` because the API validates the custom application
session and workers validate independent internal secrets. The old separate
`realtime-token-spike` function is not deployed. Its stale repository
entrypoint and `config.toml` deployment stanza were removed; its handler and
token code now live under the API's internal `_shared/realtime` module. The
API still exposes only the app-authenticated `/api/realtime/token` operation.

The production Compose/Caddy configuration was corrected in this audit: the
only service is the static frontend/Caddy host, `/api/*` is rewritten to the
Supabase `api` Edge function, and Caddy supplies the publishable API key. The
Python migrator, API, worker, and FastAPI upstream were removed from production
Compose. `docker compose --env-file .env.production.example config --quiet`
passed. The Docker daemon and local Caddy binary were unavailable, so Caddy
container validation and a live Caddy-to-Edge staging proxy rehearsal were not run. The Vite coexistence
proxy's Python fallback remains development-only. Production deployment is
therefore free of a Python runtime dependency in checked-in deployment config,
but the final Caddy forwarding path still needs a staging host rehearsal.
Production frontend builds also ignore `VITE_BACKEND_URL`; the regression test
verifies that an injected legacy origin cannot redirect production API calls.

### Migrations, schema, functions, and privileges

Repository and staging each contain 62 migration entries/files after the
operator-access, runtime-text-encoding, and read-only-inspector audit migrations. Every repository
migration name is represented in staging and there is no missing or unexpected
migration name. The original 21 historical staging version identifiers differ
from current repository filename prefixes; the three audit migrations were also
recorded under staging-generated prefixes, so 24 current entries have version
prefix differences. The independent
`email_worker_clear_claim_on_retry` and `day_notes_exports_domain` migrations
also appear in opposite order in the two histories; they change separate
objects. No staging history was rewritten. This is recorded as historical
version/order drift, not an unapplied migration. Name reconciliation found no
missing or extra records. Normalized SQL statement hashes match 52 of 62
current files. The ten differences were reconciled against the final staging
catalog: the Realtime subscriber statement omitted comments only; the
Realtime coach-grant statement differed in whitespace only; earlier account
security definitions were superseded by the later parity-hardening/billing
definitions; the old Set Log placeholder spellings were superseded by the
encoding-correction migration; and the copied-week, exercise-add, Telegram,
and operator-display statements contained transport-encoding variants. The
final exercise-add and set-replacement functions use the expected dash
placeholder, and the live copied-week, Telegram, and operator function bodies
were repaired by `20261009170000_correct_runtime_text_encoding.sql`. The
remaining correction-migration hash difference was a terminal blank line.
Catalog checks found no missing migration names or unexplained final object
effects. Thus all 62 applications are represented, all 24 version-prefix
differences and the one independent order swap are explained, and no applied
migration was replayed or history rewritten. The operator access inspector
calls the existing access resolver only for an already-present OWNER
membership, avoiding workspace creation as a side effect of diagnostics.
Production deployment must apply all 62 current files in lexical version
order to a clean project.

The public schema currently has 37 tables, zero views/materialized views, one
sequence, 99 indexes, 41 foreign keys, and nine non-internal triggers. Installed
extensions are `pg_cron`, `pg_net`, `pg_stat_statements`, `pgcrypto`,
`plpgsql`, `supabase_vault`, and `uuid-ossp`. No table/function name matching
temporary test/debug/probe patterns was found; the two name matches are the
permanent billing diagnostics function and Insight Card preset-seeding
function. No temporary SQL helper remains.

There are 97 application functions across `public` and `al_private`, including
96 `SECURITY DEFINER` functions. All 96 are owned by `postgres`, use an empty
fixed `search_path`, and contain no dynamic SQL. None grants execute to
`PUBLIC`, `anon`, or `authenticated`; no browser role has `al_private` schema
usage. The runtime role can execute 84 narrow functions, including route and
worker interfaces; operator voucher functions are not executable by the
runtime or browser roles. No generic runtime table write grants, sequence
rights, schema creation rights, superuser, `BYPASSRLS`, or direct decrypted
Vault access were found. The role inherits only `al_edge_catalog_reader`.
Prior live staging evidence recorded `current_user=session_user=al_edge_catalog_runtime`;
this audit's MCP SQL session itself runs as `postgres` and cannot independently
repeat that connection identity check.

Effective table privileges for `anon` and `authenticated` remain denied across
all application tables. A direct REST read of `public.users` with the public
anon key returned `401 permission denied for table users`; direct private RPC
lookup returned 404. However, the REST Data API endpoint itself is active in
staging, so `DATA_API_DISABLED=no`. The `list_tables` helper emitted a critical
RLS-disabled warning for 36 tables; live effective-grant checks show no browser
table access, which is why RLS remains intentionally disabled under the
current grant boundary. Before production, disable the Data API as designed or
re-verify the full browser grant boundary after project configuration. The
Security Advisor returned one INFO: RLS enabled without a policy on
`public.telegram_link_tokens` (fail-closed). Do not add policies to the
36 intentionally non-RLS tables without a separate security design.

The runtime role has no direct `vault` schema/table access. `anon` and
`authenticated` also cannot read Vault. The `al_billing_secret` getter has a
fixed name allowlist and returns only the requested configured entry; the
voucher key and offline-auth, email-payload, and integration-encryption keys
are all present and pairwise distinct. Secret values were not returned or
logged. Vault names observed were the email payload key, email and Sheets
worker URL/internal-key dispatch entries, integration encryption key, offline
auth private key, voucher enable flag, and voucher code secret. Stripe secrets
and prices were not configured. Separate JWT/Realtime/provider environment
secret values cannot be inspected through this MCP; do not treat their
independence as cryptographically re-proven by this audit.

### Cron, network dispatch, and advisors

The only active Cron jobs are `email-verification-edge-worker` and
`al-google-sheets-worker`, both every minute. Each had 1,440 successful Cron
ticks and zero failed ticks in the preceding 24 hours. There were zero pending
`pg_net` requests. Their `SECURITY DEFINER` dispatchers read server-owned Vault
targets and internal secrets; the Sheets target is host/path constrained, and
email dispatch uses a single Vault-owned target. No temporary Cron jobs exist.
Tick success is not proof of provider email/Sheets delivery.

The Security Advisor returned one INFO finding as described above. The
Performance Advisor returned 19 unindexed foreign keys, one Realtime RLS
init-plan WARN, and six unused-index INFO findings. No index was added in this
audit. The 19 missing FK indexes are performance findings; the hottest
authorization/concurrency paths have supporting explicit unique/query indexes
and prior transaction tests. Unused indexes are not removed based on staging
statistics alone.

### Current staging providers, fixture cleanup, and audit gaps

Voucher enablement and its dedicated Vault secret are configured. Stripe
billing is disabled; secret, webhook secret, and all three Prices are absent.
The deployed webhook returned 503 when called without signature, as required
for disabled staging. Google login, email delivery, Telegram, Sheets OAuth, and
Stripe remain `NOT_CONFIGURED_STAGING`; production values must be configured
independently in their target project. Supabase Auth remains unadopted.

A broad text-column scan found two historical `stg-account-offline-final-*`
workspace audit events with no corresponding fixture rows; those two synthetic
events were removed. A fresh authenticated `stg-final-audit-*` account was
registered, used for the live Edge smoke, logged out, and removed with its
session, verification, outbox, training, and audit dependents. The post-cleanup
`stg-%` scan and 41-FK integrity scan returned zero matching residue and zero
orphans. Permanent Vault secrets, the two Cron jobs, and application functions
were retained.

The production-relevant `manage_user.py` workflows now have private,
postgres-only Supabase procedures in
`20261009162235_operator_access_management.sql`: promote coach, grant/revoke
manual coach access, inspect account access, and link a Stripe customer. Live
staging checks confirmed idempotent promotion/grant/link behavior, access
revocation without touching voucher or subscription rows, cross-workspace
customer conflict denial, audit events, and concurrent operations. All six
operator procedures (including workspace initialization) have fixed empty
search paths and are unavailable to PUBLIC, browser roles, the Edge runtime,
and the reader role. `show-access` is migrated; `billing-status` and voucher
create/show/revoke are already replaced by the existing private billing
operator procedures; `set-test-subscription` is test-only and intentionally
retired from production operations. `OPERATOR_RUNTIME_GAP=PASS` and
`OPERATOR_PYTHON_DEPENDENCIES=0`.

The project REST endpoint is reachable (a direct anonymous table read returns
401 permission denied), so the actual Data API setting is **enabled**; denied
table grants do not mean the Data API itself is disabled. No supported project
settings management operation or browser surface was available in this
session, and the setting was not changed. No current frontend feature was
found to depend on PostgREST, but the intended disabled setting remains an
unresolved staging configuration gate.

The route inventory and one earlier authenticated athlete smoke do not replace
the requested full authenticated staging matrix (coach/athlete relationships,
Realtime delivery, all training consistency/tombstone paths, revocation races,
and representative concurrency). Those gates remain NOT VERIFIED. The new
audit operator fixtures were removed and the prefix scan returned zero users,
workspaces, audit rows, or voucher-limit rows. No Python backend was present.
The Caddy runtime rehearsal was not run because the Docker daemon, local Caddy
binary, browser surface, and an existing staging host were unavailable. These
gates, the enabled Data API setting, and incomplete reconciliation prevent a
`CUTOVER_READINESS=READY` conclusion. Production was not changed. The
continuation record below supersedes the rehearsal and authenticated-smoke
status in this earlier checkpoint section; the Data API setting remains
enabled.

### Final audit continuation — 2026-10-09

The audit resumed on the existing staging branch without resetting prior
changes. The Data API project setting was independently checked using the
authenticated Supabase project context and browser-surface inventory. The
Dashboard control was not available to this session. Staging REST remains
reachable, so `DATA_API_PROJECT_SETTING=enabled` and
`DATA_API_DISABLED=no`; effective `anon`/`authenticated` table access and
private RPC execution remain denied. No grants, schemas, or RLS policies were
changed to simulate a disabled Data API. The one remaining configuration action
is Dashboard → `adaptive-lifting-staging` → Integrations → Data API → Overview
→ turn **Enable Data API** Off. This has not been performed.

Four disposable staging-only users (`stg-final-audit-*`) were created using
temporary credentials and the custom application password/session flow. Their
email-verification marker was set only as a trusted synthetic fixture because
email delivery is not configured; this is not evidence for the real email
verification flow. All users, sessions, workspaces, grants, relationships,
training rows, notes, cards, billing rows, vouchers, audit events, rate-limit
subjects, and provider test rows were removed after validation. Exact fixture
lookups returned zero rows. The four account IDs and temporary credentials are
not retained in the repository.

Authenticated calls below went through the deployed staging API Edge function
(`admyuepbbtstayaydjmo`), directly or through the actual Caddy proxy. Expected
and actual status codes matched:

| Method and route | Actor | Result |
| --- | --- | --- |
| `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout` | Athlete A/B, Coach C | 200 / 200 / 200; post-logout `/auth/me` returned 401 |
| `PATCH /api/auth/profile` | Athlete B | 200 |
| `GET /api/security/sessions`, `DELETE /api/security/sessions/{id}` | Two Athlete A sessions | 200; revoked session `/auth/me` 401; other session 200 |
| `GET /api/account/access` | Athlete A/B, Coach C | 200; voucher entitlement visible after redemption |
| `GET /api/security/devices` | Athlete A | 200 |
| `POST /api/auth/coach-code`, `POST /api/auth/link-athlete` | Coach C, Athlete A/B | 200 |
| `GET /api/coach/roster`, `GET /api/coach/roster/history` | Coach C | 200 |
| `GET /api/microcycles`, `POST /api/sessions`, `PATCH /api/sessions/{id}`, `DELETE /api/sessions/{id}` | Athlete B / linked Coach C | 200; tombstoned workout read returned 404 |
| `PATCH /api/sessions/labels`, `POST /api/sessions/copy-week` | Disposable Athlete | 200; source labels persisted and copy appeared in canonical read with requested labels |
| `POST /api/sessions/{id}/exercises`, `PATCH .../exercises/{id}`, `DELETE .../exercises/{id}` | Athlete B | 200 |
| `PUT /api/sessions/{id}/exercises/{id}/sets`, `POST /api/sets/log` | Athlete B | 200 |
| `POST /api/workouts/{id}/sync` | Athlete B | 200 for live workout; 404 for tombstoned workout |
| `GET /api/analytics/catalog`, `POST /api/analytics/query` | Athlete B | 200 |
| `GET/POST/PUT/DELETE /api/insight-cards`, `POST /api/insight-cards/sync` | Athlete A | 200 |
| `GET /api/day-notes`, four `PUT /api/day-notes` create/edit/clear/resurrect writes | Athlete A | 200 |
| `GET /api/export/csv`, `GET /api/export/json` | Athlete A/B | 200 |
| `GET /api/integrations/telegram/status`, `GET /api/integrations/google-sheets/status` | Athlete A | 200, current provider state returned |
| `POST /api/billing/vouchers/redeem` | Athlete A, Coach X, Coach C | Athlete 403; wrong-account 400; valid redemption 200 and replay 400 |
| `GET /api/billing/plans`, checkout, portal, webhook | Coach C | 503 fail-closed; Stripe remains unconfigured in staging |
| `POST /api/realtime/token` | Coach C linked to B / unlinked from A; revoked session | B 200 and private WebSocket joined; A 403; revoked session 401 |

The direct-route unauthenticated sweep for all 63 migrated method/path pairs
returned the expected authentication/authorization denial. Edge API health
returned 200 and the staging project response header identified the expected
project. Email delivery, Google/Telegram login, Sheets OAuth/publishing, and
Stripe provider operations remain `NOT_CONFIGURED_STAGING`; those feature
routes retained their fail-closed behavior. Voucher redemption is live and
does not depend on Stripe.

Cross-domain checks: Set Log and set replacement raced through live Edge calls
and both returned 200; canonical state contained one matching set. Coach
unlink raced a write; unlink won, the racing and later coach writes were
denied, Coach C could no longer read Athlete A, Athlete A retained owned data,
and Athlete B remained readable. Two simultaneous session revocation contexts
proved the revoked session could no longer call `/auth/me` or mint a Realtime
token while the independent session remained usable. Two concurrent voucher
redemptions returned one 200 and one generic 400. Two direct transactions each
were serialized by their staging PostgreSQL routines: email token consume (one
success/one invalid), Telegram link token consume (one session/one invalid),
Sheets outbox claim (one job/one empty claim), and two different checkout
request IDs (one `create`/one `checkout_in_progress`). These fixtures were
removed after the races.

Tombstone visibility was checked using a live Workout, tombstoned Workout,
tombstoned Exercise, tombstoned Set, and tombstoned Microcycle. The live Edge
canonical read omitted deleted Workout/Exercise/Set rows and retained their
live siblings; a separate owner read omitted the tombstoned Microcycle.
Analytics, CSV/JSON, Telegram `/today`, and the production Sheets `rowsFor`
builder excluded the deleted Workout/Exercise/Set entities; syncing the deleted
Workout returned 404. These were staging-owned synthetic records and were
removed afterward.

An official Caddy v2.11.7 Windows release archive was downloaded to a temporary
tooling directory and its SHA-256 matched the digest in the official release
metadata. The real Caddy process served the production Vite build and proxied
the real staging Edge API; responses carried `Via: 2.0 Caddy`, the expected
Supabase project ref, and `X-Served-By: supabase-edge-runtime`. Headless
Playwright Chromium exercised the browser sign-in/session cookie, account and
training APIs, exports, billing fail-closed responses, service-worker
registration, deep-link refresh, logout, and a successful private Realtime
WebSocket join. The browser captured 308 requests with no legacy FastAPI host
or localhost:8000 reference. The first real proxy probe found an incorrect
function path rewrite (404); `deploy/Caddyfile` now forwards `/api/...` as
`/functions/v1/api/...`, and the follow-up Caddy health/browser run passed.
The full browser run used the allowlisted local origin `http://localhost:3000`;
the staging Edge API correctly rejected a non-allowlisted temporary HTTPS
origin. No Python/FastAPI process or Docker container was used or required.

`CADDY_RUNTIME_REHEARSAL=PASS`, `CADDY_BROWSER_ROUTING=PASS`, and
`FULL_APP_WITHOUT_FASTAPI=PASS` for the exercised staging route families.
The complete prefix/FK cleanup audit returned zero `stg-final-audit-*` rows
and zero checked ownership orphans. All temporary browser/race runner files,
the temporary Caddy configuration and binary directory, and the Caddy process
were removed; no Edge route, SQL helper, or Cron test object was added.
The project Data API switch remains the only unmet mandatory configuration
gate. Security Advisor findings remain one INFO (`telegram_link_tokens` RLS
enabled without a policy; fail-closed). Performance findings remain 19
unindexed foreign keys, one Realtime auth init-plan WARN, and six unused-index
INFO findings; no blanket indexing changes were made. Migration reconciliation
remains 62 repository/62 staging migrations, 24 historical version-prefix
mismatches, one explained ordering swap, and zero unexplained drift.

Final local verification after these documentation updates: `npm.cmd test`
passed 358 tests with one skipped; `npm.cmd run build` passed; and
`git diff --check` passed. `npm.cmd run lint` still reports only the known
environment diagnostics (`Deno` global unavailable and `@db/postgres`
unresolved); Deno itself is not installed in this session. The production
bundle emitted the existing advisory for a JavaScript chunk over 500 kB. The
tracked-file secret scan found no live credentials; the only database-URL
pattern was a redacted documentation placeholder. Production remains
untouched. At that earlier checkpoint, the worktree remained intentionally
uncommitted pending the Dashboard action; the final verification below
supersedes that status.

### Final verification after Data API was disabled — 2026-10-09

The staging owner confirmed the Dashboard action **Integrations → Data API →
Overview → Enable Data API: Off**. The current MCP exposes project URL and
database reads, but not the project-level Data API setting itself; there is no
Dashboard browser surface in this session, so a Management API setting
readback was unavailable. The data-plane check used the staging publishable
key against the generated routes: `GET /rest/v1/users?select=id&limit=1` and
`POST /graphql/v1` both returned HTTP 503 with PostgREST `PGRST002` (schema
cache unavailable). This independently confirms those generated endpoints
are unavailable after the reported switch; unlike the earlier permission
denial, this is not being described as a table-grant result. The project
setting is recorded as dashboard-confirmed by the staging owner and
corroborated by the endpoint probes, rather than as a direct settings API
readback.

The checks after the switch showed the API Edge health route returning HTTP
200; the Stripe webhook returned its expected disabled HTTP 503; direct
execution of `al_private.al_auth_me` returned the expected
`invalid_session` denial for deliberately nonexistent identifiers; and the
Realtime WebSocket completed its connection handshake. The `email-verification-edge-worker`
and `al-google-sheets-worker` Cron jobs remained active on their existing
minutely schedules, and each had three latest recorded runs in `succeeded`
state. No migration, table, role, grant, RLS, Edge deployment, or Cron
configuration changed for the Data API verification. Effective `anon` and
`authenticated` table SELECT and private RPC EXECUTE remain false; the Edge
runtime retains execute on its auth RPC and no execute on the operator-only
billing diagnostics RPC. The previously completed authenticated route,
authorization, tombstone, revocation, and representative concurrency results
remain the audit evidence; the project switch did not change those database
objects or application deployments. The previous private Realtime channel
join evidence remains applicable, with the additional post-switch handshake
confirming the Realtime endpoint remains reachable.

Caddy is an optional staging frontend ingress used to prove one proxy path to
the Supabase Edge API. It is not required by the Supabase backend and does not
select the eventual production frontend host. The production deployment may
use the selected static host directly or another reviewed proxy; it must
preserve the API routing, cookies/CORS, deep links, service worker, exports,
and Realtime behavior covered by the Caddy rehearsal. No FastAPI/Python
process was involved.

### Frontend hosting cleanup — 2026-10-09

The decision is to remove Caddy from the intended deployment architecture and
leave frontend provider selection for a separate decision. The completed Caddy
and Playwright run above remains historical audit evidence for one valid
same-origin proxy implementation; it is not a required backend component or a
production hosting choice. The Caddyfile, Caddy-based Dockerfile, Compose
stack, Caddy-only environment values, and Caddy deployment instructions have
been removed. No staging database, Supabase Edge deployment, Cron, or
production setting was changed.

Frontend behavior is unchanged: production `API_BASE_URL` remains same-origin
and relative (`/api`); API calls continue to include credentials; auth cookies
retain `HttpOnly`, `Secure`, and `SameSite=Lax`; Vite's separate-origin
override remains development-only; Realtime continues to use its Supabase
WebSocket path; the static host must preserve SPA fallback, `/sw.js`, and PWA
assets. Because cross-origin calls to the Supabase project host are not
assumed compatible with the current cookie policy, the eventual provider must
implement the provider-neutral same-origin rewrite contract in
`PRODUCTION_CUTOVER.md`, including request/response cookie headers and
allowlisted Origin/CORS behavior. No provider has been selected or provisioned.

### Final Cloudflare staging security gate — 2026-10-09

**Target:** `https://adaptive-lifting-staging.gartman-bekaali.workers.dev`
(`adaptive-lifting-staging`, Worker version
`a57abdff-8e50-40b2-b97b-e484f4729cee`). Supabase project:
`admyuepbbtstayaydjmo`. The staging owner reported `COOKIE_SECURE=true`,
`APP_ENV=staging`, the exact Worker origin in `CORS_ALLOWED_ORIGINS`, and the
Worker URL in `APP_URL`. Runtime confirmed secure cookie behavior and exact
origin acceptance. The management interface does not expose Edge Function
environment values and OAuth/provider links are disabled, so the literal
`APP_ENV` and `APP_URL` values and an APP_URL-based redirect remain
owner-reported rather than independently read back.

The API Edge Function received version `101` (bundle SHA
`51bbb95beae866b79f47dc4a05da0ca279a77ab83a31e14b175909c509ffbf46`). It
centralizes mutation-origin enforcement before route dispatch for POST, PUT,
PATCH, and DELETE. Exact configured origins are accepted; null, missing,
untrusted, or conflicting Origin/Referer values are rejected. Forwarded
headers are ignored. Originless non-cookie Bearer requests remain supported.
Safe GET/HEAD routes are unaffected. Stripe and Telegram webhooks remain
outside the browser-origin check and retain independent signature/secret
authentication. Custom JWT validation and existing session behavior are
unchanged. Cloudflare Worker was not redeployed.

Live Node Playwright verification on the workers.dev origin passed: health
200; exact Cloudflare-origin CORS acceptance; cookie `HttpOnly`, `Secure`,
`SameSite=Lax`, and `Path=/`; login; authenticated `/api/auth/me`; session
continuity after refresh; same-origin logout revocation; training create/read/
write; coach/athlete access boundaries; private Realtime token and WebSocket
authorization; root-scoped service worker; SPA deep links; and provider
fail-closed behavior. Thirteen untrusted/missing/null-origin mutation cases
returned 403. A real cross-origin logout returned 403 and the same session
remained valid afterward. Denied requests made no persisted state changes.
The staging REST and GraphQL routes returned 503 PGRST002, consistent with the
owner-confirmed Data API disabled setting.

The disposable athlete, coach, outsider, sessions, workout/exercise/set,
notes, coach relationship/invite, workspace/grant, audit rows, email
verification/outbox, auth security events/subjects, and voucher rate-limit
fixtures were deleted. Scoped cleanup counts were all zero afterward; an
orphan scan across 41 public foreign keys found zero orphan rows. Production
project settings/data and the separate `local-save` checkout were untouched.

Validation completed with `npm.cmd test` (356 passed, 1 skipped),
`npm.cmd test -- cloudflare/worker.test.ts` (5 passed),
`npm.cmd run build` (pass; existing large-chunk advisory), and all available
Supabase Edge tests (69 passed with Deno `--no-check`; focused changed tests
passed 11). Deno's default type check still emits known `BufferSource`
diagnostics in `fernet.ts` on the available Deno version.

To roll back only the Worker if it is later redeployed, run:

    npx wrangler rollback a57abdff-8e50-40b2-b97b-e484f4729cee --name adaptive-lifting-staging

To revert API Edge version `101`, use the staging project's Supabase Dashboard
to restore API version `100`, or redeploy the reviewed version-100 source.
Never roll this change into production as part of staging rollback.
