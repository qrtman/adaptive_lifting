# Phone layout (program 4)

Owner decisions, 2026-11-14:
- **Who uses it:** all three uses matter — the athlete logs in the gym, the coach reads the athlete's log, and the coach edits the plan.
- **Orientation:** portrait gets a compact layout for the gym. Turning the phone to landscape gives the full table, as on desktop, so nothing is lost.
- **Lift in portrait:** a narrow table with one row per set: `# · Plan (150×3 @8, small, grey) · Log kg · Reps · RPE · ✓`. Empty Log cells show the Plan target faintly. e1RM / Δ / INOL open on tapping the row.
- **Navigation:** a bottom tab bar replaces the sidebar on phones.
- **Not cut down:** every function stays reachable on the phone. Only the layout changes. It is the same web session screen, not a separate phone copy.

## Phases (one PR each)

### M1 · Shell — DONE (#82)
- Below 768px, a bottom tab bar replaces the sidebar: `Calendar · Sessions · Insights · More`. More is a sheet holding the athlete switcher, Roster, Integrations, Security, theme and sign-out.
- The bar hides while the keyboard is open and in landscape.
- Session header on phones:
  - top row: back, Day and the Plan · Both · Log switch;
  - one muted meta line below;
  - Complete session was removed (owner, 2026-11-14).
- No horizontal page overflow at 360px.

### M2 · Portrait set table — DONE
Shipped: Plan text column (tap → set sheet with Plan edit, e1RM / Δ / INOL, Plan → Log, Copy set, Delete set); row tools never overlay a cell on phones; Plan view hides Drop % and the totals columns. Tap-to-edit and the numeric keyboard (from M3) shipped here too.
- When the lift list is narrower than about 600px:
  - Both and Log show the narrow table described above;
  - Plan shows `# · Sets · kg · Reps · Int` (Drop % and the totals are in landscape and in the summary line).
- Tapping a Plan cell opens a small sheet where the coach edits that set's kg / reps / intensity / drop %.
- Tapping a row's ⋯ gives Copy plan → log, Copy, Delete, Note, and the row's e1RM / Δ / INOL.
- The lift name sits on top, its tools behind ⋯.

### M3 · Touch input
- Log cells use the numeric keyboard (`inputmode="decimal"`), with Next moving across kg → reps → RPE.
- Touch targets are at least 44px.
- Done (not merged): lifts start minimized below 768px. Lifts opened during the visit stay open until reload (not saved). Desktop and landscape keep lifts open by default.
- Done (not merged): the lift expand/minimize toggle is a 44px target (lift narrower than 600px). Tapping a minimized lift's row (not a button) opens it.
- Done (not merged), readability pass (lift narrower than 600px unless noted):
  - The lift head is two lines. Line 1: name (bold), `n/m sets` (green when every planned set is logged), then the arrow (minimized) or ⋯ (open; down arrow on the left). Line 2 is one quiet line: tier · movement · Int % · e1RM. Accessories skip the tier; empty values are left out; a lift planned only in its note shows the note there.
  - The drag grip is hidden on phones. Main lifts have Move up / Move down in the lift ⋯ menu (all widths); the header Up/Down buttons are gone.
  - A minimized phone row shows no NL or volume (the open lift's totals line keeps them).
  - Log view on phone hides the Plan text column: only kg, Reps and RPE, with the Plan shown faintly in empty cells. Each set's ✓ (green once logged) opens the set sheet. In Both, the Plan text no longer wraps.
  - Accessories header (all widths) reads `Logged n / m` (or `Logged n sets` with no Plan), replacing `3 lifts · 7 plan sets · 0 logged`.
- The active row stays visible above the keyboard.
- The Sheets keyboard and range selection stay desktop-only.

### M4 · Landscape
- A phone in landscape gets the full desktop table. The name stays on top, because the name column needs 900px or more.
- The bottom bar is hidden in landscape.

### M5 · Calendar, Sessions, Insights at phone width
- Check each at 360 / 390px and fix any overflow.

## Out of scope
- Telegram Mini App.
- A separate "set by set" logger.
- The ± stepper card. The owner chose the narrow table; this can come back later.
