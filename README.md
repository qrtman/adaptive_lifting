# Adaptive Lifting

Adaptive Lifting is an auto-regulatory periodization app for coaches and
athletes. The training plan remains athlete-owned; linked coaches receive
shared access through the coach-code relationship flow.

## Runtime architecture

Production browser requests use same-origin `/api` URLs. The selected static
frontend host serves the Vite bundle and routes `/api` to the Supabase `api`
Edge Function. The optional Caddy configuration demonstrates one way to serve
the bundle and proxy those requests; Caddy is not a required Supabase backend
component or a required production hosting choice. Supabase Edge Functions
and private PostgreSQL interfaces own the application API, workers, and
scheduled jobs. Production does not run the Python/FastAPI application or a
Python worker.

The custom application authentication remains separate from Supabase Auth:
HS256 app JWTs are backed by the application `sessions` table; offline grants
and Realtime tokens use separate ES256 keys. Supabase Auth is intentionally not
adopted.

See [architecture.md](architecture.md) for application contracts and
[supabase/README.md](supabase/README.md) for the Supabase runtime and migration
layout.

## Local development

Install dependencies with `npm ci`, then run the Vite app:

```sh
npm run dev
```

The development proxy can point migrated paths at Supabase Edge using
`API_EDGE_TARGET`; paths not in the explicit migration allowlist use
`API_PROXY_TARGET` (default `http://localhost:8000`) for the retained Python
reference backend. This proxy is for local coexistence development only.

To run that reference backend locally, install `backend/requirements.txt`,
apply its local Alembic schema, and run:

```sh
python -m uvicorn backend.main:app --port 8000 --host 127.0.0.1
```

The Python application and tests remain a compatibility reference. They are
not included in the production Compose deployment.

## Production frontend host

The optional Compose deployment contains only the static frontend and Caddy.
It proxies `/api` to the configured Supabase project; it does not start
FastAPI, an Alembic migrator, or a Python worker.

Copy `.env.production.example` to a protected `.env.production`, configure the
public Supabase project host and publishable key, set `APP_DOMAIN`, and provide
the public Google client ID and offline-auth public key only when those
features are enabled. Configure private application values in the production
Supabase project through its managed Edge secrets/Vault setup. Never put
private keys, database credentials, provider secrets, or app signing keys in
the frontend build or Caddy environment.

```sh
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production build
docker compose --env-file .env.production up -d --wait
```

Use the ordered, staging-rehearsed procedure in
[supabase/PRODUCTION_CUTOVER.md](supabase/PRODUCTION_CUTOVER.md) before any
production release. That procedure is preparation only; this repository audit
does not perform a production cutover.

## Checks

```sh
npm test
npm run lint
npm run build
```

Python reference tests are under `backend/`; Supabase Edge tests and migrations
are under `supabase/`.
