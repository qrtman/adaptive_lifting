# Supabase-native integrations

Telegram and Google Sheets integration routes run through the `api` Edge Function. The Google Sheets outbox is processed by the private `google-sheets-worker` Edge Function on the `al-google-sheets-worker` Cron schedule. The API and worker use the existing custom application JWT/session system; Supabase Auth is not used.

## Secret configuration

The `al_private.al_integration_secret(name)` RPC exposes only these exact Vault names to `al_edge_catalog_runtime`:

- `adaptive_lifting_telegram_bot_token`
- `adaptive_lifting_telegram_webhook_secret`
- `adaptive_lifting_google_oauth_client_id`
- `adaptive_lifting_google_oauth_client_secret`
- `adaptive_lifting_integration_encryption_key`
- `adaptive_lifting_google_sheets_worker_internal_secret`

The Google Sheets worker URL is stored separately as `adaptive_lifting_google_sheets_worker_edge_url`; only the Cron function reads it. The integration encryption key and worker credential are generated in Vault by the migration. Provider credentials can be configured either as Edge environment secrets or under the corresponding Vault name. `APP_URL` remains an Edge environment setting. No secret values belong in migrations, repository files, or browser configuration.

The worker internal credential authorizes only the `google-sheets-worker` endpoint. Its database role receives only the narrow integration RPCs and cannot directly read the integration tables or Vault. Browser roles cannot read integration tables or execute private RPCs.

## Outbox behavior

The Sheets worker claims `google-sheets` jobs with a 15-minute lease, retries at most three times with five- and ten-minute delays, rechecks coach eligibility, integrations entitlement, relationship state, and mesocycle ownership before loading training data, and writes only live canonical training data. Spreadsheet creation intent and returned ID are checkpointed so an uncertain create request is not blindly repeated. Sheets is one-way export; it never updates canonical training data.

Email-verification and Google Sheets jobs share `IntegrationOutbox` but use separate Supabase workers and provider-scoped claim RPCs. The Python integration worker entry point no longer polls the outbox.

## Staging provider availability

Staging provider configuration is independent from production. When Telegram or Google OAuth credentials are absent, their provider-facing routes fail closed. The migration and worker remain deployed, and no mock credentials or provider-success paths are used.
