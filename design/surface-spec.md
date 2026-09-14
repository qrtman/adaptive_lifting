# Calendar and sheet surface

Interaction spec for the month calendar, set grid, and right inspector. Tokens live in `design/tokens.md`. Code (not older `design.md` roster ASCII) is the source of truth for current navigation.

---

## Open decisions

1. **Week starts Monday.** `CalendarView` already uses Monday = 0. No `al_week_starts_on` pref exists. Add the pref (0 = Sunday, 1 = Monday) defaulting to Monday so a later settings row can flip it without a schema change.
2. **No session templates in the repo.** Quick-create omits a template picker. Fields: date (prefilled), title, optional Block, optional Week.
3. **Session notes need a column.** Sets already have `note`. Workouts do not. Add `workouts.notes` (text, nullable) via schema migration `002_session_notes`. Never parse notes as prescription.
4. **Sessions workspace is list mode of the same data**, grouped by Block/Week when labels exist (current `SessionsView` behavior), not a second constructor. Route stays `#/sessions`. Opening a row opens the inspector (or `#/sessions/:id/grid` on wide screens).
5. **Copy-to stays.** Current calendar copy-to is an operator workflow. Keep it on the chip/day popover as "Copy to…", then click a destination day. Not specified in the prompt; retaining it avoids a regression.
6. **Drag reschedule is date-only.** Existing drag also offered cascading periodization shift. The spec asks for a dated mutation. Inspector date field is the keyboard path. Cascading shift is **not** in this slice (record as future).
7. **Unit preference kg/lb.** No `al_unit` pref exists; storage and math are kilograms. Grid validates kg. A display-lb conversion is out of scope until a pref exists; cells stay kg.
8. **Virtualization skipped.** A session rarely exceeds 60 sets. No list virtualizer.
9. **SSE.** `/api/workouts/{id}/live` exists. Calendar chips listen to a session-scoped stream when the inspector is open, and a lightweight poll/reload of the visible month on `visibilitychange` / sync ACK until a plan-level SSE exists. Incoming chip updates use `--dur-fast` highlight.

---

## 1. Month calendar

### Grid

- 7 columns, 5 or 6 rows. Role `grid`. Column headers Mon–Sun (or Sun–Sat if pref is 0).
- `role="row"` / `aria-rowindex` on week rows; day cells `role="gridcell"` with `aria-selected` for focus.
- Today: accent border. Other-month days: muted, not focusable for create (still in the grid for complete weeks).

### Day cell

- Default: date number (`--text-mini`, mono) and **real session chips only**. Empty in-month days have no “New session” text or fake chip.
- Hover, `:focus-within`, or calendar day focus reveals two **ghost** actions (20–24px, ink ghost buttons): `+` (New session) and a note icon. They are not chips and must not cover chips.
- Hit testing:
  - `+` → day-anchored quick-create
  - note → notes flow (below)
  - chip → inspector; double-click / Enter on chip → grid-focused inspector
  - remaining padding → **select the day** (does not create)
  - `+N more` → day popover
- Week-strip / touch: no permanent “New session”. A `⋯` control or long-press exposes the two actions. Tap chip still opens the inspector.

### Empty day `n` / hover `+`

- Quick-create is a **day-anchored popover**, min width `--inspector-snap-a` (360). Not a centered mini-modal. Below `--bp-inspector-overlay`, use the existing inspector overlay.
- Fields: **Name combobox** (existing plan titles, most recent first, creatable; empty disables Create), Block, Week (same combobox primitive), optional Notes.
- Confirm: `POST /api/sessions`. If notes were entered, `PATCH` notes after create. Offline: disable confirm (no new create-mutation type).
- Success closes the popover and opens the inspector at snap B (560) (`#/calendar?session=<id>`).
- Esc / Cancel / backdrop: no create.

### Name / Block / Week

- APG combobox (`role="combobox"` + listbox): typeahead, Arrow/Enter/Esc. Enter uses an existing name or creates a new one. Not a free-text field defaulting to “Session”.

### Notes from the day (no day-notes entity)

- 0 sessions: create popover with Notes focused.
- 1 session: open inspector and focus session Notes.
- N sessions: day popover with a Note action per row, then inspector Notes.

### Chip click

- Single click: open inspector, stay on calendar.
- Double-click or Enter on a focused chip: inspector with grid focused (`#/calendar?session=<id>&grid=1` or `#/sessions/:id/grid` when the viewport ≥ `--bp-inspector-overlay` and the user is in sessions list).

### Drag chip

- HTML5 drag to another **current-month** day → `PATCH /api/sessions/{id}` `{ date }` (existing). Keyboard: inspector date field.
- Announce via live region: "Moved {title} to {date}".

### Keyboard

| Key | Action |
| :--- | :--- |
| Arrows | Move day focus |
| Enter | Day popover (even if empty). `n` / ghost `+` creates |
| `n` | Quick-create on focused day |
| `[` / `]` | Previous / next month |
| `t` | Today (focus + scroll) |
| `?` | Shortcuts overlay |
| Esc | Close popover / inspector (inspector Esc once blurs grid, twice closes) |

### Live updates

- If the open session is locked by the other party, inspector is read-only with locker identity (existing lock banner copy).
- Chip highlight `--dur-fast` on SSE or reload diff.

---

## 2. Set grid

Inside the inspector always. Full route `#/sessions/:id/grid` for viewports ≥ `--bp-inspector-overlay` (sheet takes the main pane; inspector header still available as a slim top meta row).

### Structure

- Rows: one per set, grouped by exercise. Exercise header row: title, compact **pattern badge** (click → listbox; closes on select, Esc, focus leave, or when a set cell is editing), variation Edit, icon toolbar (`+` set, reorder, remove). One header row so Actual load / Actual reps stay visible at inspector snap A.
- Pattern is never an open `<select>` while sets are being edited.
- Columns, fixed order, hideable via column menu (pref `al_grid_hidden_cols` JSON array):

| Col | Key | Editable | Notes |
| :--- | :--- | :--- | :--- |
| Exercise | `exercise` | header only | sticky |
| Set | `set` | no | label |
| Planned load | `plannedWeight` | yes | kg |
| Planned reps | `plannedReps` | yes | int ≥ 0 |
| Planned RPE | `plannedRpe` | yes | 6.0–10.0 × 0.5 if intensity is RPE |
| Planned % e1RM | `plannedPct` | no | derived |
| Actual load | `actual` | yes | |
| Actual reps | `reps` | yes | |
| Actual RPE | `executedRpe` | yes | |
| e1RM | `e1rm` | no | server; preview mark if client |
| Notes | `note` | yes | free text, never parsed |

Intensity type RPE/% remains a header control on the exercise (existing), not a grid column.

### Cell state (discriminated union)

`idle | selected | editing | pending | locked | invalid`

Reducer owns: `focus`, `anchor` (range), `editBuffer`, `pendingIds`, `invalidReason`. Pending mutations and selection are separate.

### Editing model

- Enter or printable character starts edit on a writable selected cell.
- Esc cancels. Enter commits and moves down. Tab commits and moves right. Shift+Enter / Shift+Tab reverse.
- Arrows move selection when not editing. Shift+arrows expand range.
- Ctrl/Cmd+D fill-down: copy the top cell of the range into the rest (numeric columns only).
- Copy/paste: TSV of numeric cells within the grid. Paste into planned vs actual respects the target columns.
- Delete: clears **actual** columns in the range. Planned columns clear only if the active role is coach (`roleMode === 'coach'`). Athletes cannot delete planned values with Delete.

### Validation

- Numeric only for load/reps/RPE/% display.
- Load ≥ 0. Reps integer ≥ 0. RPE 6.0–10.0 in 0.5 steps when the exercise intensity is RPE; % 0–100 when PERCENT.
- Invalid keeps `editing` + `invalid` with inline reason; no silent clamp.

### Derived cells

- e1RM: server `set.e1rm` when present. Else `mathEngine.calculateE1RM` with a "preview" indicator until sync returns the server value.
- % of e1RM: planned load / e1RM × 100 when e1RM > 0.

### Row operations

- Add set below, duplicate set, delete set (tombstone).
- Add exercise: structured picker (catalog + `movement_pattern` column + User Defined → Misc). Same contract as current `AddLiftBar`.
- Reorder exercise: drag header or Alt+↑ / Alt+↓ → existing `PATCH ... move=up|down`.

### Roles

- Shared write on planned and actual. Default focus: coach → first planned load; athlete → first actual load.
- Locked-by-other: all cells `locked`, show locker name.

### Offline

- Edits go through `queueMutation` / existing set replace API used by PeriodizationContext.
- Cell `pending` until ACK. Conflict: inspector shows the existing conflict card; losing edit is not dropped silently.

---

## 3. Right inspector

Sections:

1. Header: title, date, Block, Week, status (structured; Edit in place).
2. Summary: server totals — tonnage, set count, INOL, avg intensity (new fields on the session payload).
3. Grid.
4. Session notes.

Width: resizable between `--inspector-snap-a` (360) and `--inspector-snap-b` (560). Persist `al_inspector_width`. Below `--bp-inspector-overlay`, inspector is a full-height overlay (sidebar icons only).

URL: `#/calendar?session=<id>` without leaving the calendar. Telegram / deep link uses the same hash. `writeAppLocation` gains `sessionId` and optional `grid`.

---

## 4. Responsive

| Width | Calendar | Sidebar | Inspector | Grid |
| :--- | :--- | :--- | :--- | :--- |
| ≥ 960 | Month | Expanded or user-collapsed | Side panel | Sticky Exercise+Set |
| 720–959 | Month if chips fit; else week strip + agenda | Icons | Overlay | Horizontal scroll, sticky Exercise+Set |
| < 720 | Week strip + agenda list | Icons | Overlay | Horizontal scroll |

Same components. No separate mobile logging flow.

---

## 5. Shortcuts overlay

`?` opens a non-modal overlay listing calendar and grid shortcuts. Esc closes. `data-testid="shortcuts-overlay"`.

---

## 6. Accessibility

- Calendar and SetGrid: `role="grid"`, `aria-rowindex`, `aria-colindex`, roving tabindex.
- Live region (`aria-live="polite"`) announces commit, validation, reschedule, lock.
- Every drag has a keyboard equivalent (inspector date; Alt+arrows).

---

## 7. Out of scope (recorded)

- Freeform prescription parse (`3x5@80%`) as a future quick-entry mode.
- lb display.
- Cascading multi-day shift on drag.
- Session-create mutation while fully offline.
- Insights card semantics (token pass only).
