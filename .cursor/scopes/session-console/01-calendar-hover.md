# Scope 01 — Calendar hover overlay

Load this for Sep-1 hover chrome. Depends on `.cursor/rules/calendar-day-notes.mdc`. Overlay is **not** a nested card (`.cursor/scopes/cal-theme/10-nested-cards.md`).

## Task

The action stack may cover session/note chips. Give it real elevation. Stop the twitchy motion. Do **not** blur the day.

## Diagnosis (do not re-litigate)

Sep 1 hover sits on SQ 150×5@6 + note with `shadow-sm` and no lift — the stack looks pasted on, not above. Day cell uses `transition-colors` + accent ring; ComboBox/dialog `translateY`/`scale` does **not** belong here. `backdrop-blur` would frost the chips the user already accepted covering.

## Locked

- Covering chips: **OK**. Height vs neighbor still unchanged.
- **No** `backdrop-blur`, **no** dim scrim over the day.
- Stack: `position: absolute` (already), opaque `bg-[var(--cal-surface-elevated)]`, `border-[var(--cal-hairline)]`, `shadow-[var(--cal-shadow-lift)]` (not `shadow-sm`).
- **No** `translate` / `scale` / `cal-elevate-in` on the day or the buttons. Opacity-only ≤ 80ms is optional; zero motion is better. Honor `prefers-reduced-motion`.
- Actions unchanged: New session (black primary) → Copy to (iff session) → Notes. Same testids.
- Do not restyle session chips into the overlay.

## Files

- `src/components/CalendarView.tsx` (hover node only)
- `e2e/calendar.spec.ts` (height vs neighbor still equal; overlay visible on a day with a session)

## States

hover empty · hover with session · hover with note · copy-to armed (overlay hidden)

## Acceptance

- [ ] Hovered day in-flow height equals unhovered neighbor.
- [ ] Overlay computed `position` is `absolute`; box-shadow is the lift token.
- [ ] No blur filter on the day cell.
- [ ] New session / Copy to / Notes still work.

## Out of scope

Lift filter (02). Notes editor. Copy D1 meaning.
