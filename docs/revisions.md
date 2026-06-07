# Revisions Required: Outdated ASCII Mockups in design.md

The ASCII mockups in `design.md` are outdated and contradict the newly introduced specifications in `docs/specs.md` and Section 5.5 of `design.md`. The following issues must be resolved:

## 1. Visual Hierarchy Inversion
- **Issue:** The calendar grid mockups (Section 6.1.2.1 and 6.1.2.2) show a layout where **Microcycle** acts as a row-level wrapper spanning across day columns, and **Mesocycle** is represented merely as a toolbar label.
- **Correction:** The mockups must reflect the corrected 5-tier nested hierarchy:
  ```
  [Calendar Day Cell]
  └── [Mesocycle Card (Block Layer)]
  └── [Microcycle Rows (Week Layer)]
  └── [Session Blocks (Day's Workout Container)]
  └── [Exercise Component]
  └── [Micro-Targets (Set Rows: Wt/Reps/RPE)]
  ```
  The Day Cell is the root visual container, and the Mesocycle Card and Microcycle Rows must nest inside it.

## 2. Monospace Layout Scaffolding
- **Issue:** The mockups use fixed-character box-drawing and spacing, implying a rigid monospaced column structure.
- **Correction:** Clarify or redesign the mockups to show fluid, container-query-based layout boundaries (`@container`) and note how spacing adapts dynamically when shifting to proportional sans-serif (`system-ui`).

## 3. Lack of Overflow/Truncation Visuals
- **Issue:** The mockups show ideal-length exercise names without demonstrating the required text safety constraints.
- **Correction:** Explicitly represent long titles (e.g. `> 40` characters) being clipped with an ellipsis (`...`) in the mockup to validate the `.title` CSS overflow rule.
