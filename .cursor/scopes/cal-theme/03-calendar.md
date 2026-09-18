# Scope 03 — Calendar (Phase A)

Load this when restyling the month grid. Depends on 01, 02, 10. Behavior rules: `.cursor/rules/calendar-day-notes.mdc`, copy clipboard, session-day-name (create dialog chrome is 05).

## Task

Cal-like **scheduling widget**: 7-col month, hairline grid, nested session/note cards, compact hover overlay. Product actions stay: New session, Copy to, Notes.

## Locked

- Date-first. Mon–Sun columns stay. No forced week containers for unlabeled sessions.
- Day cell = **outer card** (radius 12px or shared hairline grid — pick one: Cal booking widgets use hairline cells; we allow **card-per-day**). Session chip + day note = **inner cards** (level 2). No level 3.
- Hover overlay: `position: absolute`, `w-max` cap ~160px, does **not** change in-flow cell height. Actions: New session (primary **black**), Copy to (if session), Notes (secondary).
- Empty day click still opens New session. Copy-to mode: overlay hidden; dest click = D1 date offset.
- Meso strip: Cal pill / caption, not a glowing green orb.
- Lift filter: **nav-pill-group** (All · Squat · Bench · Deadlift) using DESIGN-cal `nav-pill-group` + `category-tab`.
- Density: keep `min-h-[128px]`-class budget unless inner cards clip; then grow **content**, not marketing padding.
- SQ/BP/DL labels stay; color from `--cal-*` badge tokens.

## Files

- `src/components/CalendarView.tsx`
- `src/components/LiftFilter.tsx` (if pill group lives there)
- `e2e/calendar.spec.ts`, `e2e/copy.spec.ts`
- `design.md` calendar workspace row — patch copy to Cal light/dark + nested cards

## Data (do not change)

- Workouts by `date`. `DayNote` by `(owner_id, date)`.
- `copyClipboard` grains. `dayLabel` unused for dest D1.

## States

empty month · day with session · day with note only · session+note · hover overlay · copy-to armed · coach no athlete · loading notes · notes error · offline (create still local if existing path allows)

## Acceptance

- [ ] Light and dark month grid readable; today/hover ring uses accent blue, not random neon.
- [ ] Hover height vs neighbor unchanged (existing e2e).
- [ ] Nested session/note cards visible at rest.
- [ ] Filter pills match nav-pill-group (light: soft gray track, white active).
- [ ] Copy D1 and notes still pass Playwright.

## Out of scope

Readiness wave, flow connectors, tVol on every cell, dialog internals (05), session editor (06).
