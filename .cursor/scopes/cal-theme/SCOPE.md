# Cal theme — master scope map

**Program 1 — closed.** Tokens, light/dark, nested cards, Inter `tnum`, Phase A+B chrome. Do not extend this map. Next product slices: `.cursor/scopes/session-console/SCOPE.md`.

Visual program: restyle Adaptive Lifting with Cal.com language (`design/sources/DESIGN-cal.md`) while keeping training behavior.

**How to use this as an agent:** read `.cursor/rules/cal-theme.mdc`, this index, then **exactly one** child file listed under the phase you are on. Child files already contain the files, tokens, states, and acceptance for that slice.

---

## Why this map exists

`DESIGN-cal.md` is a full marketing system. The app is a dense training console. Agents that load both plus `design.md` invent heroes, 96px gaps, or drop sync states. Each child scope is a **narrow work package** with the only context needed to ship that package.

---

## Locked product decisions

Copied here so a child-only read still has them. Canonical lock: `.cursor/rules/cal-theme.mdc`.

1. **A then B** — calendar/shell/dialogs first; then session + remaining surfaces. Shared token file from A so B does not invent a second palette.
2. **Light/dark toggle** — `al_theme`, device-scoped, default `light`.
3. **Black primary CTAs; blue focus/sync.**
4. **Inter + tabular-nums** for kg/reps/RPE (not JetBrains Mono). Inter 600 −tracking for month/session titles.
5. **Nested cards follow the product tree** — no depth quota. Block → Week → Session is valid. Do not add wrapper cards that are not objects. Overlays are not cards. See `10-nested-cards.md`.
6. **Density:** keep current calendar cell budget in A; Cal spacing tokens on chrome (8/12/16), not 96px sections.
7. **No marketing surface.**

`design.md` and `AGENTS.md` nested-card / dark-only / mono-required lines are **wrong** for this program. Patch them as you touch those sections; do not follow the old ban.

---

## Phases

```
cal-theme
├── 00 shared
│   ├── 01-tokens          ← CSS variables, mapping DESIGN-cal YAML → --cal-*
│   ├── 02-theme-switch    ← toggle UI + al_theme + html[data-theme]
│   ├── 10-nested-cards    ← depth rule, when to nest
│   └── 11-typography      ← Inter tabular-nums trial
├── Phase A (ship first)
│   ├── 03-calendar        ← CalendarView month grid, hover, notes, copy
│   ├── 04-shell           ← AppShell, Sidebar, athlete switcher
│   └── 05-dialogs         ← New/Edit session, Day notes, CenteredDialog
└── Phase B (after A)
    ├── 06-session-editor  ← ExerciseCard PLAN/LOG, Adj, %
    ├── 07-sessions-list   ← SessionsView grouping
    ├── 08-insights        ← Insights cards
    └── 09-sync-overlay    ← corner chip on light/dark
```

Do **not** start Phase B until Phase A e2e (calendar, copy, notes, login, navigation) is green **in both themes**.

---

## Child files (load one)

| ID | File | When to load | Depends on |
| :--- | :--- | :--- | :--- |
| 01 | `01-tokens.md` | Creating or changing CSS variables | DESIGN-cal YAML |
| 02 | `02-theme-switch.md` | Toggle, persist, FOUC | 01 |
| 03 | `03-calendar.md` | CalendarView visual + nested day cards | 01, 02, 10 |
| 04 | `04-shell.md` | Sidebar, header, nav-pill | 01, 02 |
| 05 | `05-dialogs.md` | CenteredDialog, session/notes dialogs | 01, 02 |
| 06 | `06-session-editor.md` | Set grid chrome | 01, 02, 11 |
| 07 | `07-sessions-list.md` | Sessions workspace | 01, 02, 10 |
| 08 | `08-insights.md` | Insights | 01, 02, 10 |
| 09 | `09-sync-overlay.md` | Sync chip contrast | 01, 02 |
| 10 | `10-nested-cards.md` | Any nested card | — |
| 11 | `11-typography.md` | Any numeric cell / title | — |

---

## Shared constraints (every slice)

- Athlete-owned plan; coach switcher still drives Calendar/Sessions.
- No demo seed. Numeric training values stay numeric.
- Sync/offline/lock/conflict/rejected stay visible (`.cursor/rules/sync-queue-overlay.mdc`).
- Calendar hover must **not** grow the day cell (`.cursor/rules/calendar-day-notes.mdc`).
- Day ≠ Name ≠ date (`.cursor/rules/session-day-name.mdc`).
- PLAN/LOG keyboard stays 6-col (`.cursor/rules/sheets-cell-edit.mdc`).
- Copy dest D1 = earliest source **date**, not `dayLabel`.
- Google Sheets one-way. Telegram Mini App not chat-primary. No landing page.

## Source artifacts

| Artifact | Role |
| :--- | :--- |
| `design/sources/DESIGN-cal.md` | Token YAML + component recipes (marketing — steal tokens/components, ignore page types) |
| `design.md` | Product surfaces & states — **visual bans in §0/§3/§4 overridden** by this program |
| `architecture.md` | Data/sync/RBAC — **not** overridden |
| `knowledge.md` | Compressed product — update when a phase ships |

## Implementation files (global)

Do not open all of these. Child scopes list the subset.

- Tokens: `src/index.css`, later `src/theme/calTokens.css` if split
- Pref: `src/storage/uiPrefs.ts` (`al_theme`)
- Root: `src/App.tsx`, `index.html` / `main` for `data-theme`
- Calendar: `src/components/CalendarView.tsx`
- Shell: `src/components/AppShell.tsx`, `src/components/Sidebar.tsx`
- Dialogs: `src/components/CenteredDialog.tsx`, `NewSessionDialog.tsx`, `EditSessionDialog.tsx`, `DayNoteDialog.tsx`
- Session: `src/components/ExerciseCard.tsx`, `PrescriptionEditor.tsx`, `EditablePerformanceCell.tsx`
- Sync: `src/components/SyncQueueOverlay.tsx`

## Out of this program

Readiness wave, microcycle flow connectors, per-day tVol/tINOL banners (`design.md` §6.1.2) — **separate product backlog**, not Cal theme.

## Verification (whole program)

- Light and dark: calendar, session editor, overlay chip, dialogs.
- 360px and 1440px.
- Existing e2e: `calendar`, `copy`, `session`, `sheets-cell-edit`, `offline`, `sync-overlay`.
