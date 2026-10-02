# Supabase migration foundation

The `api` Edge Function ports exactly two read routes:

| Existing route               | Function path                             | Behavior                                                                           |
| ---------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `GET /api/health`            | `/functions/v1/api/api/health`            | `SELECT 1`, then `{"status":"ok"}`                                                 |
| `GET /api/analytics/catalog` | `/functions/v1/api/api/analytics/catalog` | Existing app cookie or bearer JWT, session and user lookup, Python catalog payload |

The existing same-origin reverse proxy must route these paths to the function
before a browser rollout. Keeping the original `/api/*` URL preserves the
HttpOnly `session_id` cookie. Direct cross-origin Function calls will not
inherit the application's cookie. There is no frontend routing change here.
Python remains available for every other route and as rollback.

## Configuration

Set `DATABASE_URL` to a server-only PostgreSQL connection URL,
`JWT_SECRET_CURRENT`, optional `JWT_SECRET_PREVIOUS`, `CORS_ALLOWED_ORIGINS`,
and the same `EMAIL_VERIFICATION_ENFORCE_LEGACY` flag as Python. The function
sets `verify_jwt = false` because Supabase's platform JWT check cannot verify
the application's independent HS256 keys; the handler verifies JWT and database
session on every authenticated request. This does **not** make the catalog
public. Prefer a transaction-pooler URL with TLS and a read-only database role
restricted to the queried columns. Do not put the URL or application signing
keys in browser code.

The catalog file was generated from `backend.analytics_registry` and
`CatalogPayload` at `local-save` commit
`29c81fb395c62cc2ac3c775d2a7d8ef3106d9328`. Run the parity check whenever the
Python registry changes. The checked-in JWTs in `tests/python_tokens.json` are
signed by Python/PyJWT with test-only keys.

## Local checks

```sh
cd supabase
deno check functions/api/index.ts tests/auth_test.ts tests/routes_test.ts
deno test tests/auth_test.ts tests/routes_test.ts
cd ..
python supabase/tests/check_catalog_parity.py
```

These tests use a fake repository for failure cases. The staging validation
workflow, restricted runtime role, same-origin development proxy, and isolated
Realtime token prototype are described in `STAGING_VALIDATION.md`. The
Realtime prototype is separate from the two migrated API routes and is not a
replacement for SSE or application authentication.
