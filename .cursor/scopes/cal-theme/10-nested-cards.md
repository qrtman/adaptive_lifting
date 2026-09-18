# Scope 10 — Nested cards

Load this whenever a slice nests a card in a card. **Overrides** `design.md` §0.2 and `AGENTS.md` “Do not create nested cards”.

## Locked

- **Max depth 2:** Outer card (day, lift, week group, insight) → inner card (session chip, note, set-table is **not** a card per row).
- Inner card: `rounded.md` or `lg`, hairline or `surface-card`, **no extra drop shadow stack** (Cal: one faint shadow max).
- No card around a card around a card. ComboBox/popover/overlay is **not** a card level.
- Still forbidden: decorative hero, gradient orbs, generic SaaS marketing filler, 96px empty bands.

## Calendar application

```
Day cell (level 1)
  ├── Session chip (level 2)
  └── Note card (level 2)
Hover actions = overlay, not a card level
```

## Session editor application

```
Lift (level 1)
  └── PLAN/LOG table (not a card)
Adj dialog = overlay
```

## Do not

- Nest inspector inside session card inside day card.
- Use nested cards to hide sync/lock state.
