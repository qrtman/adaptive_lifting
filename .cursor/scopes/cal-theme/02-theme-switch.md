# Scope 02 — Theme switch

Load this when adding the light/dark control. Depends on 01 tokens.

## Task

User-visible toggle. Persist. Apply before paint if possible (avoid white flash on dark).

## Locked

- Key: `al_theme` in `src/storage/uiPrefs.ts` (`UI_KEYS.theme`). Values `"light"` | `"dark"`. Default **`light`**.
- **Device-scoped**, same as sidebar collapse — **not** `al_recent_*` athlete suffix. Coach switching athletes must not change theme.
- Not IndexedDB. Not synced to backend this program.
- Control lives in **shell** (sidebar footer or header cluster) — not inside Calendar day cells.
- Copy: `Light` / `Dark` or sun/moon icon with `aria-label`. Not “Cal.com”.
- Both themes must keep offline / sync chip / lock banners visible (color change only).

## Files

- `src/storage/uiPrefs.ts` — `theme: 'al_theme'`
- `src/components/Sidebar.tsx` or `AppShell.tsx` — control
- `src/App.tsx` or `main.tsx` — read pref, set `document.documentElement.dataset.theme`
- Optional inline script in `index.html` reading `localStorage.al_theme` to set `data-theme` before React (FOUC)

## UI states

- light (default)
- dark
- missing pref → light
- garbage pref → light

## Acceptance

- [ ] Toggle updates `data-theme` and `localStorage` immediately.
- [ ] Reload restores last choice.
- [ ] Athlete switcher does not reset theme.
- [ ] 360px: control still reachable in collapsed/expanded sidebar.

## Out of scope

Restyling Calendar (03). System-preference matching.
