# Adaptive Lifting: Knowledge Block

Persistent context for Cursor agents. Keep this short and aligned with `architecture.md` / `design.md` / `AGENTS.md`.

---

## 1. Core Directives

- **Functionality first**: Sync integrity and canonical math beat decorative UI.
- **Exact paths**: Prefer precise file paths over broad scans when editing.
- **File map**: `.cursor/rules/agent-file-map.mdc` — need → files to read first.
- **Do not ingest** `node_modules/`, `dist/`, `build/`, `.cache/`, or `__pycache__/`. Config files (`package.json`, `.env*`, `tsconfig*.json`, `vite.config.ts`) stay visible.

## 2. Technical State

- **Stack**: React 19 (TypeScript/Vite 6), Tailwind v4 ink theme, FastAPI (Python), SQLite (SQLAlchemy). Docs that still say React 18 are stale.
- **Hybrid state**: IndexedDB for mutation queues and snapshots; LocalStorage only for `al_*` UI prefs — never workout trees. Sidebar collapse is `al_sidebar_collapsed`.
- **Data integrity**: Numeric columns for weights/reps/RPE. Sessions bound to `YYYY-MM-DD`.
- **Navigation**: Hash routes `#/calendar|sessions|insights|integrations|security`. Left sidebar owns nav + athlete plan scope. There is no Athletes Roster tab; `#/roster` and `?view=roster` land on calendar with the scope selector open. Coach code stays on Security.

## 3. Product Model (current focus)

- **Athlete-owned plan space**: Training data belongs to the athlete. A linked coach gets shared full write; unlink revokes coach access only — the plan stays.
- **Coach code**: Coach publishes a code; athlete enters it to link. Not email-as-code.
- **Session-first**: Session (workout on a date) is the primary entity. Block/Week are optional grouping labels (block prefixes week). Assign or change labels anytime; unlabeled sessions are allowed.
- **No demo seed**: Empty athletes start empty. Never auto-inject sample microcycles on fetch/reset/push.
- **Surfaces**: Calendar = hover overlay on a day (absolute; does not grow the cell) with compact New session, Copy to if a session exists, and Notes. Saved day notes appear as a distinct card at rest, keyed by calendar date + athlete plan. Click an existing session to open it. Sessions = group/filter by Block/Week when present. New session is Name, then a compact Day / Block / Week row (Block/Week optional). Day/Name/Block/Week edit through a centered dialog (Edit), not always-open fields. Day is a training-slot label (`dayLabel`), independent of date. Insights = composable cards (saved configs, server query); presets ship as data, not hardcoded chart components. Coach Calendar/Sessions/Insights follow the sidebar athlete switcher. Insight-card offline flush uses `mutation_type: insight_card` (no fake workout_id).
- **Math pin**: `MATH_VERSION` (`linear-decay-v3`) is the same string in `backend/math_utils.py` and `src/services/mathEngine.ts`. Shared set vectors live in `tests/math_vectors.json`. Sync 409s on mismatch. e1RM uses RPE-compensated linear decay with `E1RM_RPE_FLOOR = 5.0` (formula input only; missing RPE still returns load) and no 25% metabolic drop cap (same load×reps: lower RPE ⇒ strictly higher e1RM).
- **Add lift**: Centered dialog groups exercises like RTS (category, search, exercise), then variation chips. Search is a live in-memory filter of `CATALOG_EXERCISES` (name, pattern, category, aliases) with a **visible** results list — see `.cursor/rules/add-lift-search.mdc`. No starting-set editor in that dialog. On the session, a lift shows compiled name + Edit; bar/tempo/ROM/gear stay in that dialog, not always-open. Movement pattern is a stored catalog field (`movement_pattern`) edited with a structured select, not inferred at query time.
- **Plan kg**: Type the kilos. Switching RPE / % only changes the @ box, not the kilos. Extra sets start with empty kilos. Plan numbers are saved like a log. After you log a set, later empty plan kg may show a suggestion from that log — click to take it, never auto-overwrite.
- **Web first**: Coach and athlete use the same web session screen to add lifts and log sets. Telegram Mini App / phone logging is deferred until the web constructor is done. Do not build or gate session work on the phone mock.
- **Copy**: Day, week, and block grains. Copy to on a calendar chip or session card (or Copy selected), then click the destination Calendar day = D1 (earliest source date). Relative date gaps stay. Paste never asks for Block: source block, or recent block (`al_recent_block`, athlete-scoped UI pref) when sources are unlabeled. Copy lifts is plan only; copy with logs includes logged sets. Rename from Edit.
- **Reorder lifts**: Up/Down on the session screen. Order is stored as `lexo_rank`. Finished sessions stay locked until Open.
- **Lift names**: Structured chips compile bar/style, ROM, and gear. Tempo is three digits (ecc-pause-con), not preset chips or a freeform program.
