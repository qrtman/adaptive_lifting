# Scope 01 — Calendar hover overlay

Load this for Sep-1 hover chrome. Depends on `.cursor/rules/calendar-day-notes.mdc`. Overlay is **not** a nested card (`.cursor/scopes/cal-theme/10-nested-cards.md`). Elevation tokens: `design/sources/DESIGN-cal.md` **Elevation & Depth**.

## Task

Do **not** cover session or note cards. Park New session / Copy to / Notes in empty space. Elevate **the card under the pointer**, not the whole day.

## Diagnosis (do not re-litigate)

The bottom-left stacked overlay sat on SQ + note. Covering was the old lock; it is **void**. Expanding the day or shrinking cards to make room is also void — both change the week row or the data chips.

The date row (`01` left, nothing right) is unused chrome. Session/note cards already use `surface-card` but `shadow-sm` at rest, so they never get DESIGN-cal’s rest-flat → hover-lift.

## Locked

- **Do not cover** this day’s session chips or note card.
- **Do not** grow the day cell on hover. **Do not** shrink session/note cards to make room.
- Overlay stays `position: absolute` (out of flow). Sit it in leftover space **inside this cell** — a `flex-1` pocket under the chips, typically the unused bottom of `min-h-[128px]`. Bound the cluster to that pocket (`inset-0`, wrap). Do **not** paint out to the right onto a neighbor.
- **No** `backdrop-blur`, **no** dim scrim, **no** wrapper card around the actions (buttons only).
- **No** `translate` / `scale` / `cal-elevate-in` on the **day** or the **action buttons**. Honor `prefers-reduced-motion`.
- Actions unchanged: New session (black primary) → Copy to (iff session) → Notes. Same testids. Copy-to still uses unfiltered `dayWorkouts[0]`.

### Cards inside the day (DESIGN-cal elevation)

| Rest | Hover (the card under the pointer) |
| :--- | :--- |
| Card surface: `bg-[var(--cal-surface-card)]`, hairline border, **no shadow** | Subtle drop: `box-shadow: var(--cal-shadow-lift)` (`0 4px 12px` / dark token). Optional `translateY(-1px)`. 180ms ease. |

Note card keeps dashed / muted rest so it is not a session. It still lifts on its own hover.

Do not lift every card when the day is hovered — only the chip the pointer is on.

## Files

- `src/components/CalendarView.tsx` (hover node + session/note chip classes)
- `src/index.css` (`.cal-day-chip` hover lift; reduced motion)
- `e2e/calendar.spec.ts` (height vs neighbor; overlay does not intersect session/note rects; chip hover shadow)

## States

hover empty · hover with session · hover with note · hover a session chip · hover a note chip · copy-to armed (overlay hidden)

## Acceptance

- [ ] Hovered day in-flow height equals unhovered neighbor.
- [ ] Overlay computed `position` is `absolute`; it does not overlap this day’s session or note cards.
- [ ] No blur filter on the day cell.
- [ ] Session/note chips rest with no drop shadow; the hovered chip uses `--cal-shadow-lift`.
- [ ] New session / Copy to / Notes still work.

## Out of scope

Lift filter (02). Notes editor. Copy D1 meaning.
