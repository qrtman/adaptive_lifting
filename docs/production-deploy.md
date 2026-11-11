# Production deploy

Workflow: `.github/workflows/deploy-production.yml`.

## How it runs

1. A PR is merged to `main`. **Validate repository** runs (lint, tests, build).
2. If it passes, **Deploy production** starts and waits for approval on the `production` environment. Approve it under GitHub Actions → the run → Review deployments.
3. After approval, in this order:
   1. **Migrations.** `supabase db push` applies only migrations that production does not have yet, after a dry run that lists them.
   2. **Edge functions.** `api` and `email-verification-worker` (`--use-api --no-verify-jwt`).
   3. **Worker.** `npm run build:production` (config validation plus the staging and secret scan), then the Worker config is generated from `wrangler.production.cutover.jsonc` and checked: name, route `app.goatedmethod.me/*`, Supabase origin. Then a Wrangler dry run and the deploy.
   4. **Smoke checks.** `/` returns 200, `/api/health` 200, `/api/auth/me` 401.
4. Only one deploy runs at a time. A newer merge waiting for approval replaces the older pending one.

**Manual run:** Actions → Deploy production → Run workflow (`main` only).

## Rules for changes

- **Migrations go first and must be backward compatible.** For a short time the old app runs against the new schema. Add first and remove later (expand, then contract).
- **Never edit an applied migration.** Add a new one.
- **A failing step stops the deploy.** The steps after it do not run. For example, a migration that raises leaves the Worker on the previous version.

## Configuration (GitHub → Settings → Environments → `production`)

| Name | Kind | What |
| :--- | :--- | :--- |
| `SUPABASE_ACCESS_TOKEN` | secret | Supabase personal access token (dashboard → Account → Access tokens) |
| `SUPABASE_DB_PASSWORD` | secret | Production database password (project `gadusaizqnshxqcckibq`) |
| `CLOUDFLARE_API_TOKEN` | secret | Repo-level secret, shared with staging. It needs Workers Scripts:Edit on the account and Workers Routes:Edit on zone `goatedmethod.me`. If it lacks the route permission, add a production-only token as an environment secret with the same name. |
| `CLOUDFLARE_ACCOUNT_ID` | secret | Repo-level secret, already set |
| `VITE_OFFLINE_AUTH_PUBLIC_KEY` | variable | Public offline-auth key (same value as the local `.env.production`) |

Environment protection: required reviewer (owner), deployments from `main` only.

## Rollback

- **Worker:** `npx wrangler rollback --name adaptive-lifting-production`, or Cloudflare dashboard → Workers → Deployments.
- **Database:** no automatic rollback. Write a new forward migration.
- **Edge functions:** redeploy from the previous commit (`supabase functions deploy … --project-ref gadusaizqnshxqcckibq`).

After each deploy, record the result in `docs/PRODUCTION_STATUS.md`.
