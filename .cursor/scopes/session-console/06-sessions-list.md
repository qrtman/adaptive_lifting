# Scope 06 — Sessions list scan

Load this for the Sessions workspace cards. Grouping: `.cursor/scopes/cal-theme/07-sessions-list.md` + `10-nested-cards.md`. Day vs Name: `.cursor/rules/session-day-name.mdc`. Open-session identity: `05-session-header.md`.

## Task

Make the Sessions list scannable. Show **every set** as Plan vs Log. Lead with **Name**, not the ISO date. Do not repeat Block/Week inside a card that already sits under those headers.

## Diagnosis (do not re-litigate)

`SessionCard` prints ISO date as the title, raw `title` (“day 1”), then `blockLabel · weekLabel` (`1 · 1`) which duplicates the Block/Week nest. Lifts show **set 0 only**, Plan and Log jammed as `150×5@6 150×5@6` with no labels. Empty kg becomes `—×5@8`. Status is raw `COMPLETED · 0kg`. Select / Copy to / Edit sit on a full extra row.

## Locked

```
{Name}                                          {Done · 3788 kg}
Day n · YYYY-MM-DD                              [Select] [Copy to] [Edit]

#     Plan              Log
SQ Squat
1     150 × 5 @ 6       150 × 5 @ 6
2     140 × 5 @ 7       —
DL Deadlift
1     5 @ 8             —
```

- **Name** is the only large line on the card (`text-sm` / 600). Date is muted meta with **Day** (`formatPlanLabel`). Do not lead with ISO date.
- Do **not** print Block/Week inside the session card (the nest already names them). Ungrouped cards are Date + Day only.
- **Every set** of each visible lift (filter still applies). Not set 0 only.
- **Plan** and **Log** column headers. Compact triples: `150 × 5 @ 6`. Omit missing pieces (`5 @ 8`, not `—×5@8`). Empty cell `—`.
- Status: `Done` / `Live` / `Missed`. Omit `PLANNED`. Tonnage only if `> 0`. Never `COMPLETED · 0kg`.
- Keep `sessions-card-*`, `sessions-select-*`, `sessions-copy-to-*`, `sessions-edit-*`. Open control is `sessions-open-*` (first button in the card).
- Copy grains, Block → Week → Session nest, unlabeled bucket, lift filter — unchanged.
- 360px: Plan / Log stay labeled; triples `tnum`; no horizontal page scroll.
- Readout only. Do not persist strings. Do not invent kg.

## Files

- `src/features/plan/sessionSetReadout.ts` + test
- `src/components/SessionsView.tsx`
- `e2e/sessions-list.spec.ts`
- `design.md` Sessions workspace + §16.3
- `knowledge.md` Surfaces

## States

empty plan · filter empty · unlabeled · Block/Week nest · lift with many sets · plan-only set · completed with tonnage · 360px

## Acceptance

- [ ] Card title is session Name, not `2026-09-01`.
- [ ] Day formatted `Day n`; Block/Week not repeated inside grouped cards.
- [ ] Plan and Log headers visible; set 2 appears when logged/planned.
- [ ] No `—×` mash; no `COMPLETED · 0kg`.
- [ ] Copy to / Select / Edit still work.

## Out of scope

Calendar chips. Open-session PLAN/LOG editors. Copy D1 meaning. Migrating historical titles `"day 1"`.
