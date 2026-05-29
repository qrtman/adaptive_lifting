# Obsidian Kinetic - Product Design System

> **Document Status:** Design Reference  
> **System:** Obsidian Kinetic Periodization Dashboard  
> **Companion Document:** `architecture.md`  
> **Design Scope:** React PWA, coach desktop dashboard, athlete mobile console, Telegram Mini App + bot entry points, Google Sheets publishing flow

---

## Table of Contents

0. [Implementation Directives](#0-implementation-directives)
1. [Design Intent](#1-design-intent)
2. [Product Surfaces](#2-product-surfaces)
3. [Visual System](#3-visual-system)
4. [Typography & Data Formatting](#4-typography--data-formatting)
5. [Layout System](#5-layout-system)
6. [Coach Desktop Experience](#6-coach-desktop-experience)
7. [Athlete Mobile PWA Experience](#7-athlete-mobile-pwa-experience)
8. [Telegram Mini App Experience](#8-telegram-mini-app-experience)
9. [Google Sheets Publishing Experience](#9-google-sheets-publishing-experience)
10. [State, Sync & Resilience UI](#10-state-sync--resilience-ui)
11. [Interaction Patterns](#11-interaction-patterns)
12. [Accessibility & Ergonomics](#12-accessibility--ergonomics)
13. [Component Inventory](#13-component-inventory)
14. [Motion & Feedback](#14-motion--feedback)
15. [Design Decisions](#15-design-decisions)
16. [Implementation Acceptance Checklist](#16-implementation-acceptance-checklist)

---

## 0. Implementation Directives

This section is intentionally prescriptive. When generating UI, follow these rules before making any local design choice.

### 0.1 Build Order

Implement screens in this order unless the user explicitly requests a different feature:

1. `AppShell` with navigation, global status strip, and responsive layout.
2. Athlete mobile active-session logging flow.
3. Coach workout calendar and structured workout builder.
4. Sync queue, conflict review, lock banners, and offline states.
5. Coach analytics dashboard.
6. Telegram Mini App integration settings and command/status panels.
7. Google Sheets publish settings and outbox status.
8. Audit/security/device/session views.

### 0.2 Hard Prohibitions

Do not build:

- A marketing landing page as the first screen.
- A decorative hero section.
- Nested cards inside cards.
- Gradient orb, bokeh, or abstract decorative backgrounds.
- Freeform text parsing for prescriptions, set logging, or Sheets import.
- Google Sheets bidirectional editing.
- Telegram chat commands as the primary mobile UI.
- UI that hides sync state, lock state, or rejected mutations.
- Charts or dashboards without empty/loading/error states.
- Any numeric training input stored or handled as a string.

### 0.3 Required Global UI

Every authenticated PWA screen must include:

- Current athlete or account context.
- Environment label when not production.
- Online/offline indicator.
- Sync queue count.
- Last successful sync timestamp when available.
- Re-auth/session-revoked handling.
- Clear route back to Settings and Integrations.

### 0.4 Default Assumptions

If implementation context is missing, assume:

| Decision | Default |
| :--- | :--- |
| Units | kg canonical, kg display unless user preference says otherwise |
| Theme | Dark only for initial release |
| Mobile first screen | Today's active workout |
| Coach first screen | Dashboard with athlete switcher |
| Integrations | Disconnected until explicitly linked |
| Offline state | Allowed for logging; publish/export requires network |
| Role conflict | Prefer least privilege and show read-only UI |

---

## 1. Design Intent

Obsidian Kinetic is work software for powerlifting coaches and athletes. It must feel fast, precise, and calm under fatigue. The interface prioritizes reliable logging, clean comparison, and immediate workload visibility over decorative presentation.

The design system follows three product principles:

1. **Training data first:** Weight, reps, RPE, e1RM, INOL, ACWR, status, and sync state must be more visible than chrome.
2. **Offline confidence:** Athletes must always know whether a set is saved locally, syncing, accepted, rejected, or conflicted.
3. **Architecture-visible UX:** Locks, tombstones, canonical backend math, Telegram adapters, Google Sheets publishing, and session revocation are visible through clear UI states rather than hidden system behavior.

---

## 2. Product Surfaces

| Surface | Primary User | Purpose | Design Constraint |
| :--- | :--- | :--- | :--- |
| Coach desktop PWA | Coach | Program design, athlete monitoring, analytics, exports, integrations | Dense, scannable, keyboard/mouse efficient |
| Athlete mobile PWA | Athlete | Offline-capable set logging in the gym | Thumb-first, high contrast, large numeric controls |
| Telegram Mini App + bot | Athlete / Coach | Telegram-native workout logging, summaries, guided fallbacks, alerts | Mini App reuses mobile logging patterns; bot text stays compact |
| Google Sheets publish flow | Coach | One-way reporting/export to Sheets | Must clearly communicate that Sheets is not canonical |
| Staging/admin runtime views | Operator / Coach-owner | Connection health, webhook/OAuth status, backup status | Quiet operational dashboard, not marketing UI |

---

## 3. Visual System

### 3.1 Color Tokens

The palette is dark, restrained, and functional. Avoid decorative gradients, blur-heavy panels, and one-note neon surfaces.

| Token | Hex | Usage |
| :--- | :--- | :--- |
| `--ok-bg` | `#0A0A0A` | App root background |
| `--ok-surface-1` | `#121212` | Page sections, sidebars |
| `--ok-surface-2` | `#181818` | Cards, tables, mobile set panels |
| `--ok-surface-3` | `#202020` | Inputs, selected rows, toolbar surfaces |
| `--ok-border` | `#2A2A2A` | Dividers, card borders, table grid lines |
| `--ok-text` | `#F4F4F5` | Primary text |
| `--ok-text-muted` | `#A1A1AA` | Secondary labels |
| `--ok-text-faint` | `#71717A` | Metadata and disabled text |
| `--ok-blue` | `#3B82F6` | Primary actions, links, selected navigation |
| `--ok-green` | `#22C55E` | Accepted sync, completed sets, optimal ACWR |
| `--ok-amber` | `#F59E0B` | Pending sync, warnings, productive overreach |
| `--ok-red` | `#EF4444` | Rejected sync, injury risk, auth/security danger |
| `--ok-cyan` | `#06B6D4` | Integrations and live telemetry |
| `--ok-violet` | `#8B5CF6` | DOTS and meet-planner accents |

### 3.2 Semantic Status Colors

| State | Color | UI Treatment |
| :--- | :--- | :--- |
| `PENDING` / queued | Amber | Small badge, clock icon, no alarm styling |
| `IN_FLIGHT` / syncing | Blue | Spinner or pulse dot, never blocking input |
| `ACKED` / accepted | Green | Check icon, temporary confirmation |
| `REJECTED` | Red | Inline error row with recovery action |
| `CONFLICTED` | Amber + red outline | Review required banner |
| `LOCKED` | Faint text + lock icon | Inputs disabled with reason |
| `TOMBSTONED` | Hidden from normal views | Shown only in conflict/audit review |

### 3.3 Shape, Spacing, and Density

| Token | Value | Usage |
| :--- | :--- | :--- |
| `--radius-sm` | `4px` | Inputs, badges, compact controls |
| `--radius-md` | `6px` | Buttons, table rows, mobile controls |
| `--radius-lg` | `8px` | Cards and panels |
| `--space-1` | `4px` | Icon gaps, dense labels |
| `--space-2` | `8px` | Table cell padding, compact stacks |
| `--space-3` | `12px` | Form groups |
| `--space-4` | `16px` | Default panel padding |
| `--space-6` | `24px` | Section spacing |

Cards use 8px radius or less. Page sections are not nested cards; they are full-width work areas with contained content.

---

## 4. Typography & Data Formatting

### 4.1 Font Stack

| Role | Stack | Usage |
| :--- | :--- | :--- |
| UI sans | `Inter`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `sans-serif` | Navigation, labels, headings |
| Data mono | `JetBrains Mono`, `ui-monospace`, `SFMono-Regular`, `monospace` | Weight, reps, RPE, e1RM, INOL, ACWR, timestamps |

### 4.2 Type Scale

| Token | Size / Line | Usage |
| :--- | :--- | :--- |
| `text-xs` | 12 / 16 | Badges, metadata, table helper text |
| `text-sm` | 14 / 20 | Default UI copy, table cells |
| `text-base` | 16 / 24 | Mobile form inputs |
| `text-lg` | 18 / 28 | Panel titles |
| `text-2xl` | 24 / 32 | Dashboard metric values |
| `text-4xl` | 36 / 40 | Mobile active weight/reps display |

Do not scale font size with viewport width. Use responsive layout changes, not fluid typography.

### 4.3 Numeric Formatting

| Value | Canonical Unit | Display |
| :--- | :--- | :--- |
| Weight | kg | `180 kg` or `397 lb`; unit visible |
| RPE | unitless | `8`, `8.5`, not `8.0` unless needed |
| e1RM | kg | Rounded at render/export only |
| INOL | unitless | 2 decimals |
| ACWR | ratio | 2 decimals + risk label |
| DOTS | coefficient | 1 decimal |
| Velocity | m/s | 2 decimals |

All tables that can show different units must include units in column headers.

---

## 5. Layout System

### 5.1 Responsive Breakpoints

| Breakpoint | Layout |
| :--- | :--- |
| `< 480px` | Athlete mobile console, single-column, bottom action rail |
| `480-767px` | Wide mobile / small tablet, persistent exercise tabs |
| `768-1199px` | Tablet coach review, condensed sidebar |
| `>= 1200px` | Full coach desktop dashboard |

### 5.1.1 Responsive Layout Rules

| Rule | Requirement |
| :--- | :--- |
| Mobile width | No horizontal scrolling except inside intentionally scrollable data tables. |
| Desktop work area | Main content uses `minmax(0, 1fr)` so tables/charts do not force overflow. |
| Sidebars | Desktop sidebar width is 240px; collapsed tablet sidebar is 64px. |
| Bottom rail | Mobile primary actions use fixed bottom rail with safe-area padding. |
| Tables | Desktop tables can scroll vertically inside their region; headers remain sticky. |
| Charts | Charts must have fixed-height containers and empty states before data loads. |
| Touch controls | Mobile inputs and buttons must not shift layout when values change. |

### 5.2 Navigation Model

| Area | Coach | Athlete |
| :--- | :--- | :--- |
| Primary nav | Dashboard, Calendar, Athletes, Analytics, Exports, Integrations, Settings | Today, History, Metrics, Settings |
| Session nav | Microcycle timeline + workout list | Exercise tabs + active set focus |
| Persistent status | Sync, live telemetry, lock holder, deployment env | Offline/sync queue, current workout status |

### 5.3 Route Map

Use these routes unless implementation context requires a framework-specific equivalent:

| Route | Surface | Notes |
| :--- | :--- | :--- |
| `/` | Role-aware redirect | Coach -> `/dashboard`; athlete -> `/today` |
| `/dashboard` | Coach dashboard | KPI strip, alerts, live status |
| `/calendar` | Coach calendar | Microcycle-aware workout planning |
| `/workouts/:id` | Shared workout detail | Coach edits prescriptions; athlete logs execution |
| `/athletes/:id` | Coach athlete detail | Trends, compliance, readiness, recent logs |
| `/analytics` | Analytics | e1RM, INOL, ACWR, DOTS |
| `/exports` | Exports | CSV/JSON and Sheets publish entry |
| `/integrations` | Integrations | Telegram, Google Sheets, health sources |
| `/settings` | Account/settings | Sessions, units, devices, security |
| `/today` | Athlete active workout | Mobile-first logging |

---

## 6. Coach Desktop Experience

The desktop experience is an operational console, not a landing page. It should support repeated use, comparison, and rapid edits.

### 6.1 Dashboard Layout

```
+--------------------------------------------------------------------------------+
| Top Bar: Athlete Switcher | Active Mesocycle | Sync/Live | Integrations | User |
+------------------+-------------------------------------------------------------+
| Sidebar          | KPI Strip: Squat e1RM | Bench e1RM | Deadlift e1RM | ACWR |
| Dashboard        |-------------------------------------------------------------|
| Calendar         | Work Area: Calendar / Analytics / Athlete Detail           |
| Athletes         |                                                             |
| Analytics        | Right Rail: Locks, conflicts, outbox, recent alerts         |
| Exports          |                                                             |
| Integrations     |                                                             |
+------------------+-------------------------------------------------------------+
```

### 6.2 Key Desktop Views

| View | Required UI |
| :--- | :--- |
| Dashboard | KPI strip, ACWR risk zones, INOL by lift, recent PR/e1RM changes, live athlete alerts |
| Calendar | Microcycle boundary visualization, drag-and-drop within week only, rejected cross-week feedback |
| Workout Builder | Structured prescription editor, LexoRank-based reorder handles, previewed tonnage/fatigue |
| Athlete Detail | Readiness, bodyweight, HRV, compliance, recent logs |
| Analytics | e1RM trend, tonnage, INOL, ACWR, DOTS, export filters |
| Integrations | Telegram connection, Google Sheets OAuth, publish profiles, outbox status |
| Audit/Conflicts | Rejected mutations, tombstone conflicts, session/device history |

### 6.3 Calendar and Builder Rules

- Drag handles are visible icons, not text buttons.
- Cross-microcycle drag attempts snap back and show `MICROCYCLE_BOUNDARY_VIOLATION`.
- `LOCKED` workouts show a lock icon, holder, and expiry when available.
- Completed workouts are readable but not editable until reopened.
- Deleted/tombstoned items disappear from normal views but can appear in conflict review.

### 6.4 Desktop Table Rules

| Table | Required Columns |
| :--- | :--- |
| Workout sets | Exercise, Set, Planned, Actual, Reps, RPE, e1RM, INOL, Status |
| Athlete list | Athlete, Active mesocycle, Last session, Sync status, ACWR, Alerts |
| Outbox | Provider, Job, Status, Attempts, Next retry, Last error, Action |
| Audit events | Time, Actor, Event, Resource, Result, Details |
| Sheets publications | Profile, Spreadsheet, Last published, Schedule, Status, Action |

Tables must use sticky headers, row hover, compact density, and a visible empty state. Destructive actions belong in row menus with confirmation.

### 6.5 Structured Prescription Editor

The editor must render controls from the prescription mode:

| Mode | Required Controls |
| :--- | :--- |
| `RPE_TARGET` | sets, reps, target RPE |
| `PERCENTAGE` | sets, reps, percentage, source max |
| `AMRAP` | sets, percentage/load, cap RPE, optional rep cap |
| `TOP_SET_BACKDOWN` | top-set reps/RPE, backdown sets/reps, fatigue drop percent |
| `HYBRID` | ordered sections, each using one of the supported modes |

Show the generated display string as a readonly preview. Do not make the preview the source of truth.

---

## 7. Athlete Mobile PWA Experience

The standalone mobile PWA is the most capable logging surface because it owns the full offline IndexedDB experience. The Telegram Mini App is a Telegram-native companion that should reuse the same logging UI patterns when launched from Telegram.

### 7.1 Active Session Layout

```
+--------------------------------------+
| Today | Workout Status | Sync Badge   |
| Squat 3x3 @ RPE 8                    |
+--------------------------------------+
| Exercise Tabs: Squat | Bench | Row    |
+--------------------------------------+
| Active Set Panel                     |
| 180 kg                               |
| 3 reps   RPE 8                       |
| e1RM 205 kg | INOL 0.42              |
| [ - ] [ + ] controls                 |
| [ Log Set ]                          |
+--------------------------------------+
| Set History                          |
| ✓ 170 x 3 @ 7.5    accepted          |
| ~ 180 x 3 @ 8      syncing           |
+--------------------------------------+
| Bottom Rail: Previous | Notes | Done  |
+--------------------------------------+
```

### 7.2 Mobile Interaction Rules

- Numeric entry uses large steppers and numeric keypad controls.
- Reps are integer-only.
- RPE increments by 0.5.
- Weight increments follow configured plate jumps, defaulting to 2.5 kg.
- The first unlogged set auto-focuses after hydration completes.
- Logging remains available offline; sync state is shown per set row.
- Advanced fields (velocity, readiness, HRV) are collapsed behind a disclosure control.

### 7.3 Mobile Offline and Hydration States

| State | UI |
| :--- | :--- |
| Booting offline | Shell loads with cached workout snapshot and offline banner |
| Hydrating | Skeleton rows plus "Loading latest saved workout" |
| Pending mutations | Queue badge with count; rows show amber pending icon |
| Sync success | Green check fades after acknowledgement |
| Sync conflict | Inline red/amber review card with "Use server value" / "Keep local as new edit" when permitted |
| Session revoked | Full-screen re-auth prompt; local unsynced mutations preserved |

### 7.4 Exact Mobile Control Specs

| Control | Spec |
| :--- | :--- |
| Active weight display | `text-4xl`, mono, minimum height fixed to prevent layout shift |
| Weight stepper | `-2.5 kg` and `+2.5 kg` default; allow configured increment |
| Reps stepper | `-1` and `+1`; minimum `0`; no decimals |
| RPE stepper | `-0.5` and `+0.5`; clamp `1-10` |
| Log button | Full-width, 48px high minimum, disabled only for invalid/locked state |
| Exercise tabs | Horizontal scroll with active tab fixed-width enough for longest lift label |
| Notes | Bottom sheet; save as explicit action, not auto-submit while typing |
| Done action | Requires confirmation if pending mutations exist |

### 7.5 Mobile Copy

Use short labels:

| Context | Copy |
| :--- | :--- |
| Pending local save | `Saved offline` |
| Syncing | `Syncing` |
| Accepted | `Accepted` |
| Rejected | `Needs review` |
| Locked | `Locked` |
| No workout today | `Rest day` |
| Complete workout | `Finish session` |

---

## 8. Telegram Mini App Experience

Telegram is a **Telegram Mini App launched from the bot**. The Mini App may reuse the mobile logging UI, while bot messages provide launch links, reminders, alerts, and compact command fallbacks. Telegram must not become a separate source of truth.

### 8.1 Mini App Rules

- The first Telegram Mini App screen is today's active workout or a clear rest-day state.
- Verify/link state must be visible before showing training data.
- If the user is not linked, show one primary action: `Connect account`.
- If Telegram WebView storage is unavailable or unreliable, show `Online only in Telegram. Use the PWA for full offline logging.`
- Use the same set logging controls, lock banners, sync states, and conflict UI as the mobile PWA where possible.
- Do not expose full coach programming tools inside Telegram unless explicitly scoped later.

### 8.2 Bot Voice

- Short, direct, numeric.
- No motivational copy.
- Always show enough context to prevent logging against the wrong workout.
- Never expose coach-only data to athletes.

### 8.3 Command Messages

| Command | Response Design |
| :--- | :--- |
| `/today` | Workout title, exercises, next active set, sync status, Mini App launch button |
| `/log` | Opens Mini App focused on active set; fallback is guided prompt sequence: exercise -> set -> weight -> reps -> RPE -> confirmation |
| `/done` | Confirms completion or explains why the workout cannot be completed |
| `/status` | Coach-only athlete completion summary |

### 8.4 Telegram Error Copy

| Condition | Message Pattern |
| :--- | :--- |
| No linked account | "This Telegram account is not linked. Open the Mini App to connect." |
| Mini App auth failed | "Telegram verification failed. Close and reopen the Mini App." |
| Locked workout | "This workout is locked by {name}. Logging is paused." |
| Tombstoned set | "That set was removed by your coach. Open the app to refresh." |
| Ambiguous input | "Use numbers only: weight, reps, RPE." |
| Offline backend/provider retry | "Received. I will confirm after the server accepts it." |

---

## 9. Google Sheets Publishing Experience

Sheets publishing is coach-facing and one-way. The UI must make that explicit.

### 9.1 Integration Setup

1. Coach opens Integrations -> Google Sheets.
2. UI explains: "Publish reports to Sheets. Sheet edits do not update training data."
3. Coach connects Google account via OAuth.
4. Coach selects create-new spreadsheet or existing publication target.
5. Coach chooses export profile and publish schedule.

### 9.2 Publish Profile UI

| Control | Component |
| :--- | :--- |
| Athletes | Searchable multi-select |
| Date range | Segmented control: Active mesocycle, last 28 days, custom |
| Tabs | Checkbox group: Sets, Workouts, INOL, ACWR, e1RM |
| Schedule | Menu: Manual only, daily, weekly |
| Units | Segmented control: kg, lb |

### 9.3 Publish Status

| State | UI |
| :--- | :--- |
| Not connected | Connect Google button |
| Connected | Account label, scopes, revoke button |
| Publishing | Progress row in integration outbox |
| Published | Timestamp, spreadsheet link, row count |
| Failed | Error detail, retry action, audit link |
| Revoked | Disabled schedule with reconnect action |

---

## 10. State, Sync & Resilience UI

### 10.1 Global Status Strip

All authenticated app surfaces include compact status:

| Indicator | Meaning |
| :--- | :--- |
| Offline | Browser has no network; local logging available |
| Sync queue `n` | Pending IndexedDB mutations |
| Live | SSE connected for coach telemetry |
| Locked | Current workout has an active writer lock |
| Staging | Environment label when not production |

### 10.2 Conflict Review

Conflict cards must show:

- Entity type and exercise/set context.
- Local value, server value, and timestamps.
- Rejection reason, such as `WORKOUT_LOCKED`, `TOMBSTONE_CONFLICT`, or `CLIENT_CLOCK_SKEW`.
- Allowed recovery action based on RBAC.

### 10.3 Empty, Error, and Loading States

| State | UX Rule |
| :--- | :--- |
| Empty athlete list | Show create/invite coach workflow |
| Empty workout day | Coach can create workout; athlete sees rest day |
| API error | Use stable error envelope code in copy/debug details |
| Provider error | Do not block core app; show integration-specific retry |
| Migration required | Block app start with operator-facing message |

### 10.4 Error Copy Patterns

| Error Code | User-Facing Copy | Action |
| :--- | :--- | :--- |
| `MICROCYCLE_BOUNDARY_VIOLATION` | `Workout must stay inside this microcycle.` | Move within week |
| `WORKOUT_LOCKED` | `This workout is locked right now.` | Show holder/reopen/release if allowed |
| `TOMBSTONE_CONFLICT` | `This item was removed elsewhere.` | Refresh or review conflict |
| `CLIENT_CLOCK_SKEW` | `Device time looks wrong.` | Prompt user to fix device clock |
| `CLIENT_SCHEMA_UNSUPPORTED` | `App update required.` | Refresh/update app |
| `AUTH_SESSION_REVOKED` | `Session ended. Sign in again.` | Re-authenticate |
| Provider OAuth failure | `Connection failed.` | Retry connect |
| Sheets publish failure | `Publish failed.` | Retry or open details |

Do not expose raw stack traces. Put technical request IDs and backend error codes in expandable details.

---

## 11. Interaction Patterns

- Use icon buttons for common actions: save, export, reconnect, lock, unlock, retry, publish, delete.
- Use tooltips for icon-only controls on desktop.
- Use bottom sheets on mobile for numeric input, notes, and advanced fields.
- Use menus for option sets and segmented controls for mode switches.
- Use toggles only for persistent binary settings.
- Use checkboxes for export tab selection and publish profile fields.
- Avoid modal stacks. A modal may open a sheet, but a modal must not open another modal.

---

## 12. Accessibility & Ergonomics

| Area | Requirement |
| :--- | :--- |
| Contrast | WCAG AA minimum for all text; numeric logging controls target AAA where possible |
| Touch targets | Minimum 44x44 px on mobile |
| Keyboard | Desktop tables and builder controls support keyboard navigation |
| Focus | Visible focus ring using `--ok-blue`; never remove outline without replacement |
| Reduced motion | Respect `prefers-reduced-motion`; disable slide/scale animations |
| Color dependency | Risk zones use label + icon + color, never color alone |
| Error recovery | Every blocking error provides the next valid action |

---

## 13. Component Inventory

| Component | Purpose |
| :--- | :--- |
| `AppShell` | Authenticated layout, nav, global status strip |
| `MetricCard` | e1RM, INOL, ACWR, DOTS, tonnage summaries |
| `RiskBadge` | ACWR/INOL/status labels with icons |
| `WorkoutCalendar` | Microcycle-aware scheduling and drag constraints |
| `WorkoutLockBanner` | Shows lock holder, expiry, reopen/release actions |
| `PrescriptionEditor` | Structured prescription JSON editor with safe display strings |
| `ExerciseReorderList` | LexoRank reorder surface |
| `SetLogPanel` | Mobile active set logging |
| `SyncQueueBadge` | Pending/in-flight/failed mutation indicator |
| `ConflictReviewCard` | Mutation rejection and recovery |
| `TelegramLinkPanel` | Mini App/bot connection and link-token flow |
| `SheetsPublishPanel` | Google OAuth, profiles, publish status |
| `OutboxTable` | Integration retries and provider failures |
| `AuditEventTable` | Security/export/conflict event review |

### 13.1 Component Contracts

Each component must satisfy the contract below before being considered complete.

| Component | Required Props/Data | Required States | Required Actions |
| :--- | :--- | :--- | :--- |
| `AppShell` | `user`, `role`, `environment`, `syncStatus`, `route` | loading, authenticated, session revoked, offline | navigate, logout, open settings |
| `MetricCard` | `label`, `value`, `unit`, `delta`, `riskState` | loading, empty, normal, warning, critical | open detail when clickable |
| `RiskBadge` | `state`, `label`, `icon`, `description` | neutral, success, warning, danger | tooltip on desktop |
| `WorkoutCalendar` | `microcycles`, `workouts`, `locks`, `activeAthlete` | loading, empty, dragging, rejected, locked | create workout, move within boundary |
| `WorkoutLockBanner` | `holder`, `expiresAt`, `mode`, `canRelease`, `canReopen` | locked by me, locked by other, expired, completed | release, reopen |
| `PrescriptionEditor` | structured prescription JSON, exercise metadata | draft, valid, invalid, readonly | edit mode, validate, save |
| `ExerciseReorderList` | ordered entities with `lexo_rank` | normal, dragging, syncing, conflict | reorder, undo local reorder |
| `SetLogPanel` | active set, previous sets, unit preference, sync state | hydrated, offline, pending, accepted, rejected, locked | log set, edit allowed fields, add note |
| `SyncQueueBadge` | queue counts by state | empty, pending, syncing, failed | open queue detail, retry failed |
| `ConflictReviewCard` | local value, server value, reason, permissions | reviewable, readonly, resolved | accept server, keep local as new mutation if allowed |
| `TelegramLinkPanel` | connection status, username/chat label, Mini App launch URL | disconnected, linking, verifying, connected, failed, revoked | generate token, launch Mini App, disconnect, test message |
| `SheetsPublishPanel` | OAuth state, profiles, selected spreadsheet | disconnected, connected, publishing, failed, revoked | connect, publish, retry, revoke |
| `OutboxTable` | provider jobs, attempts, next retry | empty, queued, retrying, failed, complete | retry, cancel when safe, inspect error |
| `AuditEventTable` | events, filters, pagination cursor | loading, empty, populated, error | filter, paginate, open event detail |

### 13.2 Naming and Copy Rules

- Use domain terms exactly as defined in `architecture.md`: `e1RM`, `INOL`, `ACWR`, `DOTS`, `microcycle`, `mesocycle`, `RPE`.
- Use `workout` for scheduled training sessions, not "class", "event", or "task".
- Use `set` for execution rows, not "entry" unless referring to audit events.
- Use `publish` for Google Sheets, not "sync", because Sheets is not canonical.
- Use `connect` / `disconnect` for integrations, not "install".
- Show backend error codes only in expandable details or compact technical labels; user-facing copy should explain the fix.

### 13.3 Required Icons

Use lucide icons or the existing local icon library if available.

| Action/State | Icon Intent |
| :--- | :--- |
| Syncing | rotating refresh |
| Accepted | check |
| Rejected | alert triangle or circle x |
| Locked | lock |
| Reopen | unlock |
| Export/publish | upload/share |
| Google Sheets | table/spreadsheet icon; do not use unofficial Google logo unless licensed |
| Telegram | message/send icon; do not use unofficial Telegram logo unless licensed |
| Offline | wifi off |
| Live telemetry | activity/pulse |

---

## 14. Motion & Feedback

Motion is functional and brief.

| Interaction | Motion |
| :--- | :--- |
| Button press | 80ms scale to `0.98` |
| Bottom sheet | 180ms transform/opacity |
| Sync accepted | Check icon fades after 1200ms |
| Sync failed | No shake; show stable inline error |
| Drag reorder | Lift item with border highlight, no heavy shadow |
| Live telemetry | Subtle row flash for new committed event |

No glow should be required to understand state. Glow may be used sparingly on active mobile numeric input only.

---

## 15. Design Decisions

| Decision | Status | Rationale |
| :--- | :--- | :--- |
| Treat mobile PWA as the full offline gym UI | Accepted | Architecture requires offline boot, IndexedDB queueing, and complete set logging even outside Telegram. |
| Treat Telegram Mini App as a companion surface | Accepted | Telegram-native logging is useful, but it must reuse internal commands and respect Mini App WebView limits. |
| Treat Google Sheets as one-way publish | Accepted | This matches architecture and prevents weakly typed cells from becoming canonical training data. |
| Show sync state per set row | Accepted | Athletes need confidence that offline logs are safe and later accepted by the backend. |
| Use dense operational desktop layout | Accepted | Coaches need scanning, comparison, and repeated editing more than marketing-style presentation. |
| Keep visuals dark but restrained | Accepted | The app is used in gyms and long coaching sessions; excessive neon/glass effects reduce clarity. |

---

## 16. Implementation Acceptance Checklist

Use this checklist after every generated screen or feature. A feature is incomplete if any required item fails.

### 16.1 Global Acceptance

- [ ] Screen matches the correct role: coach, athlete, integration, or operator.
- [ ] No marketing hero, decorative background, or nested card layout was introduced.
- [ ] All primary actions are visible without reading explanatory paragraphs.
- [ ] Online/offline and sync queue state are visible on authenticated PWA screens.
- [ ] Loading, empty, error, and permission-denied states are implemented.
- [ ] Numeric training values use tabular/mono styling and include units where needed.
- [ ] Color is not the only indicator of risk or status.
- [ ] Mobile layout works at 360px width without horizontal overflow.
- [ ] Desktop layout works at 1440px width without clipped tables or charts.
- [ ] Focus states are visible and keyboard navigation works for desktop controls.

### 16.2 Athlete Logging Acceptance

- [ ] Today's workout is the first mobile screen for athletes.
- [ ] Active set is visually dominant.
- [ ] Weight, reps, and RPE controls are numeric and cannot accept freeform text.
- [ ] Reps are integer-only.
- [ ] RPE supports 0.5 increments.
- [ ] Per-set sync state is visible.
- [ ] Offline logging remains available.
- [ ] Completed/locked workouts disable mutation controls and explain why.
- [ ] Rejected mutations show recovery actions.

### 16.3 Coach Desktop Acceptance

- [ ] Coach can switch active athlete.
- [ ] Calendar visibly groups workouts by microcycle.
- [ ] Cross-microcycle drag is blocked and explained.
- [ ] Workout builder uses structured prescription controls, not freeform parsing.
- [ ] LexoRank reorder controls are visible and stable.
- [ ] Analytics use backend canonical labels: e1RM, INOL, ACWR, DOTS.
- [ ] Export and Google Sheets publish flows are separate.
- [ ] Audit/conflict access exists from the main shell or settings.

### 16.4 Integration Acceptance

- [ ] Telegram is presented as a Mini App launched from the bot, with bot commands as entry/fallback.
- [ ] Telegram link flow uses short-lived token and `initData` verification language.
- [ ] Telegram Mini App states include unlinked, verifying, connected, auth failed, and online-only fallback.
- [ ] Telegram command failures are concise and actionable.
- [ ] Google Sheets UI says edits in Sheets do not update training data.
- [ ] Google Sheets publish has connected, publishing, published, failed, and revoked states.
- [ ] Provider failures do not block core workout logging.
- [ ] Integration outbox status is visible to coaches.

### 16.5 Prohibited Output Checklist

Reject or revise generated UI if it includes:

- [ ] A landing page instead of the actual app.
- [ ] Generic fitness stock imagery.
- [ ] Large decorative gradients or neon glow as primary styling.
- [ ] Cards nested inside cards.
- [ ] "Coming soon" placeholders for core flows.
- [ ] Freeform workout prescription text boxes as the only input method.
- [ ] Google Sheets import/edit as if it were already supported.
- [ ] Hidden sync/conflict/lock states.
- [ ] Buttons with vague labels like "Submit" where a domain action exists.
