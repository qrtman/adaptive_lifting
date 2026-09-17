# Installed skills (Phase 0)

Vendor copies live under `.cursor/skills/`. Ink tokens in `design/tokens.md` and this Google Calendar + Sheets parity brief win over any skill that asks for a new palette, display font, or signature decoration. FullCalendar, Handsontable, and AG Grid are **reference skills only** — do not add them as dependencies.

Preset for `ui-design-brain`: **Enterprise / data-dense**, not Modern SaaS spacious.

| Path | Use |
| :--- | :--- |
| `.cursor/skills/frontend-design/` | Distinctive UI craft. **Override:** keep existing ink, Inter / JetBrains Mono, and dark operational chrome. Do not invent a new palette or display font. |
| `.cursor/skills/web-design-guidelines/` | Vercel interface-guideline review (forms, hit targets, loading). Ignore Next.js-only rules. |
| `.cursor/skills/react-best-practices/` | React 19 composition and rerender hygiene. Ignore Next.js-only rules. |
| `.cursor/skills/ui-design-brain/` | Component patterns: combobox, popover, table. Enterprise / data-dense. See `components.md`. |
| `.cursor/skills/webapp-testing/` | Playwright against the local app: states, a11y, no flake from hidden chrome. |
| `.cursor/skills/apg-grid/` | W3C APG grid keyboard and `role="grid"` contracts. |
| `.cursor/skills/apg-combobox/` | W3C APG combobox: typeahead, Arrow/Enter/Esc, listbox popup. |
| `.cursor/skills/apg-dialog/` | W3C APG modal dialog: focus trap, Esc, labelled dialog. |
| `.cursor/skills/apg-datepicker/` | APG date-picker dialog example (calendar keyboard, not a new widget). |
| `.cursor/skills/fullcalendar/` | Month grid, event chips, overflow `+N more`, day click vs event click. Do not add the library. |
| `.cursor/skills/handsontable/` | Spreadsheet edit model: select vs edit, Esc/Enter/Tab, one editor. Do not add the library. |
| `.cursor/skills/ag-grid-a11y/` | Grid accessibility notes (aria, keyboard). **skill-seekers 403** on the public docs host; skill authored from the published accessibility page. Do not add the library. |

Skill Seekers used `--enhance-level 0 --preset quick` on public analogues only (not calendar.google.com or docs.google.com), then `skill-seekers install-agent … --agent cursor`.
