# Obsidian Kinetic Periodization Dashboard (Iron Box Terminal)

Sleek, high-fidelity, and auto-regulatory periodization dashboard for elite powerlifting coaches and athletes.

---

## 🚀 System Requirements & Run Instructions

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

## 🎨 Premium Design Philosophy
This system is strictly designed around a premium "Obsidian & HSL" visual schema. Expect micro-animations, glassmorphic blurs, and strict adherence to specific brand colors (RTS Blue, Obsidian Jade, CNS Orange). See [design.md](design.md) for full specifications.

---

## 🛡️ Safety Mechanisms & Data Integrity

> [!WARNING]  
> **Startup Guard Active**: The `App.tsx` contains a robust Error Boundary Startup Guard. Upon application boot, it sanitizes local storage and isolates corrupted UI preferences, resetting them to safe default states automatically to eliminate blank-screen failures.

> [!IMPORTANT]  
> **Data Integrity**: All prescriptions are strictly columnar (`planned_weight`, `planned_reps`) and tracked against actual chronological dates (`YYYY-MM-DD`). See [architecture.md](architecture.md) for detailed boundaries.

---

## 📁 Key Active Folders
* **`src/components/CalendarView.tsx`**: The core periodization planning grid featuring week-long microcycle visual capsules and auto-regulated bounds.
* **`src/components/mobile/TelegramSessionTerminal.tsx`**: High-performance mobile workout logging interface simulating the Telegram Mini App.
* **`src/App.tsx`**: Main component managing periodization data, viewport checks, IndexedDB state synchronization, and startup state validation.
* **`backend/`**: FastAPI database models, sync services, calculation models, and integrations (Telegram Mini App, Google Sheets).

---

## 🗄️ Archived & Legacy Assets

> [!CAUTION]
> The following files are **DEPRECATED** and should not be used for active development. They are retained purely for historical reference.

| File Name / Category | Description |
| :--- | :--- |
| **`migration_manifest.md`** | Deprecated relational DB mappings. |
| **`analysis_terminal.html`** | Static dashboard mockup iteration from earlier versions. |
| **`athlete_logger_terminal.html`** | Static logger screen export. |
| **`command_center.html`** | Static switchboard control panel. |
| **`execution_feed.html`** | Old training feed export. |
| **`stitch_*.html`** | Static design references exported from Stitch boards. Do not edit. |
| **`download_screens.py`** | Script for syncing assets from design boards. |
| **`call_stitch_*.py`** | Script helpers interacting with Stitch APIs. |
