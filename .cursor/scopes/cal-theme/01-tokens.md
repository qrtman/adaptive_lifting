# Scope 01 — Tokens

Load this when adding or renaming CSS variables. Parent: `SCOPE.md`. Visual source: `design/sources/DESIGN-cal.md` YAML `colors`, `rounded`, `spacing`, `typography`, `components`.

## Task

Map Cal YAML → `--cal-*` CSS variables with **light and dark** values. Components consume variables, not raw `#131313` / `#AEAEB2` / `#007AFF`.

## Locked

- Light canvas `#ffffff`; ink `#111111`; hairline `#e5e7eb`; surface-card `#f5f5f5`; surface-soft `#f8f9fa`.
- Dark is an **inversion of the same roles**, not the old ink palette copied blindly: canvas near `#101010` / `#1a1a1a` elevated; ink `#ffffff`; muted `#a1a1aa`; hairline at low-alpha white. Prefer DESIGN-cal `surface-dark` / `on-dark` / `on-dark-soft`.
- Primary button fill = `colors.primary` (`#111`) in light; on-dark fill in dark (white/near-white button, dark label) **or** same black button if contrast holds — pick one in 01 implementation and use both themes.
- Accent `#3b82f6` / keep `#007AFF` as `--cal-accent` for focus, links, sync pulse **only**.
- Semantic: success / warning / error from DESIGN-cal YAML.
- SQ / BP / DL: **badge pastels** (orange / emerald / violet or existing hue mapped to pastels) — never neon glow. Same hue both themes, adjust lightness.
- Radius: buttons/inputs `8px` (`rounded.md`); cards `12px` (`rounded.lg`); pills `9999px`.
- Space used in app chrome: 4 / 8 / 12 / 16 / 24. **Do not** use `spacing.section` 96px in the PWA.
- No third theme. No per-athlete tokens.

## Files

- Edit: `src/index.css` (`@theme` + `[data-theme="light"]` / `[data-theme="dark"]`)
- Optional split: `src/theme/calTokens.css` imported from `index.css`
- Consumers later; this slice may add variables only and wire `body` background/text.

## Data

- No API. `al_theme` is 02.
- Do not store hex in LocalStorage.

## Acceptance

- [ ] Every new color is a `--cal-*` (or mapped `--color-*`) token.
- [ ] Toggling `data-theme` on `<html>` swaps canvas/ink without reload.
- [ ] Contrast: body text vs canvas passes WCAG AA in both themes.
- [ ] No marketing footer token required.

## Out of scope

Theme switch UI (02). Component restyle (03–09).
