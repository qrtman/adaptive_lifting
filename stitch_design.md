# Iron Box Terminal (Kinetic Performance Design Tokens)

This document outlines the core structural design tokens used across the Obsidian Kinetic application. These tokens are natively aligned with Tailwind CSS v4 `@theme` variables located in `src/index.css`.

---

## 1. Structural Design Tokens (Tailwind `@theme` Mapping)

The application relies on a tailored "Obsidian & HSL" color system designed for deep OLED blacks and vibrant interactive feedback.

### Color Tokens (mapped in `src/index.css`)
* `--color-obsidian-950`: `#0a0a0a` (Deep pure black root background)
* `--color-obsidian-900`: `#131313` (Mid-tone coal for layered containers)
* `--color-obsidian-800`: `#161616` (Obsidian glass surfaces)
* `--color-obsidian-700`: `#20201f` (Muted wireframes and borders)
* `--color-mac-blue`: `#007AFF` (RTS Comp Blue / Interactive)
* `--color-mac-green`: `#34C759` (Supercompensation Green)
* `--color-jade-primary`: `#75ff9e` (Mobile Neon Accent for kinetic highlights)

### Typography Tokens
* `--font-sans`: `Inter, "Arial", -apple-system, sans-serif`
* `--font-mono`: `"JetBrains Mono", ui-monospace, SFMono-Regular, monospace`

### Radius / Shape Tokens
* `--radius-lg`: `0.5rem` (8px - Default milling)
* `--radius-xl`: `0.75rem` (12px)
* `--radius-2xl`: `1rem` (16px - Large cards)

---

## 2. Brand & Style Philosophy

The design system is engineered for high-performance strength training, focusing on clarity, intensity, and precision. It targets serious athletes and fitness enthusiasts who require a focused environment to track progress without distraction. 

The aesthetic is **High-Performance Minimalist**. It utilizes a pure black foundation to maximize contrast and reduce eye strain in low-light gym environments. The visual language evokes a sense of "digital equipment"—functional, durable, and precise. It avoids unnecessary decorative elements, favoring structural integrity and data-driven hierarchy to create a sense of professional-grade athletic software.

---

## 3. Colors & Tonal Layering

The palette is built on a "True Dark" philosophy. The primary background is pure black (`#0a0a0a`) to create an infinite depth effect on OLED screens, with secondary surfaces using dark charcoals to define hierarchy.

- **Primary (Obsidian Jade):** Used exclusively for interactive elements, progress indicators, and "success" states. It provides maximum vibrance against the dark background.
- **Surface Layers:** Surfaces use a tiered grayscale (`#131313`, `#161616`) to distinguish between the background and interactive cards.
- **Functional Grays:** Text and icons utilize varying opacities of white (High emphasis: 100%, Medium: 70%, Disabled: 38%) to maintain hierarchy without introducing new hues.

---

## 4. Typography Rules & Data Hierarchy

The design system utilizes **Inter** for its systematic, neutral, and highly legible qualities, structured around a strict visibility hierarchy:

- **Primary Data (Highest Visibility):** Weights, Reps, and RPE dictate the session outcome. These use large `font-mono` styles with high contrast and bold weights to ensure immediate glanceability from a distance (e.g. phone on the floor).
- **Secondary Data (Contextual):** Exercise names and target parameters frame the session. These use medium `font-sans` with standard contrast.
- **Tertiary Data (Metadata):** Tags, variations, and historical PRs are less critical mid-set. These use smaller `label-muted` styles, with reduced opacity and uppercase casing, positioned peripherally (e.g., top-right corners or footer pills) to minimize visual clutter.
- **Rhythm:** Line heights are kept tight for headlines to maintain a compact, "dense" feeling, while body text is given more breathing room for readability.

---

## 5. Layout & Kinetic Interactions

This design system uses a fluid grid optimized for one-handed thumb interaction in mobile views, mapped to tactile CSS utility classes in `index.css`.

- **Glassmorphism**: 
  - Sidebar: `.glass-sidebar` (`backdrop-filter: blur(30px)`)
  - Cards: `.glass-card`
- **Micro-Animations (Kinetic Fallbacks)**:
  - Stepper buttons: `.stepper-btn` scales down to `0.95` on active clicks to replicate haptic pressure.
  - Slide-up Drawer: Numpad overlays and sheets use `.numpad-sheet` with a `cubic-bezier(0.3, 1, 0.4, 1)` transition for heavy, organic momentum.
  - Emerald Glow: Input focus states trigger `.emerald-glow` for neon validation feedback.

---

## 6. Elevation & Depth

Depth in this design system is achieved through **Tonal Layering** and **Subtle Outlines** rather than heavy shadows.

- **Level 0 (Background):** Pure black (`bg-obsidian-950`).
- **Level 1 (Cards/Primary Surface):** Dark charcoal (`bg-obsidian-900`). These surfaces feature a 1px solid border to provide definition.
- **Level 2 (In-Card Elements/Inputs):** Obsidian glass (`bg-obsidian-800`).
- **Interactive State:** Elements use subtle outer glows (e.g. `box-shadow: 0 0 15px rgba(117, 255, 158, 0.2)`).