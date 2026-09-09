# Adaptive Lifting — Product Design

Adaptive Lifting is work software for powerlifting coaches and athletes. This document records **product and
UI decisions**. It does not describe the code — the code describes itself.

## How to use this document

- **The code is the source of truth for what exists.** If this document disagrees with the code, the code is
  right about what is there. Work out whether this document is stale or is describing something never built,
  and fix it in the same change.
- Every section is labelled **Built**, **Partly built**, or **Not built**. A **Not built** section is a wish.
  Do not implement it because it is written down.
- §3 holds the decisions that bind. If you change one, delete every passage that now contradicts it in the
  same change. Do not add an "overrides" table on top of stale text — that is what made the previous version
  of this document produce wrong code for months.
- System behaviour (data model, sync, auth, API, integrations) lives in `architecture.md`. Do not restate it here.

---

## 1. Intent and principles

The interface must feel fast, precise, and calm under physical fatigue. It prioritises reliable logging, clean
comparison, and immediate workload visibility over presentation.

1. **Training data first.** Weight, reps, RPE, e1RM, INOL, ACWR, status, and sync state are more visible than chrome.
2. **Offline confidence.** A logger always knows whether a set is saved locally, syncing, accepted, rejected, or conflicted.
3. **No hidden system state.** Locks, conflicts, permission limits, and stale data surface as plain UI, not as silence.
4. **Density over decoration.** Coaches scan, compare, and re-edit. Whitespace that costs a row of data is a bad trade.

---

## 2. Surfaces

| Surface | User | Purpose | Status |
| :--- | :--- | :--- | :--- |
| Coach desktop | Coach | Program design, session editing, roster, insights | **Built** — the primary surface |
| Athlete session terminal | Athlete | Set logging | **Partly built** — `src/components/mobile/TelegramSessionTerminal.tsx`, reached through Sessions in athlete mode |
| Integration settings | Coach | Telegram link, Sheets publish | **Built** — panels only |
| Security views | Coach | Devices and sessions | **Built** |
| Telegram Mini App | Athlete | Telegram-native logging | **Not built** as a frontend route. Backend endpoints exist |
| Standalone athlete mobile PWA | Athlete | Offline gym logging | **Not built** as its own installable surface |

Default coach landing is **Sessions for the selected athlete**. There is no schedule that is not attached to an athlete.

---

## 3. Decisions that bind

These are the product decisions. They win over anything else in this file.

### 3.1 Prohibitions

Do not build:

- A marketing landing page, decorative hero, or generic SaaS filler as an app screen.
- Cards nested inside cards.
- Gradient orbs, bokeh, or abstract decorative backgrounds.
- Freeform text parsing for prescriptions or set logging.
- Google Sheets treated as editable or canonical storage. Publishing is one-way, out only.
- Telegram chat commands as the primary logging UI. The Mini App WebView is the intended surface; bot messages
  are entry points, reminders, alerts, and fallbacks.
- UI that hides sync state, lock state, or rejected mutations.
- Charts or dashboards without empty, loading, and error states.
- Numeric training values held as strings.
- A real athlete's name or logged numbers in this document or in test assertions.
- Copy telling the user to re-open or re-import something to refresh stale local data.
- Buttons labelled "Submit" where a domain action exists.

### 3.2 Session editing

The exercise card is where prescription and logging happen. **Built** — `ExerciseCard.tsx`, `PrescriptionEditor.tsx`.

| Decision | Rule |
| :--- | :--- |
| Add Exercise | Identity only: search, base name, variation, category, tier. No Mode, Sets, Reps, RPE, %, or kg controls in the overlay. |
| Prescription editing | kg × reps @ RPE or % is edited on the exercise card set table after the lift is added — `PrescriptionEditor` inline in each Rx cell, `+ Set` on the card. |
| Card layout | Lift name and **anchor e1RM** on the **left**. Set table in the **middle**. **Vol**, **INOL (sum of sets)**, and `+ Set` on the **right**. |
| Per-set INOL | There is no per-set INOL column. INOL is summed for the exercise and shown next to Vol. |
| Rx `%adj` | Its own column on the right of Rx, immediately before copy-to-log. Never wash set rows orange or green based on logged versus prescribed RPE. |
| Set Δ | Sits to the **right of e1RM**, as a **percentage only**, against the most recent preceding logged e1RM. No kg Δ. Set 1 has no Δ. |
| Anchor e1RM | Derived from **set 1 Rx** (planned kg × reps @ RPE or %). Never reverse-prescribe from an edited e1RM, and never show orange suggested kg on Rx. |
| Logged e1RM below RPE 6 | Invert the same intensity percentage used to prescribe, so a set logged as written recovers its anchor. Do not return bar weight. |

### 3.3 Sessions and microcycles

**Built** — `SessionsView.tsx`, `SessionWorkoutEditor.tsx`, `CalendarView.tsx`.

| Decision | Rule |
| :--- | :--- |
| Maximized microcycle header | Name, status, editable start–end dates, Copy, Session, Minimize. Do **not** show stored week tonnage or SQ/BP peaks parsed from `ex.top`. Live Vol and INOL belong on the exercise cards. |
| Collapsed microcycle header | May show scan metrics, because there are no cards visible to read them from. Copy stays available. |
| Microcycle dates | Each week stores optional `startDate` / `endDate` (`YYYY-MM-DD`). Unset weeks default to the ISO Monday–Sunday that contains their placed sessions. The coach edits them on the maximized Sessions header and on Calendar for the assigned week. Drag and add-session stay inside that range. |
| Copy microcycle | Copy on the Sessions week header and on Calendar duplicates prescriptions into a new week after existing weeks, with new ids and no logged sets. |
| Session block | Each session is a distinct block: heading with D-label, calendar date, and title; an **End of Dn** footer with Complete/Reopen after the last exercise. Stacked sessions must never read as one undifferentiated list. |
| Add Session | From a maximized week, Session opens the Calendar tab with that week selected. On Calendar the coach assigns a microcycle and clicks a day inside that week's dates. Title is optional and not part of create. No overlay month picker. |
| Day labels | `D1`, `D2`, … are chronological within a microcycle. Inserting between D1 and D2 becomes D2 and later days increment. Occupied days stay selectable. |

### 3.4 Roster and imported blocks

**Built** — `CoachDashboardView.tsx`, `src/data/athletePlans.ts`, `src/services/planStore.ts`.

| Decision | Rule |
| :--- | :--- |
| Add athlete | The coach adds an athlete **identity** (name, optional email). Account linking is separate. Duplicate names are rejected. |
| Athlete switcher | Native `<select>` in the sidebar. Changing it swaps Sessions, Calendar, and Insights to that athlete in place. No extra screen. |
| Roster row | Clicking a name **selects that athlete and opens Sessions**. An athlete without a block lands on the empty Sessions state. Roster does not go through an overview or an Open-block button. |
| Open block | Removed as a separate step. Selecting the athlete is enough. |
| Unowned seed plan | There is no workout schedule that is not attached to an athlete. Do not restore a demo microcycle tree as a fallback. |
| Imported blocks | Structured data converted offline. A spreadsheet or CSV is never live storage and is never parsed at runtime. Rep ranges such as `10-12` stay rep ranges, not dates. Session dates stay empty when the source has none. |
| Freshness | A cached plan records its athlete, source, and version, and reconciles **automatically** on load, keeping logged sets. Never ask the coach to re-open or re-import to pick up fresh data. |
| Discarding work | Only Reset plan discards logged work, and it says so before doing it. |
| Per-athlete isolation | Each athlete's plan is cached under its own key. Opening one athlete never overwrites another's work. |

### 3.5 Insights

**Built** — `InsightsView.tsx`, `src/insights/construct.ts`.

Assembled from a declared catalog: a KPI strip (SQ/BP/DL e1RM, Vol, DOTS, ACWR), an INOL line, chart slots
(e1RM / Tonnage / ACWR), attempts, and the AI coach panel. Loading, empty, and error states are visible.
Prefer `liftCategory` over scanning exercise titles. Trends come from the **selected athlete's logged sets**.
Switching athletes rebuilds Insights in place. Do not load an unowned API or demo tree.

There is exactly one analytics surface. Do not add a second one.

### 3.6 Athlete data

A real athlete's name, block label, and logged numbers are **fixture data**, never specification. They live in
`src/data/fixtures/`. This document describes capabilities generically and names no real athlete.

---

## 4. Visual system

**Built.** Tokens live in `src/index.css` under Tailwind `@theme`. Most component colour is currently written
as raw hex inline rather than through tokens.

### 4.1 Palette

| Role | Value | Use |
| :--- | :--- | :--- |
| Base | `#000000`, `#0A0A0A` | Workspace background |
| Surface | `#131313`, `#161616` | Panels, inputs, toolbars |
| Border | `white/10`, `white/15` | Dividers and grid lines |
| Text primary | `#FFFFFF` | Data, active values |
| Text muted | `#AEAEB2` | Labels and secondary copy |
| Text faint | `#636366` | Disabled values, column headings |
| Accent | `#007AFF` (`--color-mac-blue`) | Primary action, focus |
| Positive | `#34C759` (`--color-mac-green`), `#75ff9e` | Completed, accepted |
| Warning | `#F5A623` | Pending, caution |
| Danger | `#FF453A` | Errors, rejected, revoked |

Known debt: none on Roster chrome.

### 4.2 Typography

| Role | Stack | Purpose |
| :--- | :--- | :--- |
| UI sans | `--font-sans` | Labels, headings, menus |
| Data mono | `JetBrains Mono` (`--font-mono`) | All numerics, so columns align |

Every training number renders in mono with tabular figures. `--font-sans` is `Inter`.

### 4.3 Numeric formatting

| Metric | Format |
| :--- | :--- |
| Weight | kg canonical and displayed, one decimal where present, unit label visible |
| RPE | Borg CR-10, 0.5 increments, omit a trailing `.0` |
| e1RM | Rounded to the nearest whole kg for display |
| e1RM Δ | Percentage with one decimal and an explicit sign |
| INOL | Two decimals |
| ACWR | Two decimals |
| DOTS | One decimal |
| Velocity | Two decimals, m/s |

Reps are integer only. Weight, reps, and RPE inputs are numeric and reject freeform text.

### 4.4 Density and shape

Sharp, high-density grids. Radii stay small: `4px` for tags and small controls, `8px` for outer panel
boundaries. Do not exceed that inside the operational surfaces. Use full-width workspaces rather than floating
rounded cards inside panels, and never nest a card in a card.

---

## 5. Layout

**Built.** Desktop sidebar is a fixed 240px (`Sidebar.tsx`, `AppShell.tsx`); it does not collapse.

| Width | Strategy |
| :--- | :--- |
| `< 480px` | Single column. Tap targets at least 48px. Numeric steppers span the column. |
| `480–767px` | Two-column split where a surface has a controller and a list. |
| `768–1199px` | Multi-column grids; mouse targets at least 32px. |
| `>= 1200px` | Persistent 240px sidebar, sticky headers, full-density grids. |

Every surface must work at **360px** without horizontal overflow and at **1440px** without clipped tables.
The exercise card reflows to its wide layout via container queries, not viewport width.

---

## 6. Built surfaces

Accurate as of the current code. Each entry names the file so you can check it.

| Surface | File | What it does | Required states |
| :--- | :--- | :--- | :--- |
| App shell | `AppShell.tsx`, `Sidebar.tsx` | Fixed sidebar nav, native athlete `<select>`, account block, Reset plan. Status strip when offline or queued. | offline, queued mutations, authenticated, no athletes |
| Sessions | `SessionsView.tsx` | Primary coach surface for the **selected athlete**. Microcycle list; one week maximizes at a time; stacked session blocks; lift filter; editable week dates; Copy; Session opens Calendar. | loading, empty (no athlete / no sessions), filtered-empty, maximized, collapsed |
| Session block | `SessionWorkoutEditor.tsx` | One session: heading with D-label, date, status and tonnage; exercise cards; End of Dn footer with Complete/Reopen. | planned, in progress, completed, read-only |
| Exercise card | `ExerciseCard.tsx` | Identity and anchor e1RM left, set table middle, Vol/INOL/`+ Set` right. Rx, `%adj`, copy-to-log, Log, e1RM with Δ. | empty sets, logged, read-only |
| Prescription editor | `PrescriptionEditor.tsx` | Inline structured Rx per set cell. | draft, valid, invalid, read-only |
| Add exercise | `AddExerciseDialog.tsx` | Identity-only catalog picker. | empty search, matches, custom, validation error |
| Calendar | `CalendarView.tsx` | Month grid of the selected athlete's sessions. Undated imports occupy sequential days from 2026-09-01. Assign a week, edit its dates, Copy, click a day to add, drag within the week dates. | loading, empty, dragging, rejected drop outside week dates |
| Roster | `CoachDashboardView.tsx` | Roster list and add-athlete form. A row selects that athlete and opens Sessions. | loading, empty roster |
| Insights | `InsightsView.tsx`, `insights/InsightKpiStrip.tsx`, `src/insights/construct.ts` | KPI strip, INOL line, chart slots, attempts, AI coach. | loading, empty, error |
| Conflict review | `ConflictReviewCard.tsx` | Local versus server values with a resolution choice. Surfaced from `SyncContext`. | reviewable, read-only, resolved |
| Security | `SecurityView.tsx` | Devices, sessions, and audit events with revoke. Operational panels; empty when no backend. | loading, empty, active, revoking, disconnected |
| Telegram settings | `TelegramLinkPanel.tsx` | Link token, status, disconnect. | disconnected, linking, connected, failed |
| Sheets publish | `SheetsPublishPanel.tsx` | OAuth connect, publish, outbox status. | disconnected, connected, publishing, failed, revoked |
| Athlete terminal | `mobile/TelegramSessionTerminal.tsx` | Athlete-mode set logging with exercise tabs. | active set, logged, offline |
| Supporting | `LiftFilter.tsx`, `AccessoryLedger.tsx`, `EditablePerformanceCell.tsx`, `LoginView.tsx` | Filter, accessory grouping, spreadsheet cells, auth gate. | — |

`WorkoutLockBanner.tsx` was deleted. Workout locking has no UI until a lock acquire/renew/release flow exists.

---

## 7. States every surface owes the user

A surface is incomplete without the ones that apply:

- **Loading** — never an empty frame with no explanation.
- **Empty** — say what would fill it and what action produces that.
- **Error** — say what failed and what to do, with technical detail collapsed.
- **Permission denied** — read-only presentation, not a hidden control.
- **Offline and syncing** — visible on any screen that accepts input.
- **Rejected and conflicted** — per-row status with a recovery action.
- **Locked or read-only** — controls disabled with the reason stated.

Colour is never the only signal. Pair it with an icon or text.

---

## 8. Naming and copy

- Use domain terms exactly as defined in `architecture.md` §2: `e1RM`, `INOL`, `ACWR`, `DOTS`, `RPE`,
  `microcycle`, `mesocycle`, `tier`.
- `workout` or `session` for scheduled training, never "class", "event", or "task".
- `set` for an execution row.
- `publish` for Google Sheets, never "sync", because Sheets is not canonical.
- `connect` / `disconnect` for integrations, never "install".
- Name the action: `Complete session`, `Publish to Sheets` — never `Submit` or `OK`.
- Error copy explains the fix. Backend codes go in expandable detail.

This document does not specify exact microcopy strings. Strings live in the components; a document that
duplicates them only goes stale.

---

## 9. Not built

Described here so nobody re-invents them by accident, and so nobody builds them because they appear in a spec.
**None of these are requirements.** Ask before starting one.

- **Periodization readiness wave and collapsed readiness lanes** on the calendar.
- **Microcycle calendar view** as an alternative to the month grid, with expand-all-sets and per-day INOL.
- **Collapsible sidebar** (240 → 60 → 0px) and the space-reclamation behaviour that depends on it.
- **SSE live telemetry panel.** The backend broadcasts; no frontend subscribes.
- **Meet day planner** as a dedicated surface. Attempt maths exists inside Insights.
- **Volume and intensity profile** and **movement variation drill-down** analytics tabs.
- **Standalone athlete mobile PWA** and the chronological cross-exercise logging feed.
- **Telegram Mini App frontend route.**
- **Scheduled Sheets publishing.** Publishing is manual.
- **Per-set sync badges** (`PENDING` / `IN_FLIGHT` / `ACKED` / `REJECTED`) on individual set rows. Sync state is
  currently aggregate, in the shell status strip.
- **Workout lock UI.** No acquire/renew/release flow and no banner.
- **Exercise reorder by drag** with `lexo_rank`.
- **Light theme.** Dark only.

---

## 10. Acceptance checklist

Check what applies to the change you made.

**Every screen**

- [ ] Correct role and surface; no landing page, hero, decorative background, or nested cards.
- [ ] Loading, empty, error, and permission-denied states exist.
- [ ] Numeric training values are mono, tabular, and carry units.
- [ ] Colour is not the only status signal.
- [ ] Works at 360px with no horizontal overflow and at 1440px with no clipped tables.
- [ ] Keyboard focus is visible and desktop controls are reachable.

**Logging**

- [ ] Weight, reps, and RPE are numeric-only; reps are integers; RPE takes 0.5 steps.
- [ ] Offline logging still works and says so.
- [ ] Completed or locked sessions disable mutation and explain why.
- [ ] Rejected mutations offer a recovery action.

**Coach**

- [ ] Sessions groups by microcycle and each week has editable start and end dates.
- [ ] Copy on Sessions and Calendar duplicates a week as prescriptions only.
- [ ] Cross-microcycle drag is blocked and explained.
- [ ] Prescription uses structured controls, never parsed text.
- [ ] Metrics use the canonical labels: e1RM, INOL, ACWR, DOTS.
- [ ] Cached athlete data refreshed itself; nothing asked the user to re-open or re-import.
- [ ] Sessions, Calendar, and Insights show the selected athlete. Switching athletes does not require Roster.

**Integrations**

- [ ] Sheets UI states that edits in Sheets do not travel back.
- [ ] Telegram is presented as a Mini App with bot messages as entry and fallback.
- [ ] Provider failure does not block logging.
- [ ] Outbox status is visible.
