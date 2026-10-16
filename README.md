# Adaptive Lifting

Adaptive Lifting is an auto-regulatory training planning and logging app for
coaches and athletes. Training plans belong to athletes; a linked coach receives
shared access through the coach-code relationship flow.

## Start here

- [Production status](docs/PRODUCTION_STATUS.md) — authoritative dated
  checkpoint for completed work, pending gates, and constraints.
- [System architecture](architecture.md) — the selected active architecture,
  domain model, math, security, offline sync, and runtime contracts.
- [Design system](design.md) — UI patterns and interaction contracts.
- [Development and verification](#development-and-verification).
- [Production launch runbook](supabase/PRODUCTION_CUTOVER.md) — continue from
  the deployed API; no database bootstrap or migration replay.
- [Cloudflare deployment](docs/cloudflare-workers.md) — staging evidence and
  the pending production Worker preparation/deployment procedure.
- [Supabase backend and migrations](supabase/README.md) — runtime boundaries,
  local checks, and migration history.
- [Email verification and onboarding](docs/email-verification.md) — behavior
  and security contract; [production email readiness](docs/production-email-readiness.md)
  tracks the provider gate.
- [Realtime](supabase/REALTIME_SPIKE.md) — implementation evidence;
  [production Realtime E2E](supabase/bootstrap/PRODUCTION_REALTIME_E2E.md) is
  still a separate pending gate.
- [Backup and recovery](docs/production-recovery.md) — recovery requirements,
  evidence, and unresolved implementation choices.
- [Documentation index and policy](docs/README.md).
- [Historical material](docs/README.md#historical-and-superseded-records) —
  retained audits and experiments are evidence, not current deployment plans.

## Selected runtime architecture

The application is a React/Vite progressive web app. Cloudflare Workers Static
Assets is the selected frontend host, with a same-origin Worker proxy for
`/api/*`. Supabase Edge Functions and PostgreSQL provide the application API,
workers, and persistence. Supabase Realtime provides private live
synchronization when its production release gate passes.

Application accounts use custom application JWTs and HttpOnly cookie sessions,
backed by the application sessions table. Supabase Auth is not the application
account system. Python/FastAPI under `backend/` is retained for compatibility,
historical migration context, and mathematical parity tests; it is not an
active application runtime. See [architecture.md](architecture.md) for the
complete contract.

## Development and verification

Install dependencies with `npm ci`, copy `.env.example` to `.env`, and set the
development API target before starting Vite:

```powershell
$env:API_EDGE_TARGET = "https://<project-ref>.supabase.co"
npm run dev
```

The dev proxy forwards `/api/*` to the corresponding Supabase function path.
It does not fall back to Python. Common checks:

```text
npm test
npm run lint
npm run build
```

Python tests are compatibility/parity checks. Supabase Edge tests and SQL
migrations are under `supabase/`. Production changes require the approvals and
release gates in [the production status](docs/PRODUCTION_STATUS.md) and
[cutover runbook](supabase/PRODUCTION_CUTOVER.md).

## Documentation authority

See [docs/README.md](docs/README.md) for the source-of-truth map and maintenance
policy. In brief: `architecture.md` records stable architecture and behavior;
`docs/PRODUCTION_STATUS.md` records changing production facts; the cutover
runbook records how to proceed safely. Older audits remain clearly labeled
historical and must not override those current documents.
