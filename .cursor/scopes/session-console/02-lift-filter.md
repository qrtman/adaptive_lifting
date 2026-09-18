# Scope 02 — Lift filter dialog

Load this when replacing All · Squat · Bench · Deadlift. Calendar and Sessions share one control.

## Task

The 4-pill is too simple. Open a **CenteredDialog** of click-select facets, like a small constructor. Filter the month/list, do not add lifts.

## Diagnosis (do not re-litigate)

`LiftFilter` is a nav-pill of four strings. Matching is `title.toLowerCase().includes('squat'|'bench'|'dead')` — accessories named “Squat” false-positive; `liftCategory` / `movementPattern` / `tier` on the exercise are ignored.

## Locked

Facets (AND across rows, **OR within a row**; empty row = All). Chips are **multiple choice** — click to toggle; All clears that row.

| Facet | Chips |
| :--- | :--- |
| Lift | All, Squat, Bench, Deadlift, Other |
| Pattern | All + `MOVEMENT_PATTERNS` (catalog) |
| Tier | All, Comp, Variation, Accessory |

- Trigger: compact chip on the calendar/sessions toolbar (summary e.g. `All` or `Squat · Knee Dominant · Comp`). Click opens `CenteredDialog`. Same dialog on Sessions.
- Match **stored** `liftCategory` / `movementPattern` / `tier`, not title substrings.
- Empty session (no lifts) hidden unless every facet is All.
- **Do not** put bar / tempo / ROM / gear in this filter (those are lift-constructor, Add lift / Edit lift).
- **Do not** parse prescriptions. No new catalog. No backend filter API — client AND on the loaded plan.
- Persist optional: device-scoped `al_lift_filter` JSON is OK; athlete-scoped is wrong (same as theme vs Day prefs). Default all-All.
- Keep `data-testid` prefix `lift-filter`. Add `lift-filter-open`, facet chips `lift-filter-{facet}-{value}`.

## Files

- `src/components/LiftFilter.tsx` (dialog + summary chip)
- `src/components/CalendarView.tsx` / `src/components/SessionsView.tsx` (shared filter object)
- `src/App.tsx` if filter state lives there
- `e2e/calendar.spec.ts` and/or `e2e/session.spec.ts`

## States

all-All · one facet · three facets · no matches (empty month/list, not an error) · dialog open/cancel

## Acceptance

- [ ] Pill row All/Squat/Bench/Deadlift is gone.
- [ ] Dialog can show Knee Dominant benches and hide a Squat.
- [ ] Comp + Deadlift hides an accessory RDL if its tier is Variation.
- [ ] Sessions view uses the same facets.
- [ ] Cancel closes without applying; Confirm applies. (Or apply-on-chip — pick **apply on chip click, dialog has Done**. No second filter model.)

Apply-on-chip + Done to close is the lock (constructor feel; no extra Apply).

## Out of scope

Hover overlay (01). Add-lift search. Insights.
