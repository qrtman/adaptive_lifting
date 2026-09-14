# Workspace parity audit (Phase 1)

Maps PR #8 calendar/inspector UI to Google Calendar + Google Sheets operator behavior. No code in this commit. Screenshots in the brief: centered mini “New session” modal defaulting to “Session”; inspector Notes as a starved strip; Pattern as always-open `<select>` while the set grid is in view.

| Google behavior | Current (screenshot/code) | Gap |
| :--- | :--- | :--- |
| Empty day is empty (date number only) | Persistent **“New session”** text on every in-month cell | `src/surface/calendar/DayCell.tsx:62-74` (`data-testid={`calendar-new-session-${day.iso}`}`). Must not render until hover/focus (and must never use `SessionChip`). |
| Hover + / note as ghost cell actions | Absent. Whole cell is the create path | `DayCell.tsx:51` `onClick={onActivate}`; `CalendarWorkspace.tsx:173-181` empty day → `setCreateIso`. Need 20–24px ghost `+` and note on `:hover` / `:focus-within` / focused day. Week-strip: `⋯` or long-press, not permanent “New session”. |
| Chip ≠ create control | Create is a text button (not a chip) but always visible; padding still creates | `DayCell.tsx:62-74` + `handleOpenDay` empty → create. Padding must **select** the day. Chip → inspector. `+` → create. `+N more` → day popover. |
| Quick-create anchored + large (inspector snap A) | Tiny **centered** modal (`max-w-lg` on a dimmed overlay) | `src/components/NewSessionDialog.tsx:69-73` wraps `CenteredDialog`; `src/components/CenteredDialog.tsx:29-41` `fixed inset-0` + `max-w-lg`. Replace calendar create with a day-anchored popover, `min-width: var(--inspector-snap-a)` (360px). Narrow: existing inspector overlay. After Create → inspector at snap B (560). |
| Title = Sheets name box (plan titles, typeahead, creatable) | Free-text `<input>` default `'Session'` | `NewSessionDialog.tsx:35` `useState('Session')`; `NewSessionDialog.tsx:113-120` `new-session-title`. Empty name must disable Create. |
| Block / Week same combobox family | Native `<select>` + “Add new…” + extra input | `src/components/LabelCombo.tsx:49-81`. Upgrade Name, Block, and Week to one APG combobox primitive. |
| One open editor in the grid; Pattern collapsed | Pattern `<select>` always open while sets are visible | `src/surface/grid/MovementPatternSelect.tsx:20-29`; mounted from `ExerciseHeaderRow.tsx:42-47`. Badge/disclosure; close on select / Esc / focus leave / set-cell edit. |
| Header chrome collapsed so Actual Load/Reps stay visible | `+ Set` / Up / Down / Remove / Edit always text, wrap | `ExerciseHeaderRow.tsx:48-70`. One header row; icon toolbar or `⋯`. |
| Comment from the day (Sheets) | Notes only a starved inspector `h-16` textarea | `SessionInspector.tsx:144-154`. 0 sessions → create with Notes focused; 1 → inspector Notes focus; N → day popover note per row. No day-notes entity. |
| Enter opens popover; `n` creates | Enter on empty day creates (`onOpenDay` → `setCreateIso`) | `MonthCalendar.tsx:91` `open` → `onOpenDay`; `CalendarWorkspace.tsx:173-181`. Enter → day popover. `n` / ghost `+` → create. |
| Day popover lists events; create is not a fake chip | Popover has a full-width “New session” text button (acceptable as an action, not a chip) | `DayPopover.tsx:42-48`. Keep create as a control, add per-row Note when N > 1. |

## Keep (already specified)

- Chip drag to another day reschedules (`MonthCalendar.tsx:98-115`).
- Keyboard: arrows, `t` today, `[` `]` month (`calendarKeyboard.ts`).
- Overflow `+N more` (`DayCell.tsx:87-99`).
- Set grid: click select, type/Enter edit, Esc cancel, one `state.editing` (`SetGrid.tsx` + `gridReducer.ts`).
- Create-while-offline stays disabled (product rule). No new create-mutation type.

## Hard bans (unchanged)

Do not restore `CalendarView` / `SessionsView` / `ExerciseCard` / `PrescriptionEditor`. Do not add FullCalendar, Handsontable, AG Grid, Glide, MUI, shadcn. Do not replace ink tokens.
