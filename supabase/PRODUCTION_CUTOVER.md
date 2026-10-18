# Production launch runbook

This runbook continues from the deployed, healthy production Supabase API. It
does not provision a project or database. The changing production facts and
dated test evidence live in [the production status page](../docs/PRODUCTION_STATUS.md).

## Selected production architecture

- React/Vite PWA served by Cloudflare Workers Static Assets.
- The Cloudflare Worker serves static assets and proxies same-origin `/api/*`
  requests to the Supabase `api` Edge Function.
- Supabase Edge Functions and PostgreSQL provide application APIs, workers,
  and canonical persistence. Supabase Realtime connects directly when enabled.
- Custom application JWTs and HttpOnly cookie sessions are the application
  identity system; Supabase Auth is not used for application accounts.
- Python/FastAPI is retained for compatibility, historical migrations, and
  mathematical parity tests only. It is not a production runtime or launch
  prerequisite.

## Release sequence

1. **Confirm the baseline.** Read the status page, verify the intended branch,
   exact commit, clean worktree, project, and current production state. Use the
   current production API; do not deploy an unreviewed API change as part of the
   frontend step.
2. **Prepare the production frontend.** Generate the ignored local Wrangler
   configuration from the checked-in route-free Worker-only template using the
   verified project reference. Run the production configuration validator,
   production build, asset scan, and Wrangler dry run. Confirm no hostname
   route, staging origin, or private values are present. The separate
   `wrangler.production.cutover.jsonc` preserves the future hostname route and
   is reserved for separately authorized cutover. See
   [Cloudflare deployment](../docs/cloudflare-workers.md).
3. **Deploy the production Worker only with separate exact-target approval.**
   Verify the Cloudflare account, Worker name, config, project origin, and
   deployment diff immediately before deploy. Keep `workers_dev` disabled.
   Record the Worker version and run HTTPS, SPA/deep-link, static asset, PWA,
   same-origin `/api/health`, cookie forwarding, Origin, and no-cache checks.
   Do not attach the production hostname route in this step.
4. **Complete the service gates.** Before public traffic or real-user writes,
   finish a genuine independent encrypted production database backup and an
   isolated restore; verify production email delivery and onboarding; configure
   and test private Realtime; complete security, monitoring, and operational
   checks. Keep email onboarding, Realtime token issuance,
   billing, and Google sign-in disabled until their individual gates and
   separate activation approvals pass. Backup method remains undecided; do not
   treat an experiment or synthetic restore as production recovery.
5. **Complete browser acceptance before cutover.** A route-free Worker with
   `workers_dev` disabled has no public browser URL. The existing supported
   local option (`wrangler dev --local`) can exercise static/PWA behavior and
   proxy code, but a localhost origin does not validate production cookie and
   CSRF behavior. The staging `workers.dev` app is staging-only evidence. A
   non-public production browser path that preserves production-origin
   behavior is not established; select and authorize one separately before
   claiming browser acceptance. Do not enable `workers_dev`, route public
   traffic, or change DNS merely to make testing possible.
6. **Cut over the existing hostname only with separate public-traffic
   authorization.** Make a
   fresh read-only inspection of the `goatedmethod.me` zone, current
   `app.goatedmethod.me` Tunnel record, route precedence, Worker, and TLS. Attach
   the reviewed Worker route while preserving DNS and Tunnel configuration.
   Record before/after evidence and a named abort decision. Immediately run the
   approved post-route health and routing smoke checks; the route action itself
   is public traffic cutover and is not authorized by this document.
7. **Update the status page.** Record exact environment, project, branch,
   commit/version, checks, results, and limitations. Do not record secret
   values.

## Migration and database safety

Production PostgreSQL is already initialized and its 63 migrations have been
applied and validated. **Never rerun bootstrap, replay or repair the production
migration ledger, reset production, or restore into production as part of
launch.** A future database change requires its own reviewed migration and
explicit authorization. The retained bootstrap procedure is not the launch
procedure; see [Supabase runtime and migration notes](README.md).

## Traffic, writes, and rollback limits

Existing DNS and the Cloudflare Tunnel remain unchanged until the separately
authorized route cutover. A Worker deployment without the hostname route does
not by itself move public traffic. Keep disabled integrations closed.

Before real writes, require a verified restore path and an owner who can decide
recovery. Removing a Worker route only restores the prior route; it does not
undo writes. The old application is not the active runtime and must not be
assumed compatible with the new production schema. After writes begin, prefer a
reviewed forward fix or recovery into an isolated target; do not promise
rollback to the legacy application.

## Approval boundaries

Each production action requires its own explicit approval naming the exact
target and action: Worker deployment, route cutover, provider activation,
secret/role changes, database changes, or production data export/restore. This
runbook is procedure only and grants no authorization for those operations.
