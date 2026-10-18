# Final legacy HTTP route inventory

Extracted from `local-save` commit `29c81fb395c62cc2ac3c775d2a7d8ef3106d9328` using Python AST over non-test backend modules. Explicit decorated route count: **65**. Four FastAPI generated docs/schema routes are listed separately below; total legacy HTTP surface counted: **69**. Staging status is a direct unauthenticated request to the Supabase `api` Edge Function with `sb-project-ref=admyuepbbtstayaydjmo`. Statuses confirm route dispatch / auth / validation / fail-closed behavior, not authorized business behavior.

| Legacy method | Legacy path | Legacy source / handler | Classification | Current Edge owner | Staging unauthenticated response |
|---|---|---|---|---|---|
| `DELETE` | `/api/auth/link` | `backend/main.py` ? `unlink_coach` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `DELETE` | `/api/auth/link/{athlete_id}` | `backend/main.py` ? `unlink_athlete` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `DELETE` | `/api/insight-cards/{card_id}` | `backend/analytics_router.py` ? `delete_card` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `DELETE` | `/api/integrations/google-sheets` | `backend/integrations.py` ? `disconnect_sheets` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `DELETE` | `/api/integrations/telegram` | `backend/integrations.py` ? `disconnect_telegram` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `DELETE` | `/api/security/devices/{id}` | `backend/main.py` ? `revoke_device` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `DELETE` | `/api/security/sessions/{id}` | `backend/main.py` ? `revoke_session` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `DELETE` | `/api/sessions/{session_id}` | `backend/main.py` ? `delete_session` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `DELETE` | `/api/sessions/{session_id}/exercises/{exercise_id}` | `backend/main.py` ? `remove_session_exercise` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `GET` | `/api/account/access` | `backend/main.py` ? `get_account_access` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `GET` | `/api/analytics/catalog` | `backend/analytics_router.py` ? `analytics_catalog` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `GET` | `/api/auth/coach-code` | `backend/main.py` ? `get_coach_code_status` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `GET` | `/api/auth/me` | `backend/main.py` ? `auth_me` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `GET` | `/api/billing/plans` | `backend/billing/stripe_checkout.py` ? `plans` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `GET` | `/api/coach/roster` | `backend/main.py` ? `get_roster` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `GET` | `/api/coach/roster/history` | `backend/main.py` ? `get_roster_history` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `GET` | `/api/coach/roster/history/{relationship_id}` | `backend/main.py` ? `get_roster_history_snapshot` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `GET` | `/api/day-notes` | `backend/main.py` ? `list_day_notes` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `GET` | `/api/export/csv` | `backend/main.py` ? `export_csv` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `GET` | `/api/export/json` | `backend/main.py` ? `export_json` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `GET` | `/api/health` | `backend/main.py` ? `health_check` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 200; project-ref=admyuepbbtstayaydjmo |
| `GET` | `/api/insight-cards` | `backend/analytics_router.py` ? `list_cards` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `GET` | `/api/integrations/google-sheets/auth-url` | `backend/integrations.py` ? `get_sheets_auth_url` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `GET` | `/api/integrations/google-sheets/callback` | `backend/integrations.py` ? `sheets_callback` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `GET` | `/api/integrations/google-sheets/status` | `backend/integrations.py` ? `get_sheets_status` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `GET` | `/api/integrations/telegram/status` | `backend/integrations.py` ? `get_telegram_status` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `GET` | `/api/microcycles` | `backend/main.py` ? `get_microcycles` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `GET` | `/api/security/audit-events` | `backend/main.py` ? `get_audit_events` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `GET` | `/api/security/devices` | `backend/main.py` ? `get_devices` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `GET` | `/api/security/sessions` | `backend/main.py` ? `get_sessions` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `GET` | `/api/workouts/{workout_id}/live` | `backend/sse_broadcaster.py` ? `live_workout_events` | OBSOLETE_INTERNAL | No current frontend EventSource/SSE caller; workout updates use private Realtime capability | 404 on Edge |
| `PATCH` | `/api/auth/profile` | `backend/main.py` ? `update_auth_profile` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `PATCH` | `/api/sessions/labels` | `backend/main.py` ? `bulk_update_session_labels` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `PATCH` | `/api/sessions/{session_id}` | `backend/main.py` ? `update_session` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `PATCH` | `/api/sessions/{session_id}/exercises/{exercise_id}` | `backend/main.py` ? `update_session_exercise` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/analytics/query` | `backend/analytics_router.py` ? `analytics_query` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/auth/coach-code` | `backend/main.py` ? `create_coach_code` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/auth/google` | `backend/main.py` ? `google_login` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 503; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/auth/link` | `backend/main.py` ? `link_athlete` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/auth/link-athlete` | `backend/main.py` ? `link_athlete` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/auth/login` | `backend/main.py` ? `login` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 422; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/auth/logout` | `backend/main.py` ? `logout` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 200; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/auth/register` | `backend/main.py` ? `register_user` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 422; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/auth/resend-verification` | `backend/main.py` ? `resend_email` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 422; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/auth/verify-email` | `backend/main.py` ? `verify_email` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 422; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/billing/stripe/checkout-session` | `backend/billing/stripe_checkout.py` ? `checkout` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/billing/stripe/portal-session` | `backend/billing/stripe_checkout.py` ? `portal` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/billing/stripe/webhook` | `backend/billing/stripe_adapter.py` ? `stripe_webhook` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 503; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/billing/vouchers/redeem` | `backend/billing/voucher_router.py` ? `redeem` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/coach/push-program` | `backend/main.py` ? `push_program` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/dev/login/{role}` | `backend/main.py` ? `development_login` | DEVELOPMENT_ONLY | No deployment; Edge fallback is fail-closed | not a migrated route |
| `POST` | `/api/insight-cards` | `backend/analytics_router.py` ? `create_card` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/insight-cards/sync` | `backend/analytics_router.py` ? `sync_cards` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/integrations/google-sheets/publish` | `backend/integrations.py` ? `publish_to_sheets` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/integrations/telegram/link-token` | `backend/integrations.py` ? `generate_telegram_link_token` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/integrations/telegram/miniapp/session` | `backend/integrations.py` ? `telegram_miniapp_session` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 422; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/integrations/telegram/webhook` | `backend/integrations.py` ? `telegram_webhook` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 503; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/sessions` | `backend/main.py` ? `create_session` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/sessions/copy-week` | `backend/main.py` ? `copy_week` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/sessions/{session_id}/exercises` | `backend/main.py` ? `add_session_exercise` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/sets/log` | `backend/main.py` ? `log_set` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `POST` | `/api/workouts/{id}/sync` | `backend/main.py` ? `sync_workout` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `PUT` | `/api/day-notes` | `backend/main.py` ? `upsert_day_note` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `PUT` | `/api/insight-cards/{card_id}` | `backend/analytics_router.py` ? `update_card` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `PUT` | `/api/sessions/{session_id}/exercises/{exercise_id}/sets` | `backend/main.py` ? `replace_session_exercise_sets` | MIGRATED | `api` ? `_shared/handler.ts` explicit dispatcher | 401; project-ref=admyuepbbtstayaydjmo |
| `GET` | `/openapi.json` (FastAPI generated) | FastAPI built-in | INTENTIONALLY_REMOVED | None; documentation-only route removed with FastAPI | 404 on Edge |
| `GET` | `/docs` (FastAPI generated) | FastAPI built-in | INTENTIONALLY_REMOVED | None; documentation-only route removed with FastAPI | 404 on Edge |
| `GET` | `/docs/oauth2-redirect` (FastAPI generated) | FastAPI built-in | INTENTIONALLY_REMOVED | None; documentation-only route removed with FastAPI | 404 on Edge |
| `GET` | `/redoc` (FastAPI generated) | FastAPI built-in | INTENTIONALLY_REMOVED | None; documentation-only route removed with FastAPI | 404 on Edge |

## Reconciliation summary

- **MIGRATED: 63**. All 63 are explicit Supabase Edge dispatch paths. The 53 protected operations returned 401 with no credentials; empty public auth/provider inputs returned their validation or configured fail-closed statuses. `/api/health` returned 200; logout is intentionally idempotent and returned 200.
- **DEVELOPMENT_ONLY: 1**. `/api/dev/login/{role}` exists only in legacy reference code; the deployed Edge API has no handler and returns 405 for POST (the generic non-GET fail-closed path). The legacy backend helper also requires explicit `DEV_LOGIN_ENABLED` and rejects production-like `APP_ENV`.
- **OBSOLETE_INTERNAL: 1**. `GET /api/workouts/{workout_id}/live` had no runtime frontend caller; it returns 404 on Edge. The frontend has no EventSource or `/live` network request.
- **INTENTIONALLY_REMOVED: 4**. FastAPI generated OpenAPI/docs/OAuth redirect/ReDoc pages are documentation surfaces only.
- **UNRESOLVED: 0**. Current Edge dispatch does not forward unmatched paths to Python.

The independent live status pass exercised the exact paths/methods with intentionally invalid or absent credentials. Earlier per-domain authenticated tests are not substituted for authorized smoke evidence in the final audit report.
