# Scope 06 — Session editor (Phase B)

Load this when restyling the set table. Depends on 01, 02, 11. Keyboard: `.cursor/rules/sheets-cell-edit.mdc`. Plan kg: knowledge.md Plan kg paragraph.

## Task

PLAN/LOG grid on Cal surfaces. **Dense.** Do not apply marketing 16px body to every cell.

## Locked

- Lift block may be **one card** containing the table. Do not wrap each set row in a card (rows are cells).
- 6-col keyboard unchanged. `%` skip-chrome, set 0 has no `%` editor. `use {n}` scales by `%`. Adj header stays.
- Numbers: Inter tabular-nums (11). Cells stay compact (`h-6`/`h-8` class of control).
- Primary actions in this surface (Finish, Adj Apply): black. Grid focus ring: blue.
- Hardcoded `#007AFF` / `#AEAEB2` in `ExerciseCard` → tokens.

## Files

- `src/components/ExerciseCard.tsx`
- `src/components/PrescriptionEditor.tsx`
- `src/components/EditablePerformanceCell.tsx`
- `src/App.tsx` session header chrome
- `e2e/session.spec.ts`, `e2e/sheets-cell-edit.spec.ts`

## Data

No schema change. `dropPercent`, `plannedWeight`, logs, e1RM math untouched.

## States

loading · empty lift · locked/finished · offline save · `use {n}` offer · Adj popover

## Acceptance

- [ ] Light and dark: Plan vs Log readable; selected cell obvious.
- [ ] Tab wrap still plan.kg → … → log.rpe.
- [ ] `%` / `use {n}` / Adj e2e still pass.

## Out of scope

Telegram terminal. Quick Adjuster redesign beyond token colors.
