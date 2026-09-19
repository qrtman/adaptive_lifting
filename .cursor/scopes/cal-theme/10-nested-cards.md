# Scope 10 — Nested cards

Load this whenever a slice nests a card in a card. **Overrides** `design.md` §0.2 and the old `AGENTS.md` ban. There is **no numeric max depth**.

## Why not “max 2”

That cap was leftover caution from the old optical-fatigue ban. It is **wrong** for this product:

- **Sessions** grouping is already three nouns: Block → Week → Session.
- **Calendar** can be day → session → lift lines (SQ 150×5@5) when a day holds a real session card, not a one-line chip.
- Cal.com’s own language is **product UI inside cards** — that is nesting by content, not a depth quota.

## Locked

Nest **along the product tree**. Each card is a real object (day, session, note, block, week, lift, insight). Do **not** add a wrapper card that does not name an object.

Overlays, popovers, and dialogs **may** nest real objects as cards (Name, Day/Block/Week, note body, ComboBox results). Dummy chrome wraps that do not name an object still fail.

Same object must not be wrapped twice (“card of a card of Session”).

Shadow: at most one faint drop per **leaf** card. Do not stack `shadow-2xl` down the tree. Inner cards: hairline or `surface-card`; outer: `rounded.lg`.

Still forbidden: decorative hero, gradient orbs, marketing filler, 96px empty bands, hiding sync/lock/conflict inside a nested shell.

## Trees (allowed)

**Calendar**

```
Day
  ├── Session
  │     └── Lift lines (optional inner cards or compact rows)
  └── Note
Hover overlay — not a card
```

**Sessions list**

```
Block
  └── Week
        └── Session
Unlabeled bucket is a group, not a fake Block card
```

**Session editor**

```
Lift
  └── PLAN/LOG table (set rows are cells, not cards)
Adj / constructors — dialogs
```

**Add lift dialog**

```
Dialog shell
  ├── Exercise (category, search, catalog list)
  └── Modifiers (bar / tempo / ROM / gear)
```

**Security**

```
Coach link
Devices
  └── Device
Browser sessions
  └── Session
Audit trail
  └── Event metadata (expanded)
```

**Dialogs (New / Edit / Notes)**

```
Dialog shell (elevates in)
  ├── Name
  ├── Date (if shown)
  ├── Day · Block · Week
  │     └── ComboBox results (elevated card)
  └── Note body
```

```
Insight card
  └── Config / chart body
```

## Fail these

- Session editor mounted *inside* a calendar session card (that is a route: open the session).
- Card around the whole month *and* around each week *and* around each day *and* a duplicate chrome wrap on the session (decorative extra shells).
- Using nesting to hide REJECTED / offline / lock.
