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

For Docker production, the database is `/data/adaptive-lifting.sqlite`. Before upgrading, stop application writers and make a verified backup of the SQLite file. Then run the migration command against the same `DATABASE_URL` from a one-off container, for example `docker compose run --rm -e DATABASE_URL=sqlite:////data/adaptive-lifting.sqlite api alembic -c alembic.ini upgrade head`; the compose volume mounts the production data volume. Start/restart the API after the migration succeeds. A migration error is a hard failure and must be resolved before serving traffic.

### Existing databases

The initial revisions support historical schemas produced by the previous `create_all()` plus startup `ALTER TABLE` workflow. Run `alembic upgrade head` against a backed-up database: revision 0001 validates the known legacy shape, adds supported columns/tables/indexes, preserves existing rows, migrates legacy accessory records idempotently, and applies the prior exercise data normalization; revision 0002 adds the nullable Google subject key. It does not stamp an unversioned database automatically. Review/resolve any migration error rather than deleting or recreating the file.

If a pre-Alembic database was already upgraded by an older application, validate it first with `python -m backend.migrations.adopt validate`. The validator checks table/column types and nullability, primary/foreign/unique keys, and index definitions; it accepts only the three known legacy defaults (`tier='Comp'`, `lift_category='Squat'`, `scope='both'`) left by prior startup ALTERs. It also recognizes the known pre-0002 shape without `users.google_sub`. Only after validation succeeds, stop writers and back up the database, then run `python -m backend.migrations.adopt adopt`; this validates again, stamps the schema at `0001_current_schema`, and applies later revisions through head, preserving application rows. Never run `alembic stamp` directly on an unknown schema. For an older or customized schema that validation rejects and the migration cannot safely upgrade, keep the backup and arrange a reviewed, schema-specific migration before adoption.
