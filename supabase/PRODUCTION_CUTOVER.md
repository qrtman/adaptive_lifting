# Production launch and cutover runbook (planning only)

This is a future operator procedure. It does not deploy production or authorize
a data migration, DNS change, provider activation, purchase, or paid-plan
change. Core Cloudflare staging is validated; the current live production
host, database, data, provider state, and backup health have **not** been
independently verified. See
[`PRODUCTION_READINESS_AUDIT.md`](PRODUCTION_READINESS_AUDIT.md) for evidence,
owner confirmations, table mapping, current quota/cost review, and provider
checklists. Staging evidence is in [`STAGING_VALIDATION.md`](STAGING_VALIDATION.md).

## Architecture and current state

Target architecture:

- React/Vite PWA served as Cloudflare Workers Static Assets with SPA fallback.
- A thin Cloudflare Worker runs only on same-origin `/api/*` and forwards to
  Supabase API Edge Functions; it has no application database or business
  logic.
- Supabase Edge Functions, PostgreSQL private RPCs, Vault, Cron/pg_net, and
  private Realtime are the application backend.
- Original custom HS256 session JWT/cookie remains in use; offline grant and
  private Realtime ES256 keys remain independent. Supabase Auth is not adopted.
- Python/FastAPI, Caddy, Compose, Render, Back4app, and other backend hosts
  are not part of the target runtime. Python migrations/model files remain
  compatibility/history sources, not an application server.

Staging is deployed at
`https://adaptive-lifting-staging.gartman-bekaali.workers.dev`. Production is
not deployed by this runbook. The old production record quoted in
`docs/serverless-migration-feasibility.md` describes a September 2026
self-hosted stack, but that report is historical and the current production
state is unknown. Do not describe that old Compose/Caddy stack or an
unselected frontend host as current target architecture.

## 1. Prerequisites

Before scheduling a production rehearsal, obtain written owner confirmation of:

- Current public origin, legal/domain owner, registrar renewal, authoritative
  DNS and Cloudflare zone/account access; current active host and release.
- Current source PostgreSQL host, version, location, exact Alembic revision,
  extension/collation/time-zone state, counts/size and read/write services.
- Current accounts, sessions, offline devices/queues, workout/tombstone,
  coaching, audit, integration and provider job counts.
- Billing account/mode, customers, subscriptions, vouchers/grants,
  pending/replayed webhooks and unresolved out-of-band entitlements.
- Latest verified backup, independent copy, encryption-key custody, restore
  measurements and ratified RPO/RTO.
- Supabase production project/ref/region/organization/billing plan, cost
  ceiling, capacity requirements and allowed data residency.
- Provider accounts, credentials, domains, callback URLs, actual enabled
  states, quotas, pending events and business/compliance approvals.
- Session continuity decision: preserve valid sessions and keys, or force
  reauthentication. Confirm queue-drain and user communication plan.

The historical inventory and exact unresolved facts are in
`PRODUCTION_READINESS_AUDIT.md`. Do not connect to production until the owner
separately authorizes a read-only inventory. Do not infer a current fact from a
historical release report.

## 2. Readiness gates

All gates require dated, reviewable evidence attached to the release record:

1. Production inventory is confirmed from current owner-controlled records.
2. The clean target is reproducible: an audited schema-bootstrap artifact
   exists, then the 62 Supabase migrations apply in a clean, version-matched
   rehearsal database with no unexplained drift.
3. Full data migration/import and restore rehearsal passes row, key, foreign
   key, tombstone, identity, billing, numeric/domain, export and authorization
   reconciliation.
4. Latest independent backup restore passes measured, owner-ratified RPO/RTO;
   a scheduled encrypted backup/alert path is staffed and monitored.
5. Offline client queues are drained/acknowledged or a tested recovery path is
   approved. No undelivered IndexedDB mutation is knowingly discarded.
6. Staging and production secret names, least-privilege roles, private RPCs,
   browser/Data API denial, exact CORS/CSRF origins, Secure cookies, Realtime,
   Vault and Cron are reviewed. APP_URL-dependent URLs are proven via real
   provider behavior before that provider is enabled.
7. Usage tests and the selected Cloudflare/Supabase plan have enough quota
   margin; actual account spend controls, non-spend-capped add-ons and provider
   charges are explicitly approved.
8. Production candidate/browser/worker/provider checks pass; logs and alerts
   are redacted, owned, and actionable; rollback decision is approved.

At present, the schema bootstrap, production inventory, full data/restore
rehearsal, provider E2E, account-specific capacity/cost, and post-write
rollback path are blockers. Staging success is not a substitute for these
production gates.

## 3. Future infrastructure setup

Only after separate infrastructure approval:

1. Provision or designate a **separate production Supabase project** in the
   owner-approved region and plan. Do not use staging ref
   `admyuepbbtstayaydjmo`; do not assume another production ref exists.
2. Apply the reviewed clean-schema bootstrap, then the checked-in Supabase
   migrations in the rehearsed order. Do not run only those 62 migrations on
   an empty project: they do not include a complete application-table
   baseline. Confirm Postgres major version and extensions first.
3. Configure restricted runtime and worker DB roles, private `al_private`
   schema/RPC permissions, no browser table grants, Data API policy, Vault,
   Realtime private Broadcast authorization, and exactly named Cron jobs.
   Inspect effective grants, not only migration source.
4. Configure production secrets only in Supabase Edge/Vault. Use unique
   production keys; maintain temporary key overlap only where explicitly
   needed for JWT/offline/integration ciphertext compatibility. Do not reuse
   staging secrets or place secrets in CI build variables, Wrangler vars, or
   Vite output.
5. Prepare a separate production Wrangler config named for the production
   Worker, with the exact production Supabase origin, production-only bindings,
   `dist/`, SPA fallback, and Worker-first `/api/*`. Keep
   `wrangler.jsonc` staging-only. Add a protected manual production workflow
   with least-privilege credentials, reviewed commit SHA, approval, dry-run,
   and explicit project/Worker assertions before deployment.
6. Keep `API_BASE_URL` relative/empty in the production browser build. Public
   Google client ID/offline public key may be built only when approved; no DB,
   Supabase service-role, JWT private, provider, email, Stripe, webhook,
   encryption or signing secret can enter the browser bundle.
7. Configure exact production `APP_URL` and comma-separated HTTPS
   `CORS_ALLOWED_ORIGINS`; `APP_ENV=production`, `COOKIE_SECURE=true`,
   host-only session cookie, HttpOnly, Secure, SameSite=Lax and `/` path. No
   wildcard or staging origin. Check settings by actual runtime and provider
   flow; never add a diagnostic endpoint exposing environment values.
8. Preserve same-origin `/api/*`, untouched Set-Cookie, private/no-store API
   responses and direct Realtime WebSocket behavior. Select the existing
   owner-confirmed domain if still controlled; do not purchase/transfer a
   domain as part of this runbook.

## 4. Data migration rehearsal

Use a disposable source clone and isolated target; no live production rows in
the first rehearsal. Build a reviewed import manifest for every table and
column from legacy Alembic models through revision `0011_email_verification`
and the Supabase private SQL catalog. Preserve data that is not currently read
by the browser if it affects future auth, replay, audit, billing, integrations
or support.

Rehearse, in order:

1. Reproduce target schema from the bootstrap artifact plus all 62 checked-in
   Supabase migrations. Store catalog diff and migration SHA evidence.
2. Restore the encrypted source snapshot into an isolated PostgreSQL instance;
   record source schema and data digests. Use compatible `pg_dump`/`pg_restore`
   client/server versions. Do not use Supabase staging as the production
   rehearsal target.
3. Import in verified FK dependency order: users; workspaces/members/grants;
   coach links/history/invite codes; mesocycles/microcycles/workouts/exercises/
   sets and retained raw accessories; notes/cards; devices/sessions/locks/
   sync mutations/events/audit; billing customers/subscriptions/reservations/
   vouchers/limits/webhook inbox; then integration connections/credentials/
   outbox and worker state. Adjust the order to exact catalog FKs discovered
   in rehearsal; no deferred-constraint assumption is permitted.
4. Preserve exact IDs, password hashes, verified Google `sub`, ownership,
   numeric values, labels, completed states, deletion tombstones, immutable
   billing provider IDs and audit/event history. Preserve valid session state
   only if the session/key continuity gate is approved. Expire one-time OAuth
   and Telegram linking state; retain durable connections/events/jobs.
5. Preserve the integer coaching relationship key and its history references;
   re-align only verified owned sequences after explicit ID import. Check
   unique and FK constraints. No `ON CONFLICT DO NOTHING` that silently drops
   existing data; every rejected row must be explained and resolved.
6. Do not run the historical accessory string parser blindly. Keep raw rows
   and perform only a reversible, approved conversion. Missing/ambiguous
   set/reps/RPE/weight values must not become invented canonical values.
7. Compare exact row counts and ordered key/digest manifests for every table;
   active/tombstone distribution; all FK/unique constraints; training domain
   totals/sets/date/labels; role/coach access; customer/subscription/grant/
   voucher state; webhook order/dedup; outbox checkpoints; and export/API
   response parity. Do not expose row-level PII in evidence.
8. Test auth, session revocation, old-client sync/replay idempotency, coach
   unlink/history, training mutation, billing disabled paths, provider
   webhook signature/replay, private Realtime, Cron claim/retry and restore.
   Record and resolve every discrepancy; repeat import from a clean target.

The preferred live cutover uses a controlled write freeze rather than dual
writes: obtain client queue-drain acknowledgement while the source is still
available; publish maintenance notice; stop new app/admin writes and old
outbox workers; wait for transactions/locks; handle provider webhook retries;
take the final encrypted consistent snapshot; import to the already-tested
target; reconcile; and only then enable target writes. No browser-local queue
can be proven drained from database table counts alone. If its client-side
drain state is unknown, cutover stops.

## 5. Production candidate verification

Use an isolated candidate host/Worker and protected candidate database before
public traffic. Restrict access and minimize data; use synthetic data for
functional E2E. If using any production-derived copy, require a separate
privacy/security approval and access controls. Validate:

- Health and exact production project reference; static assets, hashed assets,
  SPA/deep-link refresh, manifest/icons and root `/sw.js` update/activation.
- Same-origin `/api` routing; no production data/API cached; no private
  credentials in bundle/config; exact CORS, preflight and CSRF; cookies remain
  HttpOnly/Secure/SameSite=Lax/Path=/; no forwarded-header trust.
- Password and Google login according to chosen account policy, `/api/auth/me`,
  refresh continuity or deliberate reauth, logout/revocation, offline grant
  expiration and queue retention/recovery.
- Athlete-owned data, coach-code link/unlink/frozen history, positive and
  negative role/ownership boundaries, workout locks, tombstone behavior,
  idempotent offline sync, notes, analytics and exports.
- Private Realtime authorization and WebSocket, event ordering/cursor behavior,
  database reconnect/cold start and concurrent user load.
- Email, Google sign-in, Telegram, Sheets, Stripe and voucher checklists from
  `PRODUCTION_READINESS_AUDIT.md`; otherwise verify each remains fail-closed.
- Cron success/lag, outbox age/retry/claim correctness, backup freshness,
  restore evidence, rate limits, safe operator access, alerts and quota usage.

Do not call provider-dependent APP_URL tests passed while the providers remain
unconfigured. Do not use live payments or real external messages during
candidate validation.

## 6. Explicit cutover approval

After gates 1–5 pass, prepare a change ticket with: owner confirmation report,
exact source/target and release SHAs, schema/bootstrap/migration hashes,
backup/restore/RPO/RTO evidence, row/digest/FK reconciliation, account/session
choice, drained queue evidence, provider state, quota/cost forecast, monitoring
owners, previous Worker version and tested rollback/recovery decision tree.

The production owner must explicitly approve a named maintenance window,
traffic/DNS action, provider callback transition, live billing state, user
communication, and acceptance/abort authority. Approval must be separate from
this planning document. No cutover is approved now.

## 7. Cutover execution (future, approval required)

1. Announce maintenance. Have all clients sync and acknowledge empty mutation
   queues; keep source serving until this gate is met.
2. Enter write freeze. Stop old API mutations, operator writes, old background
   consumers, and duplicate provider receivers. Confirm in-flight work,
   workout locks, outbox leases and final webhook event state are safe.
3. Take the final encrypted full source backup. Verify its digest and restore
   it to a disposable location if not already restored from the same freeze
   artifact. Record a UTC cutover point.
4. Import to target, run all reconciliation checks and confirm no unexplained
   row, key, sequence, FK, billing or domain differences. Keep target writes
   disabled until approved acceptance checks begin.
5. Deploy the reviewed production Edge release and distinct Cloudflare Worker
   version from the same commit, with production-only bindings. Record exact
   Supabase function versions and Cloudflare Worker version ID. Worker
   deployment and DNS routing are distinct steps; do not attach production
   domain until explicit approval.
6. Change direct provider webhook endpoints/Telegram webhook only after target
   state is ready. Keep event delivery retryable, preserve event IDs and verify
   signature/mode. Never acknowledge an event that wasn't durably recorded.
7. Route the existing confirmed public app origin to the production Worker.
   Preserve the origin where possible for host-only cookies, service worker
   and IndexedDB. If the origin changes, the cutover must include a separate
   queue/cookie migration plan; DNS alone does not migrate browser state.
8. Run the candidate verification smoke in production with authorized
   synthetic accounts, clean fixtures, monitor all components, then reopen
   ordinary writes and document the acceptance time.

## 8. Post-cutover monitoring

During the owner-approved observation window monitor authentication failures,
session revocations, CSRF denials, 5xx/latency, DB CPU/connections/size/read-only
state, Edge limits, Worker requests/CPU, Realtime connections/messages, Cron
last success/outbox lag, email bounces, OAuth errors, webhook retries/order,
Stripe reconciliation, backup age/checksum and support reports. Alerts must
route to named people and redact secrets and user training data. Compare live
aggregate counts/digests and domain metrics to the acceptance manifest. Do not
activate another provider or broaden traffic before the prior provider gate
passes.

## 9. Rollback and recovery

Cloudflare Worker rollback to a recorded previous version can restore prior
Worker code/config only; it does not restore Supabase data, provider state,
DNS records, or the schema. An Edge code rollback likewise does not undo SQL
or database writes. Never run destructive down migrations as an emergency
shortcut.

- **Before target accepts writes:** freeze, route the public origin back to
  the previously recorded old host/version, restore provider endpoints if
  needed, validate cookies/API/session behavior there, and retain the target
  database for diagnosis. This is safe only if the old code still understands
  every schema change it may encounter; otherwise keep users in maintenance
  mode and fix forward.
- **After target accepts writes:** do not simply roll frontend routing back.
  Old code may be incompatible with new schema, verification fields, event
  rows or newly written values. Stop writes, take a new target backup, preserve
  all provider events, and choose either a forward fix or a rehearsed
  reconciliation/backport of every target write and external side effect into
  a compatible source. No such reverse-sync procedure has been demonstrated
  in this repository. Until it exists, post-write rollback to old backend is
  blocked; prefer restoring the target into a new compatible Supabase project
  and routing forward.
- Restore only from a verified backup after the owner accepts its recovery
  point and potential data loss. Reconcile events/payments/messages delivered
  after the snapshot; do not claim the Cloudflare rollback recovered them.
- Keep the old database intact and read-only until data parity, provider
  reconciliation, backup restore and acceptance are confirmed. Retire it only
  after separate approval and retention/legal review.

## Historical evidence retained

- The 2026-09-28 production deployment snapshot and R2 restore record are
  quoted in `docs/serverless-migration-feasibility.md`; they are not live
  production verification.
- The earlier Compose/Caddy rehearsal and migration reconciliation remain
  historical records in `STAGING_VALIDATION.md`. Caddy/Compose are not active
  target architecture.
- Cloudflare staging deployment and final authenticated security evidence are
  recorded in `docs/cloudflare-workers.md` and `STAGING_VALIDATION.md`.
- Provider-specific implementation and setup notes remain in
  `docs/email-verification.md`, `docs/integrations-supabase.md`,
  `docs/stripe-webhooks.md`, and `docs/launch-runbook.md`.
