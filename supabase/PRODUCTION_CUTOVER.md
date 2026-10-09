# Production cutover plan (not executed)

This is a future release procedure. The final audit changes and tests staging
and repository configuration only. Production remains untouched. The Python
FastAPI application, Alembic migrator, and Python worker are not part of the
production runtime. A chosen frontend host serves static files; Caddy is an
optional reference proxy, while application APIs and scheduled workers run on
Supabase Edge/Postgres.

## Audit status and gates

The 2026-10-09 staging audit verification is complete; this document does not
authorize or perform production cutover. Private
Supabase operator replacements for coach promotion, manual grant/revocation,
per-account access inspection, and billing-customer repair are deployed and
verified on staging. The authenticated route-family smoke, cross-domain
regressions, migration reconciliation, and actual Caddy/Playwright rehearsal
are recorded in `STAGING_VALIDATION.md`. The staging owner has since disabled
the project-level Data API switch. The final verification below records direct
REST and GraphQL endpoint probes and confirms Edge, private PostgreSQL RPC,
Realtime, and Cron operation after that change.

## Non-secret configuration manifest

Configure values in the destination that owns them. Never put private values
in Vite build arguments, `.env.production`, checked-in files, or browser code.

| Group | Name | Classification | Requirement |
| --- | --- | --- | --- |
| Core auth | `DATABASE_URL` | private | Required; restricted `al_edge_catalog_runtime` connection through the project pooler. |
| Core auth | `JWT_SECRET_CURRENT` | private | Required; unique random app signing secret. |
| Core auth | `JWT_SECRET_PREVIOUS` | private | Optional rotation window; separate from current. |
| Core auth | `APP_ENV` | non-secret | Required; `production`. |
| Core auth | `COOKIE_SECURE` | non-secret | Required; `true`. |
| Core auth | `CORS_ALLOWED_ORIGINS` | non-secret | Required; exact HTTPS application origins, no wildcard. |
| Core auth | `EMAIL_VERIFICATION_NEW_ACCOUNTS` | non-secret | Required policy flag; normally `true`. |
| Core auth | `EMAIL_VERIFICATION_ENFORCE_LEGACY` | non-secret | Required policy flag; set from the reviewed account policy. |
| Frontend host | `APP_DOMAIN` | non-secret | Required in static-host environment; bare app hostname. |
| Frontend host | `SUPABASE_EDGE_HOST` | non-secret | Required; `<project-ref>.supabase.co`. |
| Frontend host | `SUPABASE_PUBLISHABLE_KEY` | public | Required for the Caddy Edge proxy; publishable/anon key only. |
| Frontend | `VITE_GOOGLE_CLIENT_ID` | public | Required only when Google login is enabled. |
| Frontend | `VITE_OFFLINE_AUTH_PUBLIC_KEY` | public | Required for offline grant verification. |
| Realtime | `REALTIME_JWT_PRIVATE_JWK` | private | Required only when private Broadcast token issuance is enabled; independent ES256 key. |
| Realtime | public verification JWK | public | Publish only public coordinates to the Realtime verifier; never the private JWK. |
| Email | `EMAIL_PROVIDER_API_KEY` or `RESEND_API_KEY` | private | Required to deliver verification mail; absent configuration must stay fail-closed. |
| Email | `EMAIL_FROM` | non-secret | Required when delivery is enabled; verified sender. |
| Email | `EMAIL_PAYLOAD_ENCRYPTION_KEY` | private | Required for queued encrypted email payloads; independent durable key. |
| Email | `APP_URL` | non-secret | Required exact HTTPS origin for links and billing return URLs. |
| Google login | `GOOGLE_CLIENT_ID` | public/configuration | Required when Google login is enabled; match the browser OAuth client. |
| Telegram | `TELEGRAM_BOT_TOKEN` | private | Required only when Telegram integration is enabled. |
| Telegram | `TELEGRAM_WEBHOOK_SECRET` | private | Required for webhook verification; independent value. |
| Sheets | `GOOGLE_OAUTH_CLIENT_ID` | public/configuration | Required only when Sheets OAuth is enabled. |
| Sheets | `GOOGLE_OAUTH_CLIENT_SECRET` | private | Required only when Sheets OAuth is enabled. |
| Integrations | `INTEGRATION_ENCRYPTION_KEY` | private | Required when encrypted provider credentials exist; stable or rotated with re-encryption. |
| Stripe | `STRIPE_BILLING_ENABLED` | non-secret | Feature-gated; keep `false` until live-mode readiness is approved. |
| Stripe | `STRIPE_SECRET_KEY` | private | Required only when live billing is enabled. |
| Stripe | `STRIPE_WEBHOOK_SECRET` | private | Required only when live billing is enabled. |
| Stripe | `STRIPE_PRICE_COACH_STARTER`, `STRIPE_PRICE_COACH_PRO`, `STRIPE_PRICE_COACH_UNLIMITED` | non-secret configuration | Required, unique recurring Price IDs when billing is enabled. |
| Stripe | `STRIPE_EXPECT_LIVEMODE` | non-secret | Required; `true` in production. |
| Billing | `SUBSCRIPTION_PAST_DUE_GRACE_DAYS` | non-secret | Optional integer 0–30; defaults to 3. |
| Voucher | `VOUCHER_BILLING_ENABLED` | non-secret | Required explicit enable flag. |
| Voucher | `VOUCHER_CODE_SECRET` | private | Required when vouchers are enabled; independent stable HMAC key, retained while codes are outstanding. |
| Worker dispatch | project-specific Edge URL and publishable key | private configuration / public key | Configure through private Vault dispatch getters for Cron; target only the named worker functions. |
| Worker dispatch | email and Sheets internal secrets | private | Required when those workers are enabled; distinct per worker. |
| Database/runtime | runtime role and restricted grants | non-secret schema | Required; use the checked-in migrations and verify grants before deployment. |

The staging provider matrix at audit time is: Google login not configured;
email delivery not configured; Telegram provider not configured; Sheets OAuth
not configured; Stripe not configured and fail-closed; vouchers configured in
Vault and live-validated. Missing provider credentials are production setup
requirements, not permission to copy staging secrets.

## Ordered deployment procedure

1. Create or verify the production Supabase project posture, supported region,
   backups, point-in-time recovery, Data API exposure settings, and disabled
   Supabase Auth adoption assumption.
2. Verify the restricted database roles, private schema, RLS/grant posture,
   Vault, and Realtime publication against this repository and staging report.
3. Apply the 62 checked-in migrations in lexical version order to a clean
   production schema. Confirm no migration is skipped and capture the applied
   versions. Do not replay the staging history or edit its records.
4. Configure the production private values from the manifest in the Supabase
   secret manager/Vault. Compare only secret names and safe fingerprints.
5. Deploy the API, email worker, and Sheets worker Edge Functions from the
   reviewed release commit. Keep platform JWT verification disabled only on
   handlers that perform their own app-session or worker-secret checks.
6. Configure the email and Sheets Cron jobs and verify their private dispatch
   target, authorization, schedule, and run status. Confirm no fixture jobs are
   enabled.
7. Configure private Broadcast authorization and the Realtime ES256 public
   verification key. Keep app JWT, offline-auth, and Realtime signing keys
   separate.
8. Verify Data API/browser table denial, private RPC ACLs, Vault getter ACLs,
   operator-only voucher RPCs, and `al_edge_catalog_runtime` effective rights.
9. Configure external provider callbacks/webhooks: Google login JavaScript
   origin; Sheets OAuth callback at
   `https://<APP_DOMAIN>/api/integrations/google-sheets/callback`; Telegram
   webhook at `https://<APP_DOMAIN>/api/integrations/telegram/webhook`; and
   Stripe webhook at `https://<APP_DOMAIN>/api/billing/stripe/webhook` for
   supported subscription lifecycle events. Configure Resend's sender domain.
10. Build the static frontend bundle from the release commit with the
    production Supabase Edge host and publishable key, then deploy it to the
    frontend hosting environment selected for production. Caddy is an optional
    reverse-proxy/static-host configuration and was used for a staging ingress
    rehearsal; it is not a required Supabase backend component or a required
    production hosting choice. Any selected host/proxy must route `/api` to the
    Supabase Edge API and must not route application traffic to Python.
11. Run the pre-cutover smoke list below against the production candidate
    project and host before switching user traffic.
12. Switch frontend/API traffic to the Supabase-backed host. No database
    ownership migration or training-data ownership change is performed by the
    traffic switch.
13. Run the post-cutover smoke list, then observe Edge logs, worker/Cron runs,
    login failures, provider callback delivery, Stripe webhook outcomes, and
    safe billing diagnostics.
14. At the acceptance checkpoint, decide whether to continue or invoke the
    frontend routing rollback below. Keep the legacy service available only
    until data/API compatibility and rollback safety have been accepted.
15. Retire the legacy backend only after release acceptance, reconciliation,
    backup verification, and a separate explicit operational decision.

## Smoke checklist

- Health, password login/logout, `/api/auth/me`, registration/verification,
  `/api/account/access`, device/session/audit routes, and coach linking.
- Microcycle read; session create/update/delete; exercise/set writes; Set Log;
  Workout Sync; analytics; and Insight Cards.
- Day Notes, CSV/JSON exports, offline grant verification, and Realtime token
  authorization.
- Telegram, Sheets, email worker, and billing in their configured or
  fail-closed states. Confirm voucher redemption does not call Stripe.
- Coach unlink, session revocation, tombstone exclusion, role/owner denial,
  representative concurrency, and zero synthetic fixtures.
- Confirm Edge deployment version/project ref in safe evidence and verify no
  request is routed to FastAPI.

## Rollback criteria and procedure

Stop the traffic switch and roll back the frontend/API origin if a core route
fails, auth/session validation regresses, authorization leaks across users,
canonical workout values disagree, worker claims duplicate/lose work, or a
provider event grants or removes access incorrectly. Provider configuration
fail-closed behavior by itself is expected when a feature is intentionally
disabled.

Rollback the frontend/API traffic routing to the last accepted host. Disable
or redirect new provider webhook delivery only if the target is incorrect;
preserve provider event identity and retry/reconciliation records. Keep the
Supabase schema forward-compatible and retain all writes. Do not run destructive
down migrations or assume legacy code can safely use new schema state. Stop
conflicting writers only if needed for consistency, reconcile writes made
after the switch, and restore from backup only as a separately reviewed data
recovery action. The rollback decision point is before legacy backend retirement.

## Staging rehearsal record (historical checkpoint)

The staging Supabase host serves the migrated API directly from the `api` Edge
Function without a Python service. The production Compose/Caddy route is
configured to proxy `/api` to that function, and its Compose configuration
parses. At that checkpoint, an actual Caddy/browser rehearsal had not run.
The continuation below supersedes that historical status. The project Data API
is enabled with browser table grants denied.

### Migration history note

Staging has all 62 checked-in migration names, with no missing or extra names.
Twenty-one pre-audit historical version-prefix differences remain; the two
operator/text/inspector audit migrations were also recorded under generated
staging versions, for 24 current version-prefix differences. One independent ordering swap exists
between `email_worker_clear_claim_on_retry` and `day_notes_exports_domain`.
No history was rewritten or replayed. Normalized SQL hashes match 52 of 62
files. The remaining ten differences are reconciled: comment/whitespace-only
changes; definitions superseded by later matching migrations; historical
placeholder encoding variants; and final text-literal repairs. The live
catalog was checked for the affected final functions and no unexplained object
effect remains. Forward-only migration `20261009170000_correct_runtime_text_encoding.sql`
repairs corrupted punctuation where it remained live. These differences are
documented, not hidden by rewriting migration history.

## Final staging continuation

The Caddy/Playwright exercise is one staging ingress rehearsal, not a choice of
production frontend host. The eventual hosting provider may serve the static
bundle directly or use another reviewed proxy, provided the same API origin,
cookie/CORS, deep-link, service-worker, export, and Realtime requirements pass.
The backend remains Supabase-native with no FastAPI upstream.

The staging owner reports turning **Enable Data API** Off in the Dashboard.
Final probes with the staging publishable key returned HTTP 503 from both the
autogenerated REST table endpoint and GraphQL endpoint (PostgREST error
`PGRST002`, schema cache unavailable). The project-level dashboard value is
not exposed by the currently available Supabase MCP read tools, so the setting
is recorded as operator-confirmed and corroborated by endpoint unavailability,
not as a direct Management API readback. Edge health remained HTTP 200, a
direct call to the private `al_private.al_auth_me` RPC returned its expected
invalid-session denial, the Realtime WebSocket accepted a connection, and both
email and Sheets Cron jobs remained active with recent successful runs.
Effective table reads and browser private-RPC execution remain denied; runtime
access to its route RPC remains granted while operator-only billing diagnostics
remain unavailable to the runtime. No grants, schema, or production settings
were changed for this verification.
