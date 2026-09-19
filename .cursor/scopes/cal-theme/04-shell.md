# Scope 04 — App shell (Phase A)

Load this when restyling chrome around routes. Depends on 01, 02.

## Task

Sidebar + app frame use Cal surfaces: white/soft-gray (light) or dark navy (dark). Nav looks like product nav, not a glass-blur gym HUD.

## Locked

- No `glass-sidebar` blur as the default (Cal is flat + hairline). Drop backdrop-filter on the primary nav.
- Active nav: ink text + subtle surface, or hairline — not thick `--ok-blue` tag as the only signal. Accent blue may mark focus.
- Athlete switcher stays in sidebar and still reloads Calendar/Sessions.
- Environment label, Settings, Integrations links stay.
- Theme toggle from 02 lives here.
- Brand word: `Adaptive Lifting` in Inter 600, not a decorative hero.

## Files

- `src/components/AppShell.tsx`
- `src/components/Sidebar.tsx`
- `src/App.tsx` (frame only)
- `e2e/navigation.spec.ts`

## Data

- `al_sidebar_collapsed` unchanged.
- `al_theme` from 02.

## States

expanded · collapsed · coach with/without athlete · offline (chip is 09, but shell must not hide it)

## Acceptance

- [ ] Both themes: sidebar contrast AA.
- [ ] Collapsed icon strip still 360px usable.
- [ ] Hash routes unchanged.

## Out of scope

Marketing top-nav 64px + Sign up CTA. Footer link columns.
