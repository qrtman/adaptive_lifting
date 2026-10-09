# Adaptive Lifting

Adaptive Lifting is an auto-regulatory periodization app for coaches and
athletes. The training plan remains athlete-owned; linked coaches receive
shared access through the coach-code relationship flow.

## Runtime architecture

Production browser requests use same-origin `/api` URLs. The selected static
frontend host serves the Vite bundle and routes `/api` to the Supabase `api`
Edge Function. Frontend hosting is not selected yet. The host must provide the
same-origin API proxy and static SPA/PWA behavior documented in
[`PRODUCTION_CUTOVER.md`](supabase/PRODUCTION_CUTOVER.md). Supabase Edge
Functions and private PostgreSQL interfaces own the application API, workers,
and scheduled jobs. Production does not run the Python/FastAPI application or
a Python worker.

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

## Production frontend hosting

The frontend remains a static Vite/PWA build. The production hosting provider
has not been selected or provisioned. Configure only public build values from
`.env.production.example`; application secrets remain in Supabase Edge/Vault
configuration. Do not put private keys, database credentials, provider
secrets, or app signing keys into the frontend build.

The selected host must serve the SPA fallback and root service-worker assets,
and must reverse-proxy same-origin `/api/*` requests to the Supabase Edge API
while preserving request/response headers and cookies. See the provider-neutral
rewrite and cookie contract in [`PRODUCTION_CUTOVER.md`](supabase/PRODUCTION_CUTOVER.md).
Do not point browser API calls directly at the cross-origin Supabase host under
the current HttpOnly `SameSite=Lax` session-cookie policy.

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
