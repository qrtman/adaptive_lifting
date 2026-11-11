# Session sheet — implementation plan

Program **3**, after Cal theme (1) and session console (2). Visual tokens stay `--cal-*`.
Lock: `.cursor/rules/session-sheet.mdc`. Mockups (owner-approved, 2026-11-12): https://claude.ai/artifact/VwAaohDGQMG7argF9YTq6d. Use boards 7–8 ("v2"); boards 5–6 are "before".

## Problem

While writing one session, the coach cannot see the other days of the week. In Google Sheets they can. The session screen shows one day only, and each set is its own row, so a 4 × 6 bench is four identical lines.

## Goal (variant A)

Keep Calendar and the session screen. Add to the session screen:

- a **week rail**;
- a **sheet-style set table** (grouped Plan rows, one keyboard table for the whole session, inline lift actions);
- a calmer **visual hierarchy**.

Sessions view stays as is. A week board (variant B) is out of scope.

## Phases (one PR each, in order)

Each PR: tests for the new logic, the existing e2e that touch the surface, a staging check (`e2e/prod`), and doc updates in the same PR.

### 0 · Docs (this PR)
- This plan, `.cursor/rules/session-sheet.mdc`.
- Pointers in `session-console.mdc`, `SCOPE.md`, `design.md`, `knowledge.md`, `agent-file-map.mdc`.

### 1 · Week rail + session header
- **New `WeekRail`** beside the session (left column on desktop, a day strip on phone).
- **Data.** Built from microcycles already in `PeriodizationContext`: no new request.
- **Rows.** One row per day; one line per lift: name + scheme (`1×3 · 3×5`, `4×6 @8`); set count per day; day-note line when a note exists.
- **Interaction.** Click a day to open it. The active day is highlighted.
- **Range rule:**
  1. Sessions with the same Block + Week labels.
  2. An unlabeled session whose date is within a labeled week's span (first to last session date of that week) appears in that week, tagged `no Week`, with an `Assign to Week N` action. This is display only; never write the label automatically.
  3. If the date is in two spans, it goes to the week whose sessions are nearest.
  4. If it is in no span, the rail shows an `Assign a Week` hint.
- **Header:**
  - `Day N` is the large line; the optional Name is a small muted subtitle beside it.
  - Below: `date · Week · Block · N sets`, then the day note when present.
  - No session tonnage.
- **Tests.** Scheme formatter, range rule (all four cases), rail selection.

### 2 · Hierarchy pass on the existing set grid
- **Text levels:** typed values dark, 14px. Lift name semibold. Derived values (e1RM, Δ, INOL, NL, Volume, Int) grey, 12–13px. Set numbers and headers faintest, 11px.
- **Layout:** numbers right-aligned. Lifts separated by space; near-invisible lines inside a lift.
- **Ghost targets:** an empty Log cell shows its Plan target faintly. Plain Enter does not fill it. **Ctrl/Cmd+Enter** accepts it: it copies Plan into that set, using the existing `acceptSuggestions` key with the same meaning as `use {n}` in Plan.
- **Row tools** (`→`, duplicate, delete, `⋯`) only on the hovered or focused row.
- **Δ** grey within ±3%, accent beyond.
- **Set states:** the current set gets a row tint; logged sets get a faint check.
- **Keep** the `%` (dropPercent) and INOL columns. The mockups omit them.

### 3 · Grouped Plan rows
- **Display layer only.** Every set stays its own record: sync, log, revisions and server math are unchanged.
- **Grouping rule.** Consecutive plan sets merge into one row only when reps, intensity type and value (RPE or %), `dropPercent` **and kg** are all equal. Different kg is **never** merged.
- **Row label.** Count shown as `3 sets`, plus faint set numbers `2–4`. A single set shows only its number.
- **Editing a grouped row** writes every set in it. Changing `3 sets` → `4` appends a record at the end of the group.
- **Lowering the count below the logged count:** the set leaves Plan and its log stays as a log-only (`scope: 'log'`) row, "done beyond plan". Never delete a log.
- **Expand toggle** to edit sets one by one.
- **Both mode:** one Plan row faces its N Log rows (rowspan).
- **Risk.** Rows pair plan and log by position (see `ExerciseCardCopyToLog.test.tsx`). Grouping maps on top of that pairing, so it needs heavy tests in that style.

### 4 · One keyboard table for the whole session
- Arrows, Tab and Enter cross from the last row of a lift to the next lift. Focus moves to a session-level controller that lift cards register with.
- Update `design.md` §11.4 ("then the next set of the **same** lift").
- Pasting from Sheets across lifts is deferred until its rules are agreed.

### 5 · Inline lift actions
- **New lift row** at the bottom, "Type a lift name…", with catalog search (`exerciseCatalog`). Enter adds; Tab goes to Sets. `AddLiftBar` stays.
- **Variation chip** opens the existing `LiftVariationPicker` (Bar / Tempo / ROM / Gear). Never a fixed list.
- **`⋯` menu:** Duplicate, Swap lift…, Add note, Delete.
- **Drag a lift from the rail** to copy it with its Plan sets (no Log): `addSessionExercise` + `replaceExerciseSets`.
- **Online only** (as these APIs are today). Offline, these controls are disabled with visible copy, never hidden.

### 6 · Notes
- **Lift note:** under the lift's rows, full width, muted. It is not a side panel.
- **Set note:** a dot next to the set number opens a small editor. `ExerciseSet.note` exists and the log API sends it; add it to the Plan sync shape (`setSyncShape.ts`).
- **Day note:** in the session header, from `fetchDayNotes`. Shown only when a note exists.

### 7 · Summaries
- **Per lift:** NL · Volume · Int as columns in Plan; a `Plan … · Logged …` line in Both.
- **Session and rail day:** set count only. In Both, `Logged x / y sets`.
- **Never** session or day tonnage, NL, or average intensity. They mix different lifts, so they mean nothing.

## Out of scope

Week board (variant B), the Δ rethink (open; owner wants week-over-week compared), Russian translation (UI stays English), the phone logging screen, pasting across lifts.

## Estimates

Phases 1–2 take about 4–5 working days and deliver most of the value. All phases together take about 3 weeks.
