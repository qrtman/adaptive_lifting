# Scope 05 — Session screen header

Load this for “day 1 / Week 1 / Block 1 / 3787.5kg / Edit” competing. Day vs Name: `.cursor/rules/session-day-name.mdc`.

## Task

Name is the display title. Day, Week, Block, tonnage, Edit are secondary. Rearrange; do not encode Day in `title`.

## Diagnosis (do not re-litigate)

One flex row: Back, `session-name` (title), then Day/Week/Block all `text-sm font-semibold` next to `3787.5kg` and Edit. Day fights Name. If the session was saved as title `"day 1"`, Name and Day duplicate (03 stops new suggestions; do not migrate old titles here).

## Locked

```
[Back]   {Name}                                      [Coach] [Athlete] [Complete]
         Day n · Week n · Block n     3787.5 kg  [Edit]
```

- **Name** (`data-testid="session-name"`): `text-lg` Inter 600, `-tracking`, only large identity. Truncate. Never include `Day`.
- **Meta line** (`session-labels`): Day · Week · Block at `text-xs` / `text-[11px]` `text-[var(--cal-muted)]`, middots. Unlabeled Day omitted. `No block/week` only when week **and** block empty (Day absence is not that message).
- **Tonnage** (`workout-tonnage`): same meta line, `tnum`, muted, not a heading.
- **Edit**: ghost on the meta line (not beside Complete).
- **Complete**: black primary, top-right with Coach/Athlete.
- **Back**: muted, left of Name.
- 360px: Name wraps onto its own line; meta wraps under; Complete stays reachable.

## Files

- `src/App.tsx` session chrome only
- `e2e/calendar.spec.ts` (header Name ≠ Day)
- `design.md` session header bullet

## States

named + labeled · unlabeled Day · no week/block · long title · 360px

## Acceptance

- [ ] Name computed font-weight/size > Day/Week/Block.
- [ ] `session-name` text is `title`, not `Day 1`.
- [ ] Tonnage and Edit are not on the title line.
- [ ] Complete still finishes the session.

## Out of scope

Set grid (04). Calendar cards. Renaming historical `"day 1"` titles.
