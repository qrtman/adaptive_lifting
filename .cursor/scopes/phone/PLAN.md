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
  - Complete stays reachable.
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
