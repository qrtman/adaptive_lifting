# Production readiness audit (planning only)

> **Superseded launch decision (2026-10-10):** the owner has finalized a
> completely fresh production application database. Historical users,
> passwords, sessions, training records, billing, provider credentials and
> queued jobs will not be imported. Historical import/reconciliation and
> session continuity sections below are retained only as dated audit evidence;
> they are not production launch gates. Follow the current
> [fresh production launch runbook](PRODUCTION_CUTOVER.md). The production
> domain is confirmed as `https://app.goatedmethod.me`; no production project
> has been provisioned.

**Assessment date:** 2026-10-09  
**Repository state reviewed:** `supabase-staging-validation` at
`0a3b8d8f08dd9a58240b897ce9ae718c53ea6611`  
**Production action:** none. No production account, service, database, DNS, or
provider was accessed or changed.

## Current launch status after the owner decision

- **Ready:** staging validation; 63-migration strict replay; synthetic-only
  historical compatibility evidence retained for engineering; isolated
  production Wrangler template; guarded clean-project bootstrap; production
  browser storage generation boundary.
- **Pending:** owner selection/approval of a new project, region and plan;
  fresh production keys; verified email sender and delivery worker before
  opening password registration; Data API disabled/restricted; production
  backup/restore rehearsal; isolated Worker/API deployment; existing hostname
  route cutover; live smoke tests.
- **Removed from launch path:** historical account/data import, session
  continuity, legacy billing reconciliation, and legacy provider-key recovery.
  No historical import decision is pending.
- **Not authorized:** project creation, plan selection, secret provisioning,
  production deployment, provider activation, or domain route/DNS change.

This audit treats staging results as evidence for the application design, not
as proof of the current production environment. It does not authorize a
purchase, paid plan, provider activation, data transfer, or production launch.

## Operator decision

### READY

- Core Cloudflare staging passed cookie security, same-origin API proxy,
  authentication, training, authorization, CSRF, PWA, Realtime, provider
  fail-closed, and authenticated browser checks. See
  [`STAGING_VALIDATION.md`](STAGING_VALIDATION.md).
- The intended runtime is React/Vite static assets on Cloudflare Workers,
  same-origin `/api/*` proxy to Supabase Edge Functions, Supabase PostgreSQL
  private RPCs, Cron workers, and private Realtime. It retains the original
  HS256 app-session JWT and custom HttpOnly cookie; it does not adopt Supabase
  Auth or add a Python/FastAPI runtime.
- A migration sequence, reconciliation contract, provider gates, and
  cutover/recovery outline are now documented in
  [`PRODUCTION_CUTOVER.md`](PRODUCTION_CUTOVER.md).

### PENDING

- Owner inventory and access confirmation for the currently operating public
  host, registrar/DNS, production database, providers, billing, and backup
  systems. The current audit performed no live production access.
- A canonical, reviewable clean-database schema bootstrap. The repository has
  62 timestamped Supabase SQL migrations, but they are primarily private RPC,
  grants, and service additions and are not a complete empty-database
  bootstrap. `supabase/migrations/README.md` points at the legacy Alembic
  baseline instead. The cutover documentation's former instruction to apply
  only the 62 SQL files to an empty project was unsafe and has been replaced.
- A source-to-target import rehearsal, including accessory conversion policy,
  billing/credential compatibility, offline queue handling, and restore.
- Production projects, accounts, exact regions, capacity, plan/billing, secret
  provisioning, release isolation, and monitoring configuration.
- Provider credential/callback setup and actual provider-dependent E2E.

### BLOCKED

Production launch remains blocked until (1) the live production inventory and
owner confirmations below are current, (2) the clean target schema is
bootstrapped from a reviewed artifact and all migration differences are
reconciled, (3) a full data-import and recovery rehearsal passes, (4) backups
and restore meet an owner-approved RPO/RTO, (5) account, coach, billing, and
offline-queue parity is demonstrated, and (6) the chosen Supabase plan and
expected charges are approved. Free-tier eligibility is not a production
availability or backup plan.

### NOT AUTHORIZED

No production deployment, Worker creation, Edge deployment, DNS route change,
provider activation, live charge/message, Supabase Auth change, production
database connection, data migration, purchase, or plan upgrade is authorized.
Cutover requires a separate explicit approval after these gates pass.

## Production inventory: facts versus assumptions

The old production deployment report at
`C:\Users\admin\local-save-hosting\deployment-c8c0181\deployment-report.md`
was read from its separate local evidence directory, and its findings are
also summarized in the 2026-09-29 feasibility report. It is not a tracked
artifact in this checkout. This was a read-only review of a dated report, not
live production telemetry or a current service check.

| Subject | Historical evidence in repository | Current fact / owner confirmation required |
| --- | --- | --- |
| Public origin and domain | The 2026-09-28 report records `https://app.goatedmethod.me`, Cloudflare Tunnel and Cloudflare DNS. | Confirm present registrant, renewal, authoritative DNS, Cloudflare zone/account, domain-admin access, current A/AAAA/CNAME/Tunnel/Worker records, and whether this remains canonical. Do not change DNS during this audit. |
| Application hosting | The report records Docker Compose, Caddy/static assets, Uvicorn/FastAPI, Python worker, WSL/systemd and Tunnel. It records deployed source `c8c0181a90c9962e779f633c2bc48bca1b971435` from branch `local-save`, previous release `ee6b8ad`, with images built and running at the time. | Confirm which host/process currently serves traffic, source/image IDs, operator access, uptime, maintenance and rollback mechanisms. Current repository architecture selects Cloudflare Workers + Supabase as target and staging is deployed; it does not prove production moved. |
| Database engine/version/location | The report records Docker PostgreSQL 17 and Alembic revision `0010_voucher_redemption_limits`; it does not state cloud region because the DB was described on the local host. | Confirm current engine/version, region/data location, host/volume, schema revision, extensions/collation/time zone, network path, actual size/WAL, connection limits, and all replicas. No production endpoint was queried. |
| Accounts and training | The report says all 24 then-existing production tables retained identical data digests across the release migration; final cleanup restored the 18 original workout count. It gives no full current account/table counts. | Confirm current counts and exact ID sets for users, sessions, Google subjects, coaches/athletes, plans, sessions/workouts, exercises/sets, notes, tombstones, audit/events, devices, and pending offline mutations. |
| Authentication/session | The repository describes custom bcrypt credentials, `google_sub`, HS256 JWTs backed by `sessions`, and separate offline/Realtime ES256 keys. Historical browser checks reported a cookie/session passed at that date. | Confirm current production key custody/version, active/revoked/expired session counts, cookies and client versions, verification/legacy eligibility policy, Google identities, and whether preserving sessions or forcing reauthentication is chosen. |
| Billing/vouchers | The historical release report recorded Stripe catalog/checkout/portal and vouchers as disabled, with zero subscriptions, customers, checkout reservations, vouchers, webhook rows, and redemption limits after its disposable cleanup. | Confirm current Stripe account/mode, customer/subscription IDs and status, price mapping, invoices/refunds/disputes, unprocessed provider events, every voucher's issued/redeemed state and HMAC key, grants/entitlements, and any out-of-band support commitments. Historical zero counts are not current counts. |
| Backups and restoration | The report records a pre-migration encrypted recovery point `postgres-20260928T111350Z.dump.age` restored at revision `0004_outbox_result`, and a post-deployment `postgres-20260928T112023Z.dump.age` restored at `0010_voucher_redemption_limits`; downloaded R2 files matched SHA-256, local encrypted copies also matched, and a local backup timer was enabled with its latest run successful at report time. The feasibility report describes 30 retained snapshots. | Confirm latest backup timestamp, actual bucket/account/retention/lifecycle, encryption and recovery-key custodians, independent copies, current scheduler/host, measured restore date/data, and owner-approved RPO/RTO. Historical restore/timer evidence does not prove current operation. |
| Providers and endpoints | The old release report described provider features disabled/fail-closed; repository runbooks define Resend, Google, Telegram, Sheets, and Stripe integrations. | Confirm live credentials, enabled flags, sender/domain verification, OAuth client/verification state, Telegram bot and webhook, Sheets consent/callback, Stripe mode/endpoint/events, pending outboxes, webhook secrets, data retention, and any real external side effects. |
| Supabase production project | Repository records staging project `admyuepbbtstayaydjmo`; no current production project ref or data-bearing Supabase production project is established by this checkout. | Confirm whether a production Supabase project already exists; if so its ref, organization, region, plan, Data API setting, database version, applied schema, access roles, Vault secrets, Realtime, Cron, backups, and resource ownership. Never copy staging configuration or secrets by assumption. |

## Data migration design

### Schema prerequisite and deployment order

The checked-in history is split. The 62 files in `supabase/migrations/` are
Supabase-side additions/replacements. `supabase/migrations/README.md` states
that the foundation adds no SQL migration and references the Alembic model
baseline. The legacy SQLAlchemy schema is defined by
`backend/migrations/versions/0001_current_schema.py` and follow-on Alembic
revisions through `0011_email_verification`; current Supabase timestamped SQL
assumes those application tables already exist. Therefore **do not** replay
the 62 files against an empty database and do not assume the target is created
by that list alone.

Before any production data work:

1. Freeze the exact release commit. Generate a deterministic PostgreSQL schema
   bootstrap offline from the complete reviewed Alembic history or an
   equivalent audited schema snapshot. Check in and review its SQL, grants,
   indexes, constraints, extensions, and ownership. Do not make FastAPI or
   Python an application runtime dependency.
2. Create only a disposable rehearsal target after separate authorization.
   Apply the schema bootstrap to an empty database matching the chosen
   Supabase PostgreSQL major version. Compare normalized catalog definitions
   with the complete current staging schema and intended production schema.
3. Apply all 62 Supabase SQL migrations in their checked-in deterministic
   order to that clean target. Prove repeatability and capture exact hashes,
   timestamps, resulting migration history, private RPC definitions, grants,
   RLS posture, and Cron/Realtime dependencies. Staging has 24 historical
   version-prefix differences and one harmless ordering swap; don't import
   or rewrite that staging history to make the clean target appear current.
4. Only after an independent clean-target replay passes can a production
   migration sequence be approved. Do not perform this work in place against
   the existing production PostgreSQL instance.

### Source/target mapping and transformations

Use the legacy `backend/database.py`/Alembic models as the source schema and
the reviewed bootstrap plus Supabase migration catalog as the target. Preserve
all source application tables, including historical or operational tables
not read by the current UI. Initial mapping is 1:1 by table name where the
catalog confirms parity:

| Domain | Tables and import requirements |
| --- | --- |
| Identity and auth | `users` (same user ID, normalized email as stored, bcrypt hash, role, display name, `google_sub`, creation/update/deletion and verification flags); `sessions` (session ID, user ID, `jwt_id`, expiry/revocation); `client_devices`; `sync_mutations`; `auth_security_subjects` and in-window `auth_security_events`; `email_verification_tokens`. Preserve live security history and replay keys. Never log hashes, credentials, cookie/JWT values, or raw tokens. |
| Athlete plan and workout history | `mesocycles` → `microcycles` → `workouts` → `exercises` → `exercise_sets`; preserve IDs, owner IDs, dates, nullable labels, order/ranks, typed numeric planned/logged values, all metric inputs, created/updated timestamps, status, and tombstones. Keep empty plans empty. Preserve `domain_events`, accepted/rejected `sync_mutations`, device IDs, and audit records required for replay/history. |
| Legacy accessory data | Preserve `accessories` raw rows first. `backend/accessory_migration.py` parses leading numbers (`10-12` becomes `10`, non-numeric gets defaults), expands a row across generated set rows, and can therefore lose prescription meaning. Do not apply it blindly. Build an approved field-by-field conversion, retain source row IDs/values in a reversible mapping, review ambiguous ranges and statuses, and validate counts/exports before any conversion. |
| Notes and analytics UI | `day_notes`, `insight_cards`, and `sheet_publications`; preserve text/date, owner, config/layout JSON, ordering, tombstones, and export metadata. Validate JSON encodings and date semantics. |
| Coach access | `coaching_relationships`, `coaching_history_snapshots`, `invite_codes`, `workspaces`, `workspace_members`, `access_grants`. Preserve athlete ownership, coach codes as hashes, active/ended status, frozen history, capacity, audit and role links. Reconcile owner/member/grant policies and ensure no relationship changes during import. |
| Billing | `billing_customers`, `subscriptions`, `billing_checkout_reservations`, `vouchers`, `voucher_redemption_limits`, `webhook_events`, plus related `access_grants`, `workspace_members`, and `audit_events`. Preserve provider customer/subscription/event IDs and ordering, external price mapping, status, current periods/cancellation/grace state, request idempotency, voucher hashes/assignment/expiry/redemption/revocation, and operator audit. Never replay or create a live Stripe event during migration. |
| Integrations and jobs | `integration_connections`, `integration_credentials`, `oauth_states`, `telegram_link_tokens`, `webhook_events`, `integration_outbox`, and worker lease/checkpoint state. Preserve durable connections, encrypted credential payloads, dedupe/event identities, queued work, retries, results, and spreadsheet IDs. Expire one-time OAuth/Telegram link state at cutover; reconnect flows are safer than carrying stale callbacks. Re-encrypt credentials only in a controlled tool if the key is rotated and every row passes decrypt/re-encrypt verification. |
| Locks and transient controls | `workout_locks` and `voucher_redemption_limits` need a deliberate quiescent-window policy. Drain/release expired workout locks before snapshot. Preserve active anti-abuse windows or expire them only under an approved rule; do not silently reset limits. Keep audit rows even if expired limiter events are pruned under the existing retention policy. |

IDs in the SQLAlchemy model are predominantly string primary keys (including
user IDs and prefixed workout/exercise/set IDs). Preserve their exact bytes;
do not regenerate UUIDs or remap provider identities. `coaching_relationships`
uses an integer autoincrement key in the legacy ORM and
`coaching_history_snapshots.relationship_id` references it. Preserve those
integer values and, if the verified target DDL uses an owned sequence, advance
that sequence to at least the imported maximum before writes resume. Inspect
all target identity/sequence defaults from the clean schema; don't assume
`setval` is irrelevant or run it against unrelated sequences.

The source model contains numeric workout values and also legacy accessory
prescription/log columns represented as strings. Convert only fields whose
target contract is numeric, with an explicit parser/rounding/unit/NULL policy;
never turn missing values into fabricated zeroes or infer user intent from a
string range. Preserve date-only `workouts.date` (`YYYY-MM-DD`) rather than
timezone-converting it; preserve the meaning/timezone of audit, event, token,
session and integration timestamps. Keep IDs in `users.id`, `microcycles.id`,
`workouts.id`, `exercises.id`, `exercise_sets.id` and related FK columns
unchanged, including application prefixes such as `w-`, `e-` and `s-`.
Validate the precise source/target names for legacy mixed-case model fields
(`startDate`, `weekName`, `dayLabel`, `plannedReps`, etc.); use an explicit
column map and never infer a target rename from casing. Preserve JSON semantics
for card layouts, audit metadata, webhook payloads, and outbox payloads even if
the physical source/target representation is text versus JSON/JSONB. On the
`users` verification fields, follow the reviewed `0011_email_verification`
policy: never invent a password email verification timestamp; preserve the
legacy-exempt policy for historical password accounts and verified Google
subject treatment only after matching that migration's tested rules. Do not
use legacy `users.subscription_status` by itself as entitlement authority;
reconcile workspaces, memberships, grants and provider subscription records.
Check character encoding and normalization without silently rewriting names
or notes.

### Session continuity options

Choose and communicate exactly one of these before rehearsal:

- **Preserve sessions:** import valid, unexpired, non-revoked `sessions` rows;
  preserve exact `jwt_id`, app JWT issuer/audience/claims, cookie name/path,
  current/previous HS256 signing key compatibility, and same public origin.
  Transfer signing keys directly between secret stores, never through build
  variables/logs. Preserve the offline ES256 verification/public key and
  handle the private key without breaking already-issued grants (maximum 24h);
  preserve/rotate Realtime keys with an overlap test. Verify active session and
  revoke semantics on a protected candidate before cutover.
- **Reauthenticate:** preserve user identity and password hashes, import
  session history as revoked (or retain it with revocation timestamps), and
  rotate the production app JWT key so old cookies fail. Google `sub` remains
  linked; OAuth is not an email-only account merge. Communicate the login step
  and recovery path. First drain or export pending offline queues and decide
  the offline-grant transition; forced login does not sync or restore a local
  IndexedDB queue.

Neither choice can be finalized until owners confirm account policy and
current secret custody. No Supabase Auth migration is in scope.

### Consistent freeze, backup, and reconciliation

Use a write freeze, not dual-write. Dual-write has no transaction or
reconciliation design here. Before the freeze, publish a maintenance notice;
have every supported client connect, sync and report its IndexedDB mutation
queue drained. Current server state does not provide a complete inventory of
undelivered browser-local mutations, so an unobserved offline queue is an
explicit data-loss risk and a no-go. If the app lacks a reliable user-visible
queue-drain acknowledgement, build and rehearse one before launch.

At the authorized maintenance window: stop new application writes and admin
mutations; drain/stop the legacy Python outbox worker and schedulers; stop
accepting source API mutations; preserve failed/retryable outbox items; pause
or direct provider webhook delivery to a retryable endpoint until target data
is loaded. Confirm all active writes and workout locks are settled. Capture a
new full logical source backup at this freeze, plus separate immutable
pre-migration evidence; record UTC time and source revision. Do not allow old
and new systems to write simultaneously.

The import rehearsal and eventual cutover must retain a repeatable manifest:

1. Source and target engine versions, migration/source code SHAs, exact table
   and column mapping version, timezone/encoding, and migration execution log.
2. For every application table: source/target total count, active/tombstoned
   count, primary-key distinct count, and deterministic canonical digest
   grouped in stable PK order. Protect output from PII/secrets; publish only
   aggregate results and SHA-256 manifests.
3. All foreign keys resolved; no unexpected duplicate/unique conflicts;
   users/owners and coaches/athletes exist; each plan row resolves to its
   athlete; each exercise/set resolves to parent; tombstones are retained;
   workspace/customer/subscription/grant/voucher relationships reconcile.
4. Numeric/date/JSON invariants, workout counts, sets per workout, weight/reps/
   RPE sums or typed distributions, labels, completed status, audit/event
   ordering, voucher redemption history, entitlement snapshots, webhook
   deduplication, outbox counts/age/checkpoints, and exported canonical
   workout-tree comparisons.
5. Re-run checks after import and after restore. Independently inspect sequence
   high-water marks and target grants/RLS/private RPCs.

### Backup and restore plan

The historical report records encrypted R2 restores in September 2026, but the
current timer, objects, keys, and restore procedure are unverified. Supabase
Free projects have no downloadable platform backup guarantee; use independent
off-site logical exports regardless of the platform tier. The proposed
minimum is a nightly encrypted `pg_dump` or equivalent, 14 restore points,
SHA-256 verification after upload/download, private object ACL, and a restore
drill to an isolated non-production project at least before launch and on a
scheduled basis. Keep decryption material offline under separate custody.
Budget transfer egress, storage, KMS/key custody, job execution, and alerting.

For each drill: download from the independent copy, verify digest, decrypt in
an isolated operator environment, restore into a disposable project at the
matching schema, apply only the tested forward target migrations, run catalog
and row/domain parity checks, perform auth/training/authorization/provider
fail-closed smoke tests, measure achieved RPO/RTO, then destroy the disposable
environment through its approved retention process. A success-shaped file or
cloud-provider backup indicator is not a successful restore.

Owner must ratify the architecture target RPO of 24 hours and RTO of 4 hours
from `architecture.md` or choose stricter targets. Supabase Pro currently
advertises daily backups retained 7 days; independent 14-point retention is
still needed. Optional 7-day PITR is currently listed at about $100/month and
is outside a spend cap; it is not enabled or approved here. Supabase Pro is
currently $25/month with $10 monthly compute credits (enough for one Micro
project at the listed current rate); additional project compute, usage,
domains, backup/PITR, provider, and domain-renewal charges are separate.
Actual project cost depends on region, compute, data and provider account.

## Cloudflare production configuration design

Staging config `wrangler.jsonc` names only `adaptive-lifting-staging` and
hard-codes only staging origin `https://admyuepbbtstayaydjmo.supabase.co`.
No production Wrangler config or protected production deployment workflow is
present. Do not repurpose that file for production.

Prepare a separate, non-deployed `wrangler.production.jsonc` or an equivalent
explicit production environment with:

- Worker name such as `adaptive-lifting-production`; `main` remains
  `cloudflare/worker.ts`, compatibility date is reviewed/pinned, Static Assets
  points at the reviewed `dist/`, SPA fallback stays enabled, and only
  `/api/*` runs Worker-first.
- `SUPABASE_PROJECT_ORIGIN=https://<confirmed-production-project-ref>.supabase.co`.
  No staging origin/project ref may be inherited. Add a public publishable
  key only if the Edge gateway actually requires it; never use service-role,
  database, JWT, webhook, OAuth-client-secret or provider secrets in Worker
  vars or Vite build output.
- Same-origin proxy preserves methods, query/body, exact Origin/Referer,
  cookies, authorization, and response Set-Cookie; remove untrusted forwarding
  headers; authenticated/API responses are `private, no-store`. Secure,
  HttpOnly, SameSite=Lax host-only cookie attributes stay owned by the API.
  Keep Realtime WebSockets direct to Supabase.
- Production-only static public build values (matching Google public client ID
  only if Google login is enabled, offline public JWK, and no API backend URL
  override). Set exact `APP_URL` and `CORS_ALLOWED_ORIGINS` in the production
  Edge service. Verify a real provider-dependent URL before enabling each
  provider.

Build independent release paths: staging remains freely deployable through
the staging config; production requires a protected/manual CI environment,
least-privilege Cloudflare credential, reviewed commit SHA, lockfile install,
test/build/dry-run, approver, and explicit target assertion before `wrangler
deploy --config wrangler.production.jsonc`. No production CI workflow exists
in the reviewed tree. Store the actual previous active Worker version ID and
rollback command in the release record. Free Cloudflare static asset requests
are unlimited, but `/api/*` invokes the Worker and counts toward the Free
100,000 requests/day and 10 ms CPU/request limits; with `run_worker_first`,
API traffic exceeding the free allowance may be rejected. Confirm production
account usage and response behavior before traffic switch.

## Reliability, capacity, and spend assessment

The table below reflects official plan pages checked on 2026-10-09; quotas and
prices can change. They are capacity limits, not estimates of current demand.

| Service | Current Free capability / restriction | Production implication |
| --- | --- | --- |
| Cloudflare Workers Static Assets | Static asset serving/storage requests are listed as free/unlimited; asset limits include 20,000 files/Worker version and 25 MiB/file. | Suitable for Vite `dist` in observed staging; keep hashed assets and service-worker behavior. |
| Cloudflare Worker `/api/*` proxy | Workers Free: 100,000 requests/account/day, 10 ms CPU/invocation, 50 subrequests/request (daily reset 00:00 UTC). | All API browser calls routed through Worker count. A spike/limit can reject API calls while static assets continue. Alert and model p95/peak users and retries; no API logic growth without a new budget. |
| Supabase Free Postgres | 500 MB/project database quota; 1 GB disk allocation and database becomes read-only above 500 MB; 5 GB egress and 5 GB cached egress, 1 GB Storage, shared Nano up to 0.5 GB RAM. | Measure live DB/WAL/backups and growth. Importing data may cross limit; no production data size is known. No auto-scaling/paid overages on Free. |
| Supabase Free projects | At most 2 active Free projects across organizations where the same owner/admin is a member. | Confirm project slots and organization membership before assuming staging plus production both fit; this is not an uptime guarantee. |
| Supabase Free availability/backup | Free projects with low DB activity may pause after 7 days. Free projects do not provide downloadable platform backups. | Not dependable as the sole customer-production plan. Pro does not pause for inactivity and advertises daily backups retained 7 days, but independent backups/restore still required. |
| Supabase Edge Functions | Free quota 500,000 invocations; 2 seconds CPU/request, 150 seconds wall time, about 250 MB memory. | API calls plus Cron workers consume quota. CPU-heavy work, long exports, email, Sheets, lock contention and retries need measured rehearsal. Quota exhaustion/restrictions may affect service. |
| Supabase Realtime | Free usage quota 2 million messages/month and 200 peak connections; published technical limit includes 100 messages/sec and 100 channel joins/sec. | Measure real connection fanout, private channel joins, messages/user/session, reconnect storms. Realtime is direct from browser, not Worker-proxied. |
| Supabase Cron | Postgres `pg_cron`; docs recommend ≤8 concurrent jobs and ≤10 minutes/job. | Database load/HTTP dispatch consumes DB resources; called Edge Functions still have their 150-second Free wall limit. Do not exceed existing worker schedule/claim bounds. |
| Resend Free | 3,000 emails/month, 100/day, three domains; Pro currently starts at $20/month and removes daily cap. | Email spikes may delay/deny verification; estimate account lifecycle volume and include domain/auth support. Paid tier/overage requires approval. |
| Google, Telegram | Provider setup, quotas, scope policy and account state govern; no reliable account-specific allowance/cost was established by this repository audit. | Confirm current API quotas, consent review, Bot API rules and account requirements with provider owners before activation. |
| Stripe | Payment processing/Billing costs depend on business country, payment method, currency, disputes, refunds and product configuration. | Not a $0 service. Confirm fee schedule, tax/compliance, refunds, disputes and business eligibility; run test-mode E2E only until separately approved. |
| Domain, DNS, email domain | DNS hosting/Worker routing may fit existing Cloudflare services; domain registration/renewal and sender-domain operation are not implied free by Worker Free. | Confirm current ownership/renewal and any paid options. Do not buy or transfer a domain in this task. |

The current Supabase Pro reference is a $25/month organization plan with a $10
compute credit; a default Micro project is approximately $10/month before
credit. Pro usage quotas and spend-cap coverage vary by line item. Compute,
PITR, custom domain, IPv4, disk IOPS/throughput and log drains are not all
covered by a spend cap. The current 7-day PITR option is about $100/month;
optional Supabase API custom domain is about $10/month and is unnecessary for
this same-origin Cloudflare proxy design. No upgrade/add-on is authorized.
The published Supabase Auth MAU quota does not apply to this app's custom
`users`/`sessions` login path; its relevant load is PostgreSQL, Edge invocation,
Realtime, egress and provider usage.

Operational monitoring must cover Worker/API 4xx/5xx and quota, Supabase DB
size/read-only state, CPU/connection/egress, Edge 546/504 and invocation count,
Realtime concurrency/message quota, Cron last success/lag/outbox age, auth
failure/abuse patterns, webhook reconciliation, backup freshness/checksum and
restore drill status. Redact JWTs, passwords, cookies, webhook headers,
provider tokens, query parameters containing state, and training PII. Confirm
retention, alert delivery, ownership, and paid observability cost; dashboard
graphs alone are not on-call alerting.

## Provider activation gates

Providers remain disabled until the matching configuration and real staging
E2E have passed. `APP_URL` is owner-reported in staging, but runtime readback
and provider redirects have not been exercised; verify generated/observed
redirects at the final exact origin before enabling each associated provider.

| Provider | Configuration and callback gates | Required staging acceptance before production enablement |
| --- | --- | --- |
| Resend / verification email | Private `EMAIL_PROVIDER_API_KEY`/`RESEND_API_KEY`, verified `EMAIL_FROM`, approved sender domain with provider-required SPF/DKIM/DMARC, independent `EMAIL_PAYLOAD_ENCRYPTION_KEY`; exact `APP_URL`. | Real controlled mailbox receives correct HTTPS `/verify-email#token=...` link on `APP_URL`; token one-use/expiry/resend/replay and delivery retry tested; raw token never logged; no production recipient during staging. Free tier currently 100/day, 3,000/month; more requires paid tier. |
| Google sign-in | Production OAuth web client; `GOOGLE_CLIENT_ID` server-side and matching public `VITE_GOOGLE_CLIENT_ID`; exact authorized JS origin; audience, issuer, expiry, `sub`, verified email checks; public branding/privacy/support URLs and Google verification state. | Sign-in with allowed account; invalid issuer/audience, duplicate email, unverified email, identity collision and account-link behavior all tested; no email-only merge. Confirm authorized origins and any implemented callback/return URLs match the deployed app origin. Do not expose client secret in Vite. |
| Telegram | Private bot token and independent webhook secret in target Vault/Edge path; bot username, exact HTTPS Mini App `APP_URL`, direct Edge webhook URL `https://<prod-project-ref>.supabase.co/functions/v1/api/integrations/telegram/webhook`. | Validate Telegram `initData` signature/freshness, single-use link token across instances, webhook secret, replay/dedup/out-of-order handling, coach/athlete authorization, Mini App URL/link, error/retry without duplicate messages. Use a separate test bot first; no real outbound messages in this audit. |
| Google Sheets OAuth | Client ID/secret in prod secret store, exact callback `${APP_URL}/api/integrations/google-sheets/callback`, Sheets API enabled, consent/brand/privacy links, matching OAuth state and encryption key. Code currently requests `https://www.googleapis.com/auth/spreadsheets` (sensitive access to all spreadsheets); request only necessary scope and submit Google verification if required. | Browser starts OAuth from app, observed `redirect_uri` exactly matches deployed callback, state one-use and CSRF-safe, actual token exchange/refresh/revoke passes, one-way export writes correct sheet, revocation/retry and coach/athlete RBAC pass. Never use testing consent refresh tokens as a production service. |
| Stripe billing/webhooks | Separate live Stripe account/mode and private API key, webhook signing secret, explicit enable flag, `STRIPE_EXPECT_LIVEMODE=true`, exact active recurring Price IDs, `APP_URL`, endpoint `https://<prod-project-ref>.supabase.co/functions/v1/api/billing/stripe/webhook`, limited subscription event set in `stripe-webhooks.md`. | Test mode first for checkout, portal, subscription create/update/cancel/past_due, exact-byte signature, live/test mode denial, duplicate/out-of-order/retry, trusted customer/workspace mapping, configured Price, entitlement/grace, refund/support workflow. Only after approval: one controlled live purchase/refund and reconciled webhook, no live action under this audit. Fees and legal/tax obligations are owner-specific. |
| Vouchers | `VOUCHER_BILLING_ENABLED` explicit flag, stable independent `VOUCHER_CODE_SECRET` in private Vault, private operator functions, issued code delivery/audit and rate limits. | Test issue/inspect/revoke/redeem/expiry/concurrency/replay and assignment/account boundaries; confirm no Stripe call, one grant only, audit complete. Preserve HMAC key while outstanding codes exist, otherwise safely reissue/expire before rotation. Operator-only functions are not browser routes. |

## Official capacity and pricing references

Checked 2026-10-09; confirm again before purchase or deployment:

- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).
- [Supabase plan and billing quotas](https://supabase.com/docs/guides/platform/billing-on-supabase), [database size/read-only behavior](https://supabase.com/docs/guides/platform/database-size), [Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [production checklist/backups](https://supabase.com/docs/guides/deployment/going-into-prod), [Edge limits](https://supabase.com/docs/guides/troubleshooting/edge-function-cpu-limits), [Cron](https://supabase.com/docs/guides/cron), [Realtime limits](https://supabase.com/docs/guides/realtime/limits), [Compute](https://supabase.com/docs/guides/platform/manage-your-usage/compute), and [PITR pricing](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery).
- [Resend pricing](https://resend.com/pricing), [Google sensitive/restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification), [Google Sheets API scopes](https://developers.google.com/workspace/sheets/api/scopes), [Telegram bot webhook guide](https://core.telegram.org/bots/webhooks), and [Stripe pricing](https://stripe.com/pricing).

These published documents do not establish what plan, quota, region, payment
method, account restriction, or provider approval currently applies to this
owner's accounts.
