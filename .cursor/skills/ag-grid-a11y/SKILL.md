---
name: ag-grid-a11y
description: AG Grid accessibility patterns (ARIA grid/treegrid, keyboard, screen readers). Reference only — do not add AG Grid as a dependency.
---

# AG Grid accessibility (reference)

Scraped from https://www.ag-grid.com/javascript-data-grid/accessibility/ via WebFetch after skill-seekers received HTTP 403. Do not install `ag-grid` in this repo.

## Roles and attributes

- `role="grid"` for flat data; `role="treegrid"` only for grouped/tree data.
- `aria-rowcount` / `aria-colcount` on the grid.
- `role="row"` with `aria-rowindex`; `role="columnheader"` / `role="gridcell"` with `aria-colindex`.
- Selectable cells/rows: `aria-selected`. Editing: keep one editing cell; announce via live region.

## Keyboard

Motor-impaired and screen-reader users navigate without a mouse. Arrow keys move focus among cells. Custom navigation is allowed when it matches APG grid.

## Screen readers

Follow WCAG rather than JAWS/VoiceOver-specific hacks. Test announcements; do not assume one reader.

## DOM order

Keep DOM order matching visual order (`ensureDomOrder` analogue). Do not virtualize SetGrid (sessions stay under ~60 rows). Sticky group rows confuse row indices — avoid.

## Labels

Every focused cell needs an accessible name (`aria-label` or labelledby header). State changes on the focused cell may not be announced until focus moves — use a polite live region for commit/validation.
