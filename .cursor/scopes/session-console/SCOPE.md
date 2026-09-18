# Session console — master scope map

Product program **after** Cal theme. Visual tokens stay `--cal-*`. This map is layout, filter, and constructor behavior — not a second palette.

**How to use this as an agent:** read `.cursor/rules/session-console.mdc`, this index, then **exactly one** child file. Do not reopen `.cursor/scopes/cal-theme/*` except 10-nested-cards / 11-typography when a slice nests a card or touches numbers.

---

## Why this map exists

Cal theme shipped hairline calendar, nested cards, and Inter `tnum`. The session console still has five product gaps the theme pass did not own: hover overlay feels flat and twitchy, All/SQ/BP/DL is a toy filter, New session Name/Day lists collide, the set grid headers do not sit on the cells, session identity is one undifferentiated row.

---

## Locked product decisions

Copied here so a child-only read still has them. Canonical lock: `.cursor/rules/session-console.mdc`.

1. **Hover overlay** — do **not** cover session/note cards. Actions sit in date-row empty space (may paint onto a neighbor, not down onto this day’s chips). **No blur, no scrim.** Session/note chips rest flat; the chip under the pointer uses `--cal-shadow-lift`.
2. **Lift filter** — constructor dialog, not the 4-pill. Multiple choice per facet (OR within a row, AND across lift category × pattern × tier). Trigger chip on Calendar and Sessions.
3. **Name ≠ Day** — Name suggestions never include day-slot strings. Name/Day/Block/Week are the same ComboBox. Opaque elevated list.
4. **Adj header is gone.** Per-set `%` stays. No ± steppers on `%`.
5. **Δ is e1RM %** of plan vs log, sitting **right of logged e1RM**. No kg Δ, no RPE Δ in that column.
6. **Plan / Log on the row above** kg · reps · RPE. Split those into real `<td>`s so headers line up. Drop `×` `@` between input cells.
7. **Session header hierarchy** — Name is the only large line. Day · Week · Block + tonnage + Edit are muted meta.

`design.md` calendar pill, Adj-in-header, and “Δ is RPE” lines are **wrong** for this program. Patch them in the implementation PRs.

---

## Phases

```
session-console
├── 01-calendar-hover   ← overlay elevation; no blur; no motion
├── 02-lift-filter      ← dialog facets (category × pattern × tier)
├── 03-session-dialog   ← ComboBox consistency; Name ≠ Day
├── 04-set-grid         ← two-row headers; no signs; e1RM Δ%; drop Adj
└── 05-session-header   ← Name vs Day/Week/Block/tonnage
```

Ship **01 → 03** (calendar + create) before **04 → 05** (open session). 02 may land with 01 (same chrome row).

---

## Child files (load one)

| ID | File | When to load | Depends on |
| :--- | :--- | :--- | :--- |
| 01 | `01-calendar-hover.md` | Day hover overlay motion/elevation | calendar-day-notes |
| 02 | `02-lift-filter.md` | All/SQ/BP/DL replacement | 01 optional |
| 03 | `03-session-dialog.md` | New/Edit session lists | session-day-name |
| 04 | `04-set-grid.md` | PLAN/LOG table chrome + Adj + Δ | sheets-cell-edit |
| 05 | `05-session-header.md` | Session screen identity row | session-day-name |

---

## Shared constraints (every slice)

- Cal tokens, nested-card rule, Inter `tnum` — do not invent a second theme.
- Hover must **not** grow the day cell.
- Day ≠ Name ≠ date.
- PLAN/LOG keyboard stays 6-col. `%` skip-chrome. `use {n}` stays.
- Copy dest D1 = earliest source **date**.
- No demo seed. Numeric training values stay numeric.
- Telegram Mini App / Sheets publish / math formula — out.

## Source artifacts

| Artifact | Role |
| :--- | :--- |
| `.cursor/rules/session-console.mdc` | Locks for this program |
| `.cursor/rules/calendar-day-notes.mdc` | Overlay is absolute; covering chips OK |
| `.cursor/rules/session-day-name.mdc` | Day vs Name |
| `.cursor/rules/sheets-cell-edit.mdc` | 6-col keyboard |
| `.cursor/scopes/cal-theme/10-nested-cards.md` | Overlay is **not** a card |
| `design.md` | Patch in impl PRs |

## Out of this program

Cal token YAML, theme toggle, Telegram terminal, Sheets, e1RM formula, adding Adj somewhere else, bar/tempo/ROM/gear as calendar filters.
