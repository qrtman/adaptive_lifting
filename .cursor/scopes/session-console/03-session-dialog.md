# Scope 03 — New / Edit session lists

Load this for Name suggesting Day values and ComboBox vs native select. Behavior: `.cursor/rules/session-day-name.mdc`.

## Task

One ComboBox chrome for Name, Day, Block, Week. Name options never include day slots. Lists are opaque and elevated so the Day field cannot show through the Name list.

## Diagnosis (do not re-litigate)

1. **Name vs Day leak.** Name `ComboBox` opens on focus with `z-20` `cal-nested-card`. In dark theme the list fill is close to canvas, so the Day control (`placeholder="Day 1…"`) in the slot row reads as a Name option. Historical titles `"day 1"` also pass `uniquePlanTitles`.
2. **Inconsistent controls.** Name + Day = ComboBox listbox. Block + Week = `LabelCombo` native `<select>`. Screenshot of mixed chrome.

## Locked

- Name, Day, Block, Week = **`ComboBox`**. Drop `LabelCombo` from New/Edit session (component may stay for other callers).
- `uniquePlanTitles`: still unique trimmed `workout.title`, exclude `""` / `"Session"`, **also exclude day-like titles** (`normalizeDayLabel(title)` is a bare number — `"day 1"`, `"D1"`, `"Day 1"`). Keep `"Squat"`, `"Meet"`, `"AM"`.
- Day options stay presets 1–7 ∪ labeled slots. Unchanged canonical `"1"`…`"7"`.
- Listbox: `bg-[var(--cal-surface-elevated)]` (opaque), `shadow-[var(--cal-shadow-lift)]`, `z-30` at least. No scale/translate enter (same as 01 — opacity optional).
- Layout unchanged: Name full width, then Day · Block · Week row. Black Create/Save.
- Prefills `al_recent_*` unchanged.

## Files

- `src/features/plan/sessionLabels.ts` (+ test) — `isDayLikeTitle` or fold into `uniquePlanTitles`
- `src/components/LabelCombo.tsx` (`uniquePlanTitles`)
- `src/components/ComboBox.tsx`
- `src/components/NewSessionDialog.tsx`, `src/components/EditSessionDialog.tsx`
- `e2e/calendar.spec.ts`

## States

empty Name · Name list open over slot row · Day pick · unlabeled Day · remember-last

## Acceptance

- [ ] Focusing Name never lists `Day 1` / `day 1` / `D1`.
- [ ] Block and Week use the same listbox as Name/Day (no native select in this dialog).
- [ ] Name list fully paints over the slot row (no Day placeholder ghost).
- [ ] Header still shows title ≠ Day.

## Out of scope

Calendar hover. Session screen header (05).
