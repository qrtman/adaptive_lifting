# Fresh production launch runbook

**Owner decision (2026-10-10): production starts with a completely fresh application database and new user accounts.** No legacy accounts, passwords, sessions, training records, billing state, provider credentials, queued jobs, or identities will be imported. The historical importer and rehearsal remain archived engineering tools only.

This runbook prepares a future launch. It does not provision a project, create a Worker, set production secrets, enable providers, route the domain, or authorize paid services. The production domain is `https://app.goatedmethod.me`; the existing proxied Tunnel CNAME and historical database/backups/Tunnel remain untouched.

## Target architecture

- React/Vite PWA served as Cloudflare Workers Static Assets, with SPA fallback.
- A separate production Worker serves assets and forwards same-origin `/api/*` requests only to the configured production Supabase Edge API.
- Supabase Edge Functions and PostgreSQL private RPCs are the application backend; Realtime connects directly to the production Supabase project.
- The app retains custom JWT and HttpOnly cookie authentication. Supabase Auth is not used.
- No Python/FastAPI runtime, Caddy, Compose, Render, or alternate backend host is part of the new production application.
- Production browser data uses the stable `production-fresh-v1` IndexedDB and localStorage namespace. Legacy browser stores remain inert; old mutation queues and cached grants are never imported or replayed.

## Remaining launch sequence

### 1. Owner approves the project and operating plan

Record the new Supabase organization/project reference, region, plan, expected usage, cost ceiling, email sender, backup/recovery objective, and named operators. Confirm the Cloudflare account and existing `goatedmethod.me` zone. The Supabase organization’s current free-project slots and owner billing preferences must be checked in Dashboard; no project has been created or plan selected here.

Free feasibility is limited: current Supabase documentation lists two active Free projects across organizations where the owner/admin is a member, 500 MB database size per project, 1 GB disk with read-only behavior after the 500 MB database quota, 5 GB egress, 1 GB storage, 500,000 Edge Function calls, 2 million Realtime messages, and 200 peak Realtime connections. Free projects can pause after seven days of low activity, and Free does not include downloadable platform backups. Usage restrictions may affect service if quotas are continually exceeded. This is suitable only if the owner accepts inactivity pauses, tight limits, and an independently operated backup/restore process. Verify current terms before provisioning. See [Supabase billing and quotas](https://supabase.com/docs/guides/platform/billing-on-supabase), [Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [database size limits](https://supabase.com/docs/guides/platform/database-size), and [fair-use restrictions](https://supabase.com/docs/guides/platform/billing-faq).

Pro currently starts at $25/month and includes daily backups retained for seven days; point-in-time recovery is an additional paid option. These are options for an explicit owner decision, not authorization. See [Supabase pricing](https://supabase.com/pricing) and [backup guidance](https://supabase.com/docs/guides/database/backups).

### 2. Bootstrap one new, empty managed project

Never point the procedure at staging, the historical database, or any nonempty application database. From the exact reviewed commit, run `supabase/bootstrap/deploy-managed.ps1`. Its default mode is read-only; `-Apply` requires an explicit project ref, matching direct database hostname, a protected schema checkpoint location, and typed project-ref confirmation. It refuses the validated staging ref, application objects, migration records, Supabase Auth users, or Storage objects.

The checked-in order is:

1. Verify authenticated project identity and empty application schema.
2. Apply `supabase/bootstrap/managed-prerequisites.sql` and explicitly apply `supabase/bootstrap/application.sql`.
3. Inspect the migration ledger, dry-run, then apply the 63 checked-in migrations in exact order and assert exact ledger versions.
4. Verify the managed catalog, grants, private RPC permissions, required extensions/Vault/Cron/Realtime prerequisites, and no browser table access.
5. Verify Supabase Data API is disabled in Dashboard and REST/GraphQL are unavailable. The SQL harness cannot verify this platform setting.
6. Run rollback-only synthetic SQL behavior checks and controlled synthetic application tests.

`application.sql` is outside `supabase/migrations/`; Supabase CLI does not discover it. The guarded script applies it explicitly. Never use `local-managed-fixture.sql` on managed Supabase. Do not run these steps until a new project has been separately approved.

### 3. Configure fresh production secrets and email onboarding

Create new, independent production keys; never reuse staging or legacy keys. Configure a new restricted database runtime password and TLS URL, `JWT_SECRET_CURRENT`, `REALTIME_JWT_PRIVATE_JWK`, `OFFLINE_AUTH_PRIVATE_KEY`, and email payload-encryption key. Do not set `JWT_SECRET_PREVIOUS` for this fresh launch. Put private values only in the Supabase secret manager/Vault; use [production.env.example](production.env.example) as the non-secret setting checklist. Confirm custom JWT verification is still performed by the app (`verify_jwt=false` at the Edge gateway), Data API access remains disabled, and custom session cookies are host-only, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.

Self-service password registration is enabled only with email verification required. New password accounts and Google-created accounts begin as `ATHLETE`; there are no seeded or administrator accounts. Without a configured sender and email worker/Vault dispatch secrets, registration must fail closed and show the unavailable state. Configure and test a verified sender before opening signup. Never bypass verification. To create a coach, the account must first register and verify; an authorized database operator may then use the audited `al_private.al_operator_promote_coach` procedure, followed by the workspace setup procedure where required. These functions are not public application RPCs and no client-controlled role promotion is permitted.

Keep Stripe, vouchers, Telegram and Google Sheets disabled. Google sign-in is optional and must not be configured until its client, callback/origin and real redirect E2E have separate approval. `APP_URL` must be proven through the relevant provider-dependent flow before enabling that provider.

### 4. Prepare the isolated production Worker and build

Use `wrangler.production.jsonc` and `scripts/prepare-production-wrangler.mjs` to generate the ignored local production config only after the approved Supabase project reference exists. The committed origin is a placeholder and validation rejects staging fallback. The production Worker identity is `adaptive-lifting-production`, `workers_dev` is disabled, assets use `dist/`, SPA fallback is enabled, and only `/api/*` runs the thin proxy. Realtime uses the same production project origin directly from the browser over WebSocket and is never sent through the API proxy.

Run `npm run validate:production:local`, `npm run build:production`, and the Wrangler dry run against the generated production config. Verify the output contains no private credentials and no staging host/project references. Deploy Edge API and Worker only in an explicitly approved release window, API first, then assets. Do not deploy from the staging Wrangler config.

### 5. Connect the existing hostname without changing its CNAME

Before routing, perform a fresh read-only zone/DNS/Worker-route check and record the then-current Tunnel CNAME, proxy mode, zone owner, and existing Worker routes. The earlier read-only preparation found a proxied `app.goatedmethod.me` CNAME to the Cloudflare Tunnel and no Worker route; that is historical evidence, not a claim about present-day state.

After separate cutover authorization, attach the production Worker route `app.goatedmethod.me/*` in the existing `goatedmethod.me` zone. Preserve the existing CNAME; do not replace, delete, or point it to staging. Confirm route precedence and TLS. Rollback of routing means removing the Worker route so the preserved Tunnel CNAME resumes handling requests; this restores the old route only and does not undo writes to the new app database.

### 6. Verify the empty production application

With test accounts only, verify registration, email verification, login/logout, `/api/auth/me`, secure cookies, session continuity, same-origin API, CSRF, PWA update, deep-link refresh, private Realtime, empty new-athlete plan, and athlete/coach authorization. Confirm new accounts have no preloaded training records. If no verified sender exists, keep public password signup closed and report onboarding as not ready. Do not send real provider messages or payments during smoke tests.

### 7. Backups and recovery

Before accepting real user writes, choose a backup plan and complete a real restore rehearsal into an isolated project. For every plan, retain an independent encrypted logical export outside the database, protect encryption keys separately, record migration/catalog/row/domain checks, and test Cron/outbox isolation before restored jobs can run. A schema-only checkpoint from the bootstrap procedure is not a backup or verified restore. Free plan has no downloadable platform backup and can pause for inactivity; therefore production use requires an owner-approved independent backup operator and tested restore path. If that cannot be staffed and tested, select a plan with suitable backups or delay launch.

## Cutover gates and rollback

Before connecting traffic, attach dated evidence for project identity/region/plan, empty database bootstrap, 63 migration versions, Data API denial, fresh secrets, verified sender/onboarding, production build/Worker dry run, domain route check, candidate smoke tests, backup restore, monitoring owner and cost ceiling. Owner approval must explicitly name the production release commit, maintenance window, route action, acceptance/abort authority and recovery decision.

Before first write, rollback may remove the Worker route and return traffic to the preserved Tunnel CNAME. After new production writes, routing rollback alone is insufficient: the old application is offline and no historical application database is being migrated, while the new app’s schema/data are independent. Keep writes in maintenance mode and use a forward fix or recover the new database from the verified backup. Do not imply that old frontend/API code is compatible with new production writes. Preserve historical database, backups and Tunnel; this launch procedure does not reset them.

## Current status

- Staging remains validated and is not changed by this procedure.
- Production project, production Worker and production secrets: not provisioned.
- Production domain route and DNS: unchanged.
- Historical data decision: final fresh start; no import is in the launch path.
- Providers: disabled pending separate activation checks.
- Backups: procedure documented; production restore remains unverified until a real rehearsal.
- No paid action or production cutover is authorized by this document.
