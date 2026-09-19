# Scope 09 — Sync overlay (Phase B or with A if chip is invisible on light)

Load this when the corner chip fails contrast. Rule: `.cursor/rules/sync-queue-overlay.mdc`.

## Task

Same **fixed corner** chip; Cal surfaces. Priority **offline > error > syncing > hidden**. Must not become an in-flow `h-7` banner.

## Files

- `src/components/SyncQueueOverlay.tsx`
- `src/services/syncOverlayState.ts`
- `e2e/sync-overlay.spec.ts`, `e2e/offline.spec.ts`

## Locked

- `position: fixed`. No layout shift.
- Light: dark-on-light or hairline card; Dark: on-dark. Error uses `--cal-error`.
- IndexedDB queue unchanged.

## Acceptance

- [ ] Chip readable both themes; y-position tests still pass.
