# Scope 04 — Set grid (headers, signs, Δ%, drop Adj)

Load this for the PLAN/LOG table. Keyboard: `.cursor/rules/sheets-cell-edit.mdc`. `%` / `use {n}`: set-prescription + knowledge.md.

## Task

Two header rows so kg/reps/RPE sit on the cells. Drop `×` `@` between editors. Δ is e1RM percent, to the **right of logged e1RM**. Remove header Adj (dialog included). `%` column stays.

## Diagnosis (do not re-litigate)

Plan kg/reps/RPE live in **one** `<td>`, so “kg × reps @” cannot align. Δ today is kg delta plus `r` RPE delta (`0.0r`), left of e1RM. Header Adj opens a dialog that fights the lift card; per-set `%` already rewrites later plan kg.

## Locked

### Table

```
#   %     Plan                    ·    Log                     e1RM   Δ%    INOL
              kg    reps   RPE              kg   reps   RPE
```

- Row 1: `#` and `%` empty or rowspan 2; **Plan** spans the three plan field columns; copy-arrow column empty; **Log** spans three log field columns; **e1RM Δ% INOL** on this row (or row 2 — lock: **metrics on row 1**, field names on row 2).
- Row 2: `kg` `reps` `RPE` under Plan, `kg` `reps` `RPE` under Log, aligned to the `<td>`s.
- Split Plan into **three `<td>`s** and Log into **three `<td>`s**. Logical keyboard `COLS` unchanged (6). `%` skip-chrome. Copy button skip-chrome.
- Remove `sep('×')` and `sep('@')` between **input** cells (PrescriptionEditor + log). Locked/readonly rows follow (no signs).
- RPE/% **toggle** stays on plan RPE (not a 7th Tab cell).

### Δ%

- Drop kg Δ and RPE Δ from the column.
- Value: `((log e1RM − plan e1RM) / plan e1RM) * 100`.
  - Plan e1RM = `calculateE1RM(plannedWeight, plannedReps, plannedRpe)` (same floor/order math).
  - Log e1RM = existing executed path.
- Missing plan or log e1RM → `—`. Display `tnum`, signed, 0 decimal (`+8%`, `-3%`, `0%`).
- Column **immediately right of logged e1RM**, then INOL. `data-testid="set-e1rm-delta-{id}"`.
- Row tint from RPE over/under may stay; it is not this column.

### Adj

- **Delete** header Adj button + Adj dialog from `ExerciseCard`.
- Do **not** add ± to the `%` column. Set 0 still has no `%`.
- `previewLiftAdj` / `applyLiftAdj` may remain in `setPrescription.ts` unused by UI this pass (do not invent a new entry point).
- Update `e2e/session.spec.ts` Adj cases → remove or retarget `%` only.

## Files

- `src/components/ExerciseCard.tsx`
- `src/components/PrescriptionEditor.tsx`
- `e2e/session.spec.ts`, `e2e/sheets-cell-edit.spec.ts`
- `design.md` set-table / Adj bullets

## States

empty sets · logged vs unlogged · `%` on set ≥1 · `use {n}` · locked/finished · no Adj control

## Acceptance

- [ ] kg/reps/RPE headers sit on those cells (Playwright bounding-box x, or two-row thead testids).
- [ ] No `×` / `@` between editors.
- [ ] Tab still plan.kg → plan.reps → plan.rpe → log.kg → log.reps → log.rpe.
- [ ] 150×5@6 logged vs matching plan → Δ% `0%` or `—` only if e1RM missing; RPE Δ gone.
- [ ] `lift-adj` testid count 0.
- [ ] `%` and `use {n}` still work.

## Out of scope

Session header (05). e1RM formula. Mobile quick adjuster.
