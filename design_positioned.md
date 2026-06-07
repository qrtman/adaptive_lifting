# Obsidian Kinetic - Design Positioning Draft

*This document is a reordered, placeholder‑annotated version of `design.md` for analysis of block relevance. Sections are ordered to reflect implementation priorities.*

---

## 1. Design System Tokens (Concrete)

### 1.1 Color Tokens (HSL)
```css
:root {
  /* Core App Grayscale (Obsidian Black Scheme) */
  --ok-bg: hsl(0, 0%, 4%);
  --ok-surface-1: hsl(0, 0%, 7%);
  --ok-surface-2: hsl(0, 0%, 9%);
  --ok-surface-3: hsl(0, 0%, 12%);
  --ok-border: hsl(0, 0%, 16%);

  /* Text Contrast System */
  --ok-text: hsl(240, 5%, 96%);
  --ok-text-muted: hsl(240, 5%, 67%);
  --ok-text-faint: hsl(240, 4%, 46%);

  /* Semantic Core */
  --ok-blue: hsl(217, 91%, 60%);
  --ok-green: hsl(142, 70%, 45%);
  --ok-amber: hsl(38, 92%, 50%);
  --ok-red: hsl(0, 84%, 60%);
  --ok-cyan: hsl(188, 86%, 53%);
  --ok-violet: hsl(263, 90%, 65%);
}
```

### 1.2 Typography & Font Tokens (Concrete)
```css
:root {
  --ok-font-primary: -apple-system, "SF Pro", "Inter", system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --ok-font-sans: var(--ok-font-primary);
  --ok-font-mono: var(--ok-font-sans);

  --ok-text-xs: 0.75rem;   /* 12 px */
  --ok-text-sm: 0.875rem;  /* 14 px */
  --ok-text-base: 1rem;    /* 16 px */
  --ok-text-lg: 1.125rem;  /* 18 px */
  --ok-text-xl: 1.25rem;   /* 20 px */
}
```

### 1.3 Shape, Spacing, Density (Concrete)
```css
:root {
  --ok-radius-sm: 6px;
  --ok-radius-md: 8px;
  --ok-radius-lg: 12px;
  --ok-space-1: 4px;
  --ok-space-2: 8px;
  --ok-space-3: 12px;
  --ok-space-4: 16px;
  --ok-space-6: 24px;
}
```

---

## 2. Component Contracts (Concrete)

> **Placeholder** – Component list extracted from `design.md` section 13. Each contract will be refined later.

- **AppShell** – Navigation, global status strip, responsive layout.
- **MonthGridView** – Calendar month view for coaches.
- **WeekGridView** – Weekly planner view.
- **SessionsView** – Athlete session list.
- **ExerciseCard** – Individual exercise display with state badges.
- **WorkoutLockBanner** – Shows lock/tombstone states.
- **ConflictReviewCard** – Shows conflict resolution UI.
- *(Additional components omitted for brevity – to be added as needed.)*

---

## 3. UI State Tokens & Semantic Status (Concrete)

| State        | Variable      | Visual Treatment |
| ------------ | ------------- | ---------------- |
| PENDING      | `--ok-amber`  | Amber text + 10% surface fill |
| IN_FLIGHT    | `--ok-blue`   | Blue border + pulse |
| ACKED        | `--ok-green`  | Green border, fade out |
| REJECTED     | `--ok-red`    | Red left‑border, alert button |
| CONFLICTED   | `--ok-amber`  | Amber border + red alert panel |
| LOCKED       | `--ok-text-faint` | Gray background, disabled |
| TOMBSTONED   | *(none)*      | Row collapses to 0 height |

---

## 4. Multilayering & Accessibility (Concrete)

- **Z‑Index Scale** – `--z-base` → `--z-tooltip` (not listed here, defined in implementation).
- **WCAG‑AAA** – All interactive elements provide icon + text; color‑only cues are supplementary.
- **Contrast** – Ensure text meets ≥7:1 against `--ok-bg`.

---

## 5. Detailed State / Sync Diagrams (Placeholder)

> **Placeholder** – High‑level description of sync queue, offline handling, lock/tombstone flow. To be turned into Mermaid diagrams later.

1. **Local Write** → `PENDING` (amber) → Queue.
2. **Sync Attempt** → `IN_FLIGHT` (blue) → Server.
3. **Success** → `ACKED` (green) → Remove from queue.
4. **Failure** → `REJECTED` (red) → Show inline retry.
5. **Conflict** → `CONFLICTED` (amber+red) → Open `ConflictReviewCard`.
6. **Lock** → `LOCKED` (faint) → Disable edits.
7. **Tombstone** → Row collapse, show audit log.

---

*End of draft.*
