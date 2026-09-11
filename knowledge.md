# Adaptive Lifting: Knowledge Block

Persistent context for Cursor agents. Keep this short and aligned with `architecture.md` / `design.md` / `AGENTS.md`.

---

## 1. Core Directives

- **Functionality first**: Sync integrity and canonical math beat decorative UI.
- **Exact paths**: Prefer precise file paths over broad scans when editing.
- **Do not ingest** `node_modules/`, `dist/`, `build/`, `.cache/`, or `__pycache__/`. Config files (`package.json`, `.env*`, `tsconfig*.json`, `vite.config.ts`) stay visible.

## 2. Technical State

- **Stack**: React (TypeScript/Vite), Tailwind, FastAPI (Python), SQLite (SQLAlchemy).
- **Hybrid state**: IndexedDB for mutation queues and snapshots; LocalStorage only for `al_*` UI prefs — never workout trees.
- **Data integrity**: Numeric columns for weights/reps/RPE. Sessions bound to `YYYY-MM-DD`.

## 3. Product Model (current focus)

- **Athlete-owned plan space**: Training data belongs to the athlete. A linked coach gets shared full write; unlink revokes coach access only — the plan stays.
- **Coach code**: Coach publishes a code; athlete enters it to link. Not email-as-code.
- **Session-first**: Session (workout on a date) is the primary entity. Block/Week are optional grouping labels (block prefixes week). Assign or change labels anytime; unlabeled sessions are allowed.
- **No demo seed**: Empty athletes start empty. Never auto-inject sample microcycles on fetch/reset/push.
- **Surfaces**: Calendar = hover a day to show New session (and Copy to if a session exists). Click an existing session to open it. Sessions = group/filter by Block/Week when present. Name/Block/Week edit through a centered dialog (Edit), not always-open fields.
- **Add lift**: Centered dialog groups exercises like RTS (category, search, exercise), then variation chips. No starting-set editor in that dialog.
- **Web first**: Coach and athlete use the same web session screen to add lifts and log sets. Telegram Mini App / phone logging is deferred until the web constructor is done. Do not build or gate session work on the phone mock.
- **Copy**: Copy to on a calendar session, then click the destination day. Sessions list still has copy lifts / copy with logs on the group header. Copy lifts is plan only; copy with logs includes logged sets. Rename from Edit.
- **Reorder lifts**: Up/Down on the session screen. Order is stored as `lexo_rank`. Finished sessions stay locked until Open.
- **Lift names**: Structured chips compile bar/style, ROM, and gear. Tempo is three digits (ecc-pause-con), not preset chips or a freeform program.
