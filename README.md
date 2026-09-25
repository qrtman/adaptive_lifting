# Adaptive Lifting Periodization Dashboard

Auto-regulatory periodization dashboard for powerlifting coaches and athletes.

---

## System Requirements & Run Instructions

This project requires a dual-process spin-up (Vite + FastAPI).

### 1. Run the Frontend (Vite App)
* **Framework**: React + Vite + Tailwind CSS v4
* **Directory**: `/` (root directory)
* **Command**: 
  ```bash
  npm run dev
  ```
* **Runs on**: [http://localhost:3000](http://localhost:3000)

### 2. Run the Backend (FastAPI App)
* **Framework**: FastAPI + Python + SQLite (SQLAlchemy)
* **Directory**: `/` (root directory)
* **Command**:
  ```bash
  python -m uvicorn backend.main:app --port 8000 --host 127.0.0.1
  ```
* **Runs on**: [http://127.0.0.1:8000](http://127.0.0.1:8000)

Vite proxies browser requests under `/api` to `http://localhost:8000`, so the
frontend uses the same `/api/...` URLs in development and production. To proxy
to a different local backend, set `API_PROXY_TARGET` before `npm run dev`.
Production should serve the frontend and route `/api` on the same public origin
to FastAPI (for example, `https://lifting.example.com/api/...`). No frontend
backend URL is required at build time. `VITE_BACKEND_URL` is an optional
override for a deliberately separate API origin; that setup needs credentialed
CORS and compatible cookie domain/SameSite/Secure settings. Avoid setting it
unless the deployment requires cross-origin API calls.

---

## Production deployment

The included Compose deployment serves the Vite bundle and `/api` through one
HTTPS origin with Caddy. It uses a persistent PostgreSQL database supplied by
`DATABASE_URL` (a managed database or a separately backed up PostgreSQL host).
The database must be reachable from the containers. No database credentials or
JWT secrets are included in either image.

Copy `.env.production.example` to `.env.production` and set `APP_DOMAIN`,
`APP_URL`, `DATABASE_URL`, `CORS_ALLOWED_ORIGINS`, `JWT_SECRET_CURRENT`, and
`INTEGRATION_ENCRYPTION_KEY`. Use unique random secrets of at least 32
characters. Keep `APP_ENV=production` and `COOKIE_SECURE=true`. Set optional
Telegram and Google credentials only for integrations you enable. For Google
login, set `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` to the same public
OAuth web client ID; configure its authorized JavaScript origin. The Google
Sheets OAuth client ID and secret are separate settings.

`APP_DOMAIN` must be a bare DNS hostname (no scheme or path) with A/AAAA records
pointing at this server. Open TCP 80/443 and UDP 443. Set `APP_URL` to exactly
`https://<APP_DOMAIN>` without a trailing slash, and use that same origin in
`CORS_ALLOWED_ORIGINS`. Keep `PORT` at 8000 or another unprivileged port.
Use PostgreSQL 16 or newer on persistent storage with scheduled, off-host backups.
For remote PostgreSQL use the provider's required TLS settings, preferably
`?sslmode=verify-full` with a trusted CA. URL-encode reserved characters in database
credentials. `postgresql+psycopg://` is the canonical URL; `postgresql://` and
`postgres://` are also normalized to the installed psycopg driver.

On a Linux server with Docker Engine and Compose v2 or newer:

```sh
set -eu
umask 077
cp .env.production.example .env.production
# Edit all required values; generate each secret separately with openssl rand -hex 32.
${EDITOR:-vi} .env.production
chmod 600 .env.production
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production build
docker compose --env-file .env.production run --rm migrate
docker compose --env-file .env.production up -d --wait
```

Compose runs `alembic -c alembic.ini upgrade head` in the `migrate` service
before starting the API. API startup verifies the schema revision; a failed
migration prevents the API and worker from serving traffic. For a manual
migration, run `docker compose --env-file .env.production run --rm migrate`.
For an upgrade, retain the previous release checkout/image IDs and configuration.
Build first, then stop writers and take a backup using the procedure below.
Run this in a fail-fast shell so a failed backup or migration stops the release:

```sh
set -eu
docker compose --env-file .env.production build
docker compose --env-file .env.production stop api worker
# REQUIRED: take and verify the PostgreSQL backup below before continuing.
docker compose --env-file .env.production run --rm migrate
docker compose --env-file .env.production up -d --wait
```

Do not restart an old image against a changed schema without verifying compatibility.
There is no automatic safe downgrade: revision 0001 refuses downgrade, and later
downgrades discard columns/tables. To roll back, stop all writers, restore the
pre-upgrade backup into a **new empty database**, and point the previous release
and its original encryption key at that database. Writes after the backup are
absent from that recovery point. Keep the failed database for investigation.
Normal `stop`, `down` (without `-v`), and `build` do not delete external PostgreSQL
data. Do not use `down -v` for upgrades; it deletes Caddy's certificate storage.
If upgrading from the former SQLite deployment, preserve its `app_data` volume:
setting a PostgreSQL URL does not transfer SQLite rows. Migrate that data through
a separately reviewed import before switching a live SQLite installation.

The backend image listens on `0.0.0.0` at `PORT` (default 8000); Caddy uses the
same value. Back up PostgreSQL independently and restore to staging regularly.

The API port is private to the Compose network. Its Uvicorn process trusts proxy
headers from that network because Caddy is the only public entry point; never
publish the API port or attach untrusted containers to this network. Caddy
overwrites forwarded scheme/client headers. API, worker, and migration run as
non-root with capabilities removed. Caddy retains root for existing certificate
volume ownership and ports 80/443, with only `NET_BIND_SERVICE` and no privilege
escalation. SSE is streamed through Caddy and rechecks authorization while open.

Browser writes require an allowed Origin (or same-origin Referer); scripts should
use Bearer tokens without cookies. Authentication endpoints allow 20 attempts per
minute per client IP in the single API process. Google never links a password
account by matching email alone: linking also requires that account's active
session. Existing password users can continue signing in with their password.
When rotating JWT keys, move the old strong key to `JWT_SECRET_PREVIOUS`, deploy
the new current key, then remove the previous key after seven days. Never change
`INTEGRATION_ENCRYPTION_KEY` without re-encrypting stored integration credentials.

### PostgreSQL backup and restore

Enable provider-managed encrypted daily backups with at least 14 retained copies,
or schedule this equivalent procedure with an encrypted off-host destination.
The application worker does not back up PostgreSQL. Back up the production
configuration/encryption key separately in your secret manager; a database dump
alone cannot decrypt integration credentials.

Create a mode-600 `.env.pg-production` for PostgreSQL's client tools with
`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, and `PGSSLMODE` (use the
provider's TLS requirements). These are separate lines with raw values, not a
SQLAlchemy URL. Use the same PostgreSQL client major version as the server;
the commands below use 16. For restore, create `.env.pg-restore` with credentials
for a **different, newly created empty staging database** owned by its restore
user. Never set restore credentials to the live database.

```sh
set -eu
umask 077
mkdir -p backups
backup="adaptive-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker run --rm --user "$(id -u):$(id -g)" --env-file .env.pg-production \
  --mount "type=bind,src=$PWD/backups,dst=/backup" postgres:16-alpine \
  pg_dump --format=custom --no-owner --no-acl --file="/backup/$backup"
docker run --rm --mount "type=bind,src=$PWD/backups,dst=/backup,readonly" \
  postgres:16-alpine pg_restore --list "/backup/$backup" > /dev/null
# BACKUP_RECIPIENT is your age public encryption recipient; retain its private key separately.
age -r "$BACKUP_RECIPIENT" -o "backups/$backup.age" "backups/$backup"
# Upload the encrypted archive to your backup destination and verify it before
# removing the local plaintext archive. A local archive alone is not a backup strategy.
```

Restore drill (download the encrypted archive first; set `backup` to its filename):

```sh
set -eu
umask 077
age -d -i "$BACKUP_IDENTITY_FILE" -o "backups/restored.dump" "backups/$backup.age"
docker run --rm --env-file .env.pg-restore \
  --mount "type=bind,src=$PWD/backups,dst=/backup,readonly" postgres:16-alpine \
  sh -eu -c 'pg_restore --dbname="$PGDATABASE" --no-owner --no-acl --exit-on-error --single-transaction /backup/restored.dump'
```

Use an isolated staging checkout/configuration pointing to the restored database,
with Telegram/Google credentials disabled; run the documented migration/start
commands and verify user/workout counts and login before accepting the restore.
The restore deliberately omits `--clean` and fails atomically on a nonempty target.
Database creation, roles, provider settings and backup keys are managed separately.

Local development still defaults to SQLite. Set the values in `.env.example`
in a local `.env`, run `alembic -c alembic.ini upgrade head`, then start the
backend and Vite as shown below.

---

## Tests

```bash
pip install -r backend/requirements.txt
pytest
```

```bash
npm test
```

```bash
npx playwright install chromium
npm run test:e2e
```

Playwright covers the login screen, same-week calendar drag, cross-week boundary lock, set logging (e1RM / INOL / tonnage), and offline mutation flush.

---

## Design

This system uses a restrained dark visual schema. See [design.md](design.md) for full specifications.

---

## Safety Mechanisms & Data Integrity

> [!WARNING]  
> **Startup:** On boot, leftover `obsidian_*` / `iron_box_*` LocalStorage keys are purged. Workout trees hydrate from IndexedDB snapshots, then the backend.

> [!IMPORTANT]  
> **Data Integrity**: All prescriptions are strictly columnar (`planned_weight`, `planned_reps`) and tracked against actual chronological dates (`YYYY-MM-DD`). See [architecture.md](architecture.md) for detailed boundaries.

---

## Key Active Folders
* **`src/components/CalendarView.tsx`**: The core periodization planning grid featuring week-long microcycle visual capsules and auto-regulated bounds.
* **`src/components/mobile/TelegramSessionTerminal.tsx`**: High-performance mobile workout logging interface simulating the Telegram Mini App.
* **`src/App.tsx`**: Root shell for view routing and chrome. Periodization data lives in `PeriodizationContext`.
* **`backend/`**: FastAPI database models, sync services, calculation models, and integrations (Telegram Mini App, Google Sheets).

## Database migrations

Schema changes are managed with Alembic. Application startup checks the recorded revision and fails if it is missing or behind; it never creates, alters, or stamps tables. For a new install, set `DATABASE_URL` (optional; defaults to `backend/database.sqlite`) and run from the repository root:

```powershell
$env:DATABASE_URL = "sqlite:///backend/database.sqlite"
alembic -c alembic.ini upgrade head
python -m uvicorn backend.main:app --port 8000 --host 127.0.0.1
```

For production, set `DATABASE_URL` to a persistent PostgreSQL database and run
the migration before the API starts. The Compose setup above does this
automatically. A migration error is a hard failure and must be resolved before
serving traffic.

### Existing databases

The initial revisions support historical schemas produced by the previous `create_all()` plus startup `ALTER TABLE` workflow. Run `alembic upgrade head` against a backed-up database: revision 0001 validates the known legacy shape, adds supported columns/tables/indexes, preserves existing rows, migrates legacy accessory records idempotently, and applies the prior exercise data normalization; revision 0002 adds the nullable Google subject key. It does not stamp an unversioned database automatically. Review/resolve any migration error rather than deleting or recreating the file.

If a pre-Alembic database was already upgraded by an older application, validate it first with `python -m backend.migrations.adopt validate`. The validator checks table/column types and nullability, primary/foreign/unique keys, and index definitions; it accepts only the three known legacy defaults (`tier='Comp'`, `lift_category='Squat'`, `scope='both'`) left by prior startup ALTERs. It also recognizes the known pre-0002 shape without `users.google_sub`. Only after validation succeeds, stop writers and back up the database, then run `python -m backend.migrations.adopt adopt`; this validates again, stamps the schema at `0001_current_schema`, and applies later revisions through head, preserving application rows. Never run `alembic stamp` directly on an unknown schema. For an older or customized schema that validation rejects and the migration cannot safely upgrade, keep the backup and arrange a reviewed, schema-specific migration before adoption.
