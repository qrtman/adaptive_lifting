# Scope 01 — Calendar hover overlay

Load this for Sep-1 hover chrome. Depends on `.cursor/rules/calendar-day-notes.mdc`. Overlay is **not** a nested card (`.cursor/scopes/cal-theme/10-nested-cards.md`). Elevation tokens: `design/sources/DESIGN-cal.md` **Elevation & Depth**.

## Task

Do **not** cover session or note cards. Keep calendar chips to **name + Day/Week/Block + one short-lift line**. Reserve hover-action space **at rest** so filling New session / Copy to / Notes never grows the day. Elevate **the card under the pointer**, not the whole day.

## Diagnosis (do not re-litigate)

Absolute leftover overlays sat **behind** session/note chips (z-index) or spilled into the next day. Covering, shrinking chips, and growing **on hover** are void. Deep set lines (`SQ 150×5@6`) on the calendar made chips too tall for a reserved dock.

## Locked

- **Do not cover** this day’s session chips or note card.
- **Do not** grow the day cell **on hover**. **Do not** shrink session/note chips to make room.
- Week / day row **may grow at rest** when chips + a reserved action dock exceed `min-h-[128px]`. That reserved dock is always in flow (`mt-auto`, stacked compact buttons). Hover only fills it.
- Overlay is **in-flow**, not `position: absolute`. Bound to this cell (`w-full`). Do **not** paint out to the right onto a neighbor.
- Calendar chips drop kg×reps@RPE. Show **Name**, then Day · Week · Block when labeled, then one truncated line of unique short lift codes (`SQ · BP · DL`). Empty fields omit their line.
- **No** `backdrop-blur`, **no** dim scrim, **no** wrapper card around the actions (buttons only).
- **No** `translate` / `scale` / `cal-elevate-in` on the **day** or the **action buttons**. Honor `prefers-reduced-motion`.
- **No** accent inset ring on the day cell for hover or today. Today is the accent **numeral** only. Hover is a quiet `surface-soft` fill (180ms) plus the dock. ~100ms hover intent before filling the dock. Copy-to destination rings stay (mode, not hover).
- Actions unchanged: New session (black primary) → Copy to (iff session) → Notes. Same testids. Copy-to still uses unfiltered `dayWorkouts[0]`.

### Cards inside the day (DESIGN-cal elevation)

| Rest | Hover (the card under the pointer) |
| :--- | :--- |
| Card surface: `bg-[var(--cal-surface-card)]`, hairline border, **no shadow** | Subtle drop: `box-shadow: var(--cal-shadow-lift)` (`0 4px 12px` / dark token). Optional `translateY(-1px)`. 180ms ease. |

Note card keeps dashed / muted rest so it is not a session. It still lifts on its own hover.

Do not lift every card when the day is hovered — only the chip the pointer is on.

## Files

- `src/components/CalendarView.tsx` (compact chips + reserved in-flow dock)
- `src/index.css` (`.cal-day-chip` hover lift; `.cal-day-cell` 180ms fill; `.cal-day-dock` opacity fade; reduced motion)
- `e2e/calendar.spec.ts` (height vs neighbor **on hover**; overlay inside cell, no cover; chip lift; no deep set line; no `#007AFF` inset ring on hover/today; copy-to destination rings stay)

## States

hover empty · hover with session · hover with note · hover a session chip · hover a note chip · copy-to armed (overlay hidden) · rest with many chips (row may be taller)

## Acceptance

- [ ] Hovered day in-flow height equals that same day at rest (neighbor may already be taller from rest content).
- [ ] Overlay sits in the reserved dock; it does not overlap this day’s session or note cards; it does not overflow the cell.
- [ ] Session chips show name / Day·Week·Block / short lift codes — not `kg×reps@RPE`.
- [ ] No blur filter on the day cell.
- [ ] Hovered / today day cells have **no** `#007AFF` inset ring. Copy-to destination rings still show.
- [ ] Session/note chips rest with no drop shadow; the hovered chip uses `--cal-shadow-lift`.
- [ ] New session / Copy to / Notes still work.

## Out of scope

Lift filter (02). Notes editor. Copy D1 meaning.
