# Scope 11 — Typography

Load this when touching titles or numeric cells. Source: DESIGN-cal type roles, **not** JetBrains as required.

## Locked

| Role | Face | Notes |
| :--- | :--- | :--- |
| Display (month, session name) | Inter 600, letter-spacing −0.5px to −1px | Cal Sans substitute. Never weight 700 for display. |
| UI (nav, labels, buttons) | Inter 500–600, 14px button | DESIGN-cal `button` / `nav-link` |
| Body | Inter 400 | |
| **Training numbers** (kg, reps, RPE, e1RM, INOL, dates in cells) | **Inter** + `font-variant-numeric: tabular-nums` + `font-feature-settings: "tnum"` | Primary trial. User: mono is hard to read. |
| Trial 2 (only if Tab/column alignment fails in e2e or 1440 screenshot) | IBM Plex Sans, still tabular-nums | Add font import; do not keep two number faces. |
| Mono fallback | JetBrains Mono remains in `index.css` unused for grid | Do not put it back on PLAN/LOG without a new user call. |

## Files

- `src/index.css` font import (Inter already loaded; drop Mono from **usage**, import can stay until trial 2)
- `ExerciseCard`, `EditablePerformanceCell`, `CalendarView` — replace `font-mono` on numbers with a `tnum` class
- `design.md` §4.1 — patch Data mono row

## Acceptance

- [ ] Plan kg / Log kg / calendar day numerals are Inter, not a coding font.
- [ ] Columns still line up (tabular figures).
- [ ] Month title is Inter 600, not Cal Sans file.

## Out of scope

Licensing Cal Sans. Changing numeric **storage** types.
