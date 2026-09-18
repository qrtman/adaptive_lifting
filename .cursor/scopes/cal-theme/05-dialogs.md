# Scope 05 — Dialogs (Phase A)

Load this for New/Edit session and Notes chrome. Depends on 01, 02. Behavior: `.cursor/rules/session-day-name.mdc`.

## Task

`CenteredDialog` + session/notes forms use Cal `text-input` (40px, 8px radius, hairline) and `button-primary` (black, 40px). Layout already locked: Name first, then Day · Block · Week row.

## Locked

- Do not change field order, prefills (`al_recent_*` athlete-scoped), or `dayLabel` canonical `"1"`…`"7"`.
- Primary Create/Save = black CTA. Cancel = secondary / text-link.
- ComboBox listbox is a **nested elevated card** (lift shadow + short enter motion). Dialog outer card → Name card → slot card (Day/Block/Week). Overlays still skip dummy extra wraps that are not objects.
- Respect `prefers-reduced-motion` (no translate/scale).
- Notes dialog title `Notes · YYYY-MM-DD` stays.

## Files

- `src/components/CenteredDialog.tsx`
- `src/components/NewSessionDialog.tsx`
- `src/components/EditSessionDialog.tsx`
- `src/components/DayNoteDialog.tsx`
- `src/components/ComboBox.tsx` (colors only)
- `e2e/calendar.spec.ts` (create/edit)

## Data

Unchanged APIs: create session, PATCH session, GET/PUT day-notes.

## States

loading · empty Name error · need-athlete · offline · permission

## Acceptance

- [ ] Both themes: inputs readable, primary button is black (or inverted dark-theme primary).
- [ ] Remember-last Day/Name still works.
- [ ] 360px: Name → Day full → Block|Week wrap still allowed.

## Out of scope

Add-lift dialog (Phase B / with 06). Adj dialog (06).
