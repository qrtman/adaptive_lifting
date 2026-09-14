# Design tokens

Ink-theme token set for Adaptive Lifting. Inventory is from code (not older docs). Tailwind v4 `@theme` is the delivery mechanism. Base unit is **4px**.

Doc/code discrepancy: `design.md` still describes a dual-pane roster console and 180px fatigue tracks. Code uses a 240px/60px sidebar, hash workspaces, and composable Insights cards. This file follows **code**.

---

## 1. Inventory

Source files: `Sidebar.tsx`, `AthleteScopeSelector.tsx`, `ui/Tabs.tsx`, `InsightsView.tsx`, `src/insights/*` (charts + CardBuilder), `CalendarView.tsx`, `SessionsView.tsx`, `ExerciseCard.tsx`, `PrescriptionEditor.tsx`, `index.css`.

| Value | Where used | Count (approx) | Token |
| :--- | :--- | ---: | :--- |
| `#AEAEB2` | Sidebar, scope, calendar, sessions, insights, exercise, prescription | 88 | `--color-fg-muted` |
| `#636366` | Scope labels, exercise headers, prescription seps, CardBuilder | 26 | `--color-fg-subtle` |
| `#007AFF` / `#007aff` | Nav icon, calendar ring, sessions, charts | 23 | `--color-accent` |
| `#E0E0E0` / `text-gray-200` | Body / AppShell | 2 | `--color-fg` |
| `#ffffff` / `text-white` | Active labels | many | `--color-fg-strong` |
| `#0A0A0A` / `--color-ink-950` `#0a0a0a` | Canvas | 6 | `--color-canvas` |
| `#131313` / `--color-ink-900` | Sidebar, calendar cells, CardBuilder | 8 | `--color-sidebar` / `--color-cell` |
| `#161616` / `--color-ink-800` | Cards, hover cells, glass-card | 8 | `--color-card` / `--color-cell-hover` |
| `#20201f` / `--color-ink-700` | Unused in listed surfaces | 1 | remove from listed files |
| `#1a1a1a` | Scope menu, CardBuilder inputs | 10 | `--color-inspector` |
| `#54e083` / `#34C759` | Bench / success | 7 | `--color-ok` |
| `#F5A623` | Deadlift / warn | 3 | `--color-warn` |
| `rgba(255,255,255,0.10)` | Borders | 3+ | `--color-border` |
| `rgba(255,255,255,0.05)` | Hover fill | 4 | `--color-border-subtle` |
| `text-[10px]` | Micro labels | 48 | `--text-micro` |
| `text-[11px]` | Mini / mono dates | 25 | `--text-mini` |
| `text-[12px]` / `text-xs` | Caption | 49 | `--text-caption` |
| `text-[13px]` | Sidebar nav | 1 | `--text-body` |
| `text-sm` (14px) | Titles | 7 | `--text-ui` |
| `text-lg` | Exercise title | 1 | `--text-title` |
| `h-6` (24px) | Compact controls | 18 | `--space-6` / `--control-h-sm` |
| `h-7` (28px) | Scope rows, chips | 20 | `--chip-height` / `--control-h` |
| `h-8` (32px) | Nav buttons, table rows | 22 | `--row-height` / `--control-h-lg` |
| `h-5` | Accessory header | 1 | `--space-5` |
| `px-1` / `px-1.5` / `px-2` / `px-3` | Horizontal padding | 66 | `--space-1` … `--space-3` |
| `py-1` / `py-1.5` / `py-2` | Vertical padding | 12 | `--space-1` … `--space-2` |
| `gap-0.5` / `gap-1` / `gap-2` / `gap-3` | Stacks | 49 | `--space-0.5` … `--space-3` |
| `min-h-[128px]` | Calendar day cell | 1 | `--day-cell-min-h` |
| `w-[240px]` / `w-[60px]` | Sidebar | 3 | `--sidebar-expanded` / `--sidebar-collapsed` |
| `w-56` | Scope popover | 1 | `--popover-w` |
| `rounded` (4px) | Buttons, inputs | many | `--radius-sm` |
| `rounded-lg` (8px) | Existing theme | theme | `--radius-md` |
| `border-white/10` | Default border | many | `--color-border` |
| `shadow-2xl` | Conflict card only (not listed) | 0 here | `--shadow-overlay` for inspector |
| `font-mono` | Dates, numbers | many | `--font-mono` + `tabular-nums` |
| `tracking-wider` / `uppercase` | Field labels | many | `--label` utility |
| `duration` 0.1s–0.35s in index.css | Numpad leftovers | 6 | `--ease-out` / `--dur-fast` — **remove** numpad classes from product surfaces |

Glass (`backdrop-filter`, `rgba(28,27,27,0.7)`) appears only in unused `.glass-sidebar` CSS. **Mark for removal** from product surfaces. Emerald-glow / massive-input-v2 / numpad classes are leftover kinetic UI — **remove** from theme consumption; do not use in calendar/grid.

---

## 2. Token set (Tailwind v4 `@theme`)

### 2.1 Spacing (4px base)

| Token | px | rem | Use |
| :--- | ---: | ---: | :--- |
| `--space-0` | 0 | 0 | reset |
| `--space-px` | 1 | — | hairline |
| `--space-0.5` | 2 | 0.125 | chip gap, sep |
| `--space-1` | 4 | 0.25 | cell pad-x tight |
| `--space-1.5` | 6 | 0.375 | chip pad-x |
| `--space-2` | 8 | 0.5 | default pad |
| `--space-3` | 12 | 0.75 | inspector section |
| `--space-4` | 16 | 1 | page gutter |
| `--space-5` | 20 | 1.25 | rare |
| `--space-6` | 24 | 1.5 | empty states |
| `--space-8` | 32 | 2 | reserved |

Tailwind numeric utilities (`p-2`, `h-8`) already map to this scale. After Phase 3, listed components use these names or the matching Tailwind step — never raw `px` except inside `@theme`.

### 2.2 Type

| Token | Size | Line | Weight | Use |
| :--- | ---: | ---: | ---: | :--- |
| `--text-micro` | 10px | 14px | 500 | uppercase field labels |
| `--text-mini` | 11px | 16px | 400 | dates, chip meta, pending |
| `--text-caption` | 12px | 16px | 400 | body secondary |
| `--text-body` | 13px | 18px | 400 | nav, inspector copy |
| `--text-ui` | 14px | 20px | 500 | section titles |
| `--text-title` | 18px | 28px | 500 | exercise header (grid group) |
| `--font-sans` | Inter / system | | | UI |
| `--font-mono` | JetBrains Mono | | | numeric cells; always `font-variant-numeric: tabular-nums` |

### 2.3 Surfaces and borders

| Token | Value | Use |
| :--- | :--- | :--- |
| `--color-canvas` | `#0A0A0A` | App shell |
| `--color-sidebar` | `#131313` | Left nav |
| `--color-card` | `#161616` | Insight cards, popovers |
| `--color-cell` | `#131313` | Day cell / grid cell idle |
| `--color-cell-hover` | `#161616` | Hover |
| `--color-cell-selected` | `#1a2330` | Selected (accent wash) |
| `--color-cell-editing` | `#0C0F0F` | Edit buffer |
| `--color-inspector` | `#1a1a1a` | Right inspector |
| `--color-border` | `rgba(255,255,255,0.10)` | Default |
| `--color-border-strong` | `rgba(255,255,255,0.25)` | Focus / selected |
| `--color-border-subtle` | `rgba(255,255,255,0.05)` | Nested |

### 2.4 Semantic states

| Token | Value | Meaning |
| :--- | :--- | :--- |
| `--color-prescribed` | `#AEAEB2` | Planned, not logged |
| `--color-logged` | `#E0E0E0` | Actual present |
| `--color-logged-over` | `#F5A623` | Actual load > planned |
| `--color-logged-under` | `#54e083` | Actual load < planned |
| `--color-missed` | `#636366` | Session status MISSED |
| `--color-locked` | `#F5A623` | Locked by other |
| `--color-syncing` | `#007AFF` | Queue pending |
| `--color-stale` | `#F5A623` | Cached / math mismatch |
| `--color-error` | `#ef4444` | Invalid cell / offline hard fail |
| `--color-ok` | `#34C759` | Completed / success |
| `--color-accent` | `#007AFF` | Selection, today, primary action |
| `--color-fg` | `#E0E0E0` | Default text |
| `--color-fg-muted` | `#AEAEB2` | Secondary |
| `--color-fg-subtle` | `#636366` | Labels |
| `--color-fg-strong` | `#FFFFFF` | Active |

### 2.5 Chip

| Token | Value |
| :--- | :--- |
| `--chip-height` | 28px (`h-7`) |
| `--chip-pad-x` | 6px |
| `--chip-max-w` | 100% of day cell |
| `--chip-radius` | 4px |
| Truncation | `truncate`; title else primary `movement_pattern` abbrev; overflow `+N` |

### 2.6 Grid

| Token | Value |
| :--- | :--- |
| `--row-height` | 32px |
| `--header-height` | 28px |
| `--col-exercise-min` | 160px |
| `--col-set-min` | 48px |
| `--col-num-min` | 64px |
| `--col-notes-min` | 120px |
| `--sticky-shadow` | `4px 0 8px rgba(0,0,0,0.4)` |

### 2.7 Layout

| Token | Value |
| :--- | :--- |
| `--sidebar-expanded` | 240px |
| `--sidebar-collapsed` | 60px |
| `--inspector-snap-a` | 360px |
| `--inspector-snap-b` | 560px |
| `--popover-w` | 224px (`w-56`) |
| `--day-cell-min-h` | 128px desktop; 72px week-strip |
| `--bp-week-strip` | 720px (7 day cells cannot show one chip legibly) |
| `--bp-inspector-overlay` | 960px |

### 2.8 Motion

| Token | Value | Reduced motion |
| :--- | :--- | :--- |
| `--dur-fast` | 80ms | 0 |
| `--dur-ui` | 120ms | 0 |
| `--dur-panel` | 180ms | 0 |
| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | n/a |

All transitions wrap in `@media (prefers-reduced-motion: reduce) { duration: 0 }`.

---

## 3. Mapping and churn

| Component | Pass | Files |
| :--- | :--- | :--- |
| `index.css` `@theme` | Add tokens; delete unused glass/numpad if unreferenced | 1 |
| `Sidebar.tsx` | Token-only | 1 |
| `AthleteScopeSelector.tsx` | Token-only | 1 |
| `ui/Tabs.tsx` | Default active/inactive classes → tokens | 1 |
| `InsightsView.tsx` + `CardBuilder` + charts | Stroke/fill from `--color-*`; no chart semantics change | ~8 |
| `AppShell.tsx` | Canvas + sync bar (shares sidebar width) | 1 |
| `MathStaleBanner.tsx` | Stale semantic | 1 |

**Churn estimate:** 14 files in Phase 3. CalendarView / SessionsView / ExerciseCard / PrescriptionEditor are **replaced in Phase 4**, not token-migrated in place.

**Remove:** duplicate hex `#007aff` vs `#007AFF`; glass utilities on product surfaces; numpad/stepper CSS if no remaining import (Telegram terminal may still reference — leave file-local, do not promote).
