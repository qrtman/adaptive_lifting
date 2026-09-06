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
