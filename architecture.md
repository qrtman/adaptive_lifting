# Adaptive Lifting — System Architecture

How the system is built and why. This document records **system decisions and known gaps**.

## How to use this document

- **The code is the source of truth for what exists.** Where this document disagrees with the code, the code
  is right. Fix the document in the same change.
- Every section is labelled **Built**, **Partly built**, or **Not built**. **Not built** means nothing backs
  it. Do not code against it, and do not assume an invariant holds because it is described here.
- §13 is the honest backlog. A previous version of this document described locks, tombstones, CSRF, fractional
  indexing, invite codes, and a Docker topology in the present tense; none of it existed, and agents wrote code
  against files and guarantees that were never there. If something moves from wish to reality, move it out of §13.
- Product and UI decisions live in `design.md`. Do not restate them here.

---

## 1. Summary

A powerlifting coaching app: a Vite + React + TypeScript PWA frontend and a FastAPI + SQLAlchemy + SQLite
backend.

The important thing to understand before changing anything: **the frontend runs local-first and the backend is
opt-in.** `src/services/api.ts` reads `VITE_BACKEND_URL`, which defaults to `''`. With no backend configured,
the app hydrates the selected athlete's plan from IndexedDB (and from the imported-plan registry when
that cache is empty or stale). There is no unowned demo schedule. Every metric on screen is computed in the
browser unless a backend is wired. Most development and all end-to-end tests run in that mode.

---

## 2. Glossary

| Term | Definition |
| :--- | :--- |
| **RPE** | Rate of Perceived Exertion, Borg CR-10. RPE 10 is failure; RPE 8 leaves two reps in reserve. |
| **RIR** | Reps In Reserve. `RIR = 10 - RPE`. |
| **e1RM** | Estimated one-rep maximum, projected from a submaximal set using RPE-adjusted formulas. |
| **INOL** | Intensity Number of Lifts. Per-lift fatigue metric: how much stress one movement accumulates in a window. |
| **ACWR** | Acute-Chronic Workload Ratio. Recent 7-day load against the rolling 28-day average. |
| **Tonnage** | `sum(weight × reps)` across working sets. |
| **Mesocycle** | A training block of roughly 4–8 weeks with one phase goal. |
| **Microcycle** | One training week inside a mesocycle. The primary scheduling unit. |
| **Tier** | `Comp`, `Variation`, or `Accessory`. |
| **Lift category** | `Squat`, `Bench`, `Deadlift`, or `Other`. Used for grouping and export gating. |
| **Top set** | The heaviest or most fatiguing set in an exercise, flagged `isTop`, tracked for e1RM. |
| **Effective reps** | `reps + (10 - RPE)`. Used by the RPE-compensated linear-decay e1RM formula. |
| **DOTS** | Bodyweight-normalised strength coefficient for cross-class comparison. |

---

## 3. Tenets and constraints

**Enforced today**

1. **Numeric integrity.** Training values are numeric end to end. `src/services/numericTraining.ts` guards conversion.
2. **Offline-tolerant logging.** Sessions can be logged with no network. Mutations queue in IndexedDB and flush later.
3. **Chronological binding.** Every workout carries a `YYYY-MM-DD` date. Rescheduling must not break date assignment.
4. **Microcycle boundary.** Workouts cannot move or be added outside that week's start–end dates. Dates are stored on the client microcycle and on the backend `microcycles.startDate` / `endDate` columns. Unset weeks default to the ISO week of placed sessions. The client enforces on drag/add; sync rejects `date` writes outside the range.
5. **Kilograms canonical.** One storage unit regardless of display preference.
6. **Idempotent sync.** Mutations carry ids so retries cannot duplicate logs.
7. **LocalStorage is UI preferences only.** Workout trees live in IndexedDB.

**Aspirational — stated as a tenet before, not actually enforced**

- *Server-canonical state.* The backend recalculates on `/api/sets/log` and sync, but with no backend
  configured the frontend is the only authority. Treat "canonical" as true only when a backend is wired.
- *Append-only immutability.* `deleted_at` columns exist, but `POST /api/reset` hard-deletes microcycles and the
  client tombstone store is never written.
- *Single-writer per workout.* `workout_locks` is checked during sync. Nothing acquires, renews, or displays a lock.
- *Fractional indexing.* `lexo_rank` columns exist and are always `"a0"`. No midpoint algorithm exists.

---

## 4. System context

**Built**

| Component | Where | Notes |
| :--- | :--- | :--- |
| React PWA | `src/` | Service worker registered in `main.tsx`; `public/sw.js` caches the shell |
| Contexts | `src/contexts/` | `AuthContext`, `SyncContext`, `PeriodizationContext` |
| Offline store | `src/services/db.ts` | IndexedDB `adaptive_lifting_db` with `snapshots`, `mutations`, `tombstones`, `metadata` |
| Plan cache | `src/services/planStore.ts` | Per-athlete versioned plan snapshots with provenance |
| Sync queue | `src/services/sync_engine.ts` | Debounced flush, 2000ms |
| API client | `src/services/api.ts` | Real fetch when `VITE_BACKEND_URL` is set, otherwise IndexedDB. Offline fallback is empty, never an unowned seed tree. |
| Backend | `backend/main.py` | FastAPI, SQLAlchemy, SQLite at `backend/database.sqlite` |
| Integrations | `backend/integrations.py` | Telegram and Google Sheets routers |
| SSE | `backend/sse_broadcaster.py` | Backend broadcasts committed domain events |

**Built.** Frontend fetches go through `src/services/backendUrl.ts` (`VITE_BACKEND_URL`). When that origin is empty the app stays local-first and does not call localhost. There is no Vite dev proxy.

**Not built.** No frontend subscribes to SSE. Request handling still lives mostly in `main.py`. Microcycle date/copy logic is in `backend/microcycle_ops.py`.

---

## 5. Domain model

**Built** — tables in `backend/database.py`. Training entities carry a `TimestampMixin` with `updated_at` and
`deleted_at`.

| Table | Purpose | Reached by the API? |
| :--- | :--- | :--- |
| `users` | Accounts and role | Yes |
| `coaching_relationships` | Coach to athlete links | Yes |
| `mesocycles` | Training blocks | **No** — model only, never queried |
| `microcycles` | Training weeks | Yes |
| `workouts` | Sessions, date-bound | Yes |
| `exercises` | Lifts within a session, with `tier` and `lift_category` | Yes |
| `exercise_sets` | Per-set prescription and execution | Yes |
| `accessories` | Legacy; rows tombstoned by `accessory_migration.py` at startup | Relationship still present on `Workout` |
| `client_devices` | Registered devices | Yes |
| `sessions` | Login sessions | Created at login, **not checked** during auth |
| `sync_mutations` | Server-side mutation log | Yes |
| `workout_locks` | Single-writer intent | Checked during sync only; no acquire, renew, or release endpoint |
| `audit_events` | Audit trail | Yes |
| `invite_codes` | Coach invite codes | **No** — linking uses the coach's email |
| `domain_events` | Committed events feeding SSE | Yes |
| `integration_connections` | Provider connection state | Yes |
| `integration_credentials` | Encrypted provider secrets | Yes |
| `webhook_events` | Inbound webhook dedupe | Yes |
| `integration_outbox` | Retryable outbound jobs | Yes |
| `sheet_publications` | Publish records | Model only; publishing goes through the outbox |

**Built.** `microcycles.startDate` and `endDate` are optional `YYYY-MM-DD` columns, patched via
`PATCH /api/microcycles/{id}/bounds` and returned from `GET /api/microcycles`. `POST /api/microcycles/{id}/copy`
duplicates prescriptions with new ids. Unset weeks derive an ISO Monday–Sunday from session dates on both
client and server. There is no VBT telemetry table. Indexes are created by `create_all` plus inline
`ALTER TABLE` in `migrate_db()`; there is no migration tool.

Client types live in `src/types.ts` and do not mirror this schema exactly. The client tree is
`MicrocycleData → WorkoutData → ExerciseData → SetData`.

---

## 6. Mathematical core

**Built.** Formulas are implemented twice, deliberately: `backend/math_utils.py` and
`src/services/mathEngine.ts`. Parity is protected by shared vectors in `tests/math_vectors.json`, exercised by
both `src/services/mathEngine.test.ts` and `tests/test_math_vectors.py`.

Shared: the RPE chart, e1RM, INOL, DOTS, ACWR, tonnage, and attempt jumps.

Frontend only, and fine there because they serve prescription UI: `anchorE1RMFromPrescription`,
`calculateCapacityScaledWeight`, percentage-intensity helpers, and the preceding-set e1RM delta.

When a backend is configured it recalculates on write and its values win. With no backend the frontend numbers
are the only numbers. Do not describe the backend as canonical without that qualifier.

**Not built.** CNS fatigue curve modelling and velocity-based training readiness indices. `velocity` exists as
a column on a set and is not modelled.

---

## 7. Client state, offline, and sync

**Built**

- `PeriodizationContext` owns the selected athlete, the roster, the microcycle tree, and every mutation entry point.
- On launch the context loads the roster, picks the last-used athlete (or the first athlete who has a plan),
  and shows that athlete's sessions. Switching athletes is a native select in the sidebar; it does not go
  through Roster. A plan already loaded in this session swaps immediately from the in-memory cache. The first
  load of an athlete waits for that athlete's IndexedDB snapshot and does not clear the previous tree until
  the next one is ready.
- Insights KPIs and charts are derived from the selected athlete's in-memory microcycles (`trendsFromMicrocycles`),
  not from `GET /api/microcycles`.
- Plans are cached per athlete via `planStore.ts` as `plan:<athleteId>`, recording schema, source
  (`imported` / `api` / `local`), a content fingerprint, and which sessions were edited in the app. A changed
  import reconciles on load and keeps edited sessions. A cached plan that does not share structure with the
  import (the old unowned seed) is discarded, not merged. The pre-schema shared `microcycles` snapshot is
  dropped unless it already belongs to that athlete's import.
- `sync_engine.ts` queues mutations with ids and flushes on a 2000ms debounce.
- `SyncContext` surfaces queue state and conflicts; `ConflictReviewCard` presents a resolution choice.
- `evictOldSyncedData()` prunes acked and rejected mutations older than 28 days.
- `uiPrefs.ts` keeps UI preferences in LocalStorage and migrates or purges legacy keys.

**Partly built**

- Conflict handling. `CONFLICTED` exists as a mutation state; the server sets `REJECTED`.
- Field-level merge. `sync_service.py` does last-write-wins with clock-skew rejection, but `field_path` is
  always `"ALL"`, so merges are whole-record.
- Hydration limits. Only mutations are evicted. Plan snapshots grow without bound.

**Not built**

- Tombstones on the client. The `tombstones` store is created and never read or written.
- Recovering `IN_FLIGHT` mutations to `PENDING` after a crash.
- Workout lock acquisition, renewal, or UI.
- Fractional index reordering.
- Structured prescription mode envelopes such as `TOP_SET_BACKDOWN`. Sets are flat fields plus an optional
  `intensity_type` and `target_value`.

---

## 8. API

**Built** — every route currently in `backend/main.py`, `backend/integrations.py`, and
`backend/sse_broadcaster.py`.

| Area | Endpoints |
| :--- | :--- |
| Auth | `POST /api/auth/login`, `/api/auth/google`, `/api/auth/logout`, `/api/auth/register`, `/api/auth/link-athlete` |
| Training | `GET /api/microcycles` (empty when the athlete has no weeks; never auto-seeds a demo tree), `PATCH /api/microcycles/{id}/bounds`, `POST /api/microcycles/{id}/copy`, `POST /api/sets/log`, `POST /api/workouts/{id}/sync`, `POST /api/reset` |
| Coaching | `GET /api/coach/roster` |
| Analytics | `GET /api/analytics/trends`, `GET /api/analytics/ai-advisor` |
| Export | `GET /api/export/csv`, `GET /api/export/json` |
| Security | `GET/DELETE /api/security/devices[/{id}]`, `GET/DELETE /api/security/sessions[/{id}]`, `GET /api/security/audit-events` |
| Telegram | `POST /api/integrations/telegram/link-token`, `/miniapp/session`, `/webhook`; `GET .../status`; `DELETE /api/integrations/telegram` |
| Sheets | `GET /api/integrations/google-sheets/auth-url`, `/callback`, `/status`; `POST .../publish`; `DELETE /api/integrations/google-sheets` |
| Live | `GET /api/workouts/{workout_id}/live` (SSE) |

There is no health endpoint and no OpenAPI contract test. Error shapes are inconsistent: some routes return a
plain string detail, sync and lock failures return a nested `detail={"error": {...}}`. Unify on the nested
shape when touching a route.

`POST /api/reset` hard-deletes microcycles, which contradicts the soft-delete tenet. Treat it as a development
affordance.

---

## 9. Security

**Built**

- JWT HS256 in an HttpOnly `session_id` cookie, 7-day expiry, with a `Bearer` header fallback.
- Password hashing with bcrypt.
- Coach/athlete RBAC on analytics trends, CSV export, and roster.
- Device and session listing and revocation endpoints, surfaced by `SecurityView`.
- Audit events written for exports and other notable actions.
- Encrypted provider credentials, and Telegram `initData` HMAC verification.

**Known gaps — do not assume these hold**

| Gap | Reality |
| :--- | :--- |
| Session revocation | `get_current_user` decodes the JWT and loads the user. It never checks `sessions.revoked_at`, so revoking a session does not end it. Revocation is cosmetic until that check exists. |
| CSRF | No tokens and no middleware, despite cookie auth. |
| Login rate limiting | None. |
| Prescription write authority | Neither `/api/sets/log` nor sync checks whether the caller may edit that workout. Any authenticated user can mutate any set they can name. |
| Invite codes | The `invite_codes` table is unused. `/api/auth/link-athlete` accepts the coach's email as the code. |
| SSE authorisation | `/api/workouts/{id}/live` has no `get_current_user` dependency. |
| Frontend auth | `AuthContext` accepts an `al_role_mode` LocalStorage value, which is how end-to-end tests sign in. It is a dev bypass, not a security boundary. |

**Not built.** Account deletion, GDPR export, and biometric or HealthKit ingestion.

---

## 10. Integrations

**Built**

- **Google Sheets, one way out.** OAuth connect, manual publish, retryable jobs through `integration_outbox`
  with a background worker thread. Nothing reads from Sheets, and nothing should: spreadsheet cells are weakly
  typed and must never become canonical training data.
- **Telegram.** Short-lived link tokens, Mini App session exchange, webhook handling with dedupe through
  `webhook_events`, and bot command handling.
- **Export.** CSV, one row per set. JSON, hierarchical.

**Partly built.** Telegram `initData` verification has a real HMAC path plus a mock bypass when a mock bot
token is configured. Bot commands are handled server-side but there is no Mini App frontend route to launch.

**Not built.** Scheduled publishing — publish is manual only. Any inbound Sheets import.

Provider failure must never block set logging. Logging is local-first, so this holds by construction.

---

## 11. Testing

**Built**

| Suite | Command | Covers |
| :--- | :--- | :--- |
| Vitest | `npm test` | `src/**/*.test.ts` — math engine, plan store, athlete plan registry, roster merge, workout days, insights, fixture integrity |
| Playwright | `npm run test:e2e` | `e2e/*.spec.ts` — login, calendar, sessions, offline, insights, roster |
| pytest | `pytest` | `backend/test_*.py`, `tests/test_math_vectors.py` |

Math parity is the one genuinely cross-language guarantee, via `tests/math_vectors.json`.
`backend/test_math.py` still asserts inline values rather than reading the shared vectors; prefer the vectors.

End-to-end tests run against the local-first frontend with no backend, and the offline spec mocks the sync API.
`backend/test_microcycle_ops.py` and `backend/test_microcycles.py` cover week dates, copy, empty GET, and reset.

**Not built.** OpenAPI contract tests, IndexedDB migration tests, and session revocation tests.

---

## 12. Project structure

```
src/
  App.tsx  main.tsx  types.ts  index.css
  components/            flat views and controls
    insights/            InsightKpiStrip
    mobile/              TelegramSessionTerminal
  contexts/              AuthContext, SyncContext, PeriodizationContext
  data/
    athletePlans.ts      athlete id -> imported plan registry
    exerciseCatalog.ts
    fixtures/            real imported blocks and roster seeds; sample data, never spec
  insights/construct.ts  Insights KPI and chart catalog
  services/              api, backendUrl, db, planStore, sync_engine, mathEngine,
                         localRoster, numericTraining, workoutDays, copyMicrocycle
  storage/uiPrefs.ts     LocalStorage UI preferences only
backend/
  main.py                app, auth, training, analytics, export, security routes
  database.py            SQLAlchemy models and engine
  sync_service.py        mutation reconciliation
  math_utils.py          canonical formulas
  integrations.py        Telegram and Sheets routers
  sse_broadcaster.py     SSE from committed domain events
  runtime_config.py  accessory_migration.py  microcycle_ops.py  test_*.py
e2e/                     Playwright specs and helpers
tests/                   shared math vectors and their pytest
scripts/                 offline data conversion, not runtime code
```

Components are flat. There is no `layout/`, `calendar/`, or `sessions/` grouping, no `schemas.py`, and no
`backend/services/` package.

---

## 13. Known gaps and wishlist

Consolidated so no section above has to pretend. **Nothing here is a requirement.** Do not build it because it
is written down.

**Debt worth fixing when nearby**

- Enforce session revocation in `get_current_user`.
- Authorise prescription writes on `/api/sets/log` and sync.
- Authorise the SSE endpoint.
- Unify the API error envelope.
- Adopt a migration tool instead of inline `ALTER TABLE`.
- Bound plan snapshot growth in IndexedDB.

**Wishlist**

- Client tombstones and full soft-delete semantics.
- Workout lock lifecycle and its UI.
- Fractional indexing for user-ordered lists.
- Field-level sync merge instead of whole-record last-write-wins.
- A frontend SSE subscriber for live telemetry.
- Telegram Mini App frontend route.
- Scheduled Sheets publishing.
- CSRF tokens and login rate limiting.
- Invite-code linking.
- CNS fatigue and velocity-based training models.
- Deployment: there is no Dockerfile, compose file, CI pipeline, backup script, or performance instrumentation
  in this repo. Development is `npm run dev` plus `uvicorn backend.main:app --reload`.

---

## 14. Decision log

Decisions taken, with whether they are actually implemented. A decision being accepted is not evidence that it
exists.

| Decision | Rationale | Implemented |
| :--- | :--- | :--- |
| IndexedDB, not LocalStorage, for offline queueing | Mutation queues need durability, capacity, and record-level recovery | Yes |
| Purge legacy LocalStorage workout keys | Early placeholders stored workout trees in the wrong place | Yes |
| Mutation ids for sync idempotency | Reconnects and retries must not duplicate logs | Yes |
| Duplicate math on the frontend, keep the backend authoritative | Athletes need instant feedback; persisted analytics should be server-authoritative | Partly — only when a backend is configured |
| Canonical weights in kilograms | Formula parity and export consistency | Yes |
| Lifecycle statuses as enums | Analytics and exports need stable machine values | Yes |
| Accessories as `Exercise` with `tier = Accessory` | Isolation work needs the same per-set logging and sync path | Yes |
| Google Sheets one-way publish | Weakly typed cells must not become canonical training data | Yes |
| SQLite to start | Target is a single coach or small team; Postgres is for multi-tenant | Yes |
| Emit SSE from committed domain events | Live telemetry must never show data that later rolls back | Backend only |
| Cache plans per athlete with provenance and a content version | A shared unversioned snapshot went stale and could only be fixed by a destructive manual re-import | Yes |
| Resolve athlete plans through a registry | Athlete-specific branching spread one import across the whole codebase | Yes |
| Every schedule belongs to an athlete | An unowned demo microcycle tree sat in Sessions and forced a Roster detour | Yes — `GET /api/microcycles` returns the athlete's weeks or `[]`. It does not plant a demo tree. |
| Enforce microcycle boundary locks on client and server | Workload metrics break if workouts cross week dates | Client drag/add; sync rejects `date` writes outside stored or derived bounds |
| Session-backed JWT revocation | Logout and device revocation need server-side invalidation | **No** — see §9 |
| Tombstones for soft deletes | Prevents resurrecting deleted records from offline edits | Columns only |
| Fractional indexing (LexoRank) | Resolves offline reorder conflicts without rewriting siblings | **No** |
| Strict hydration window | Stops IndexedDB growing without bound over a multi-year career | Mutations only |
| SQLite WAL in production | Read-heavy dashboards need better concurrency | **No** |
| Deploy on one Dockerised VPS | SSE, webhooks, OAuth callbacks, and backups need a durable long-running host | **No** |
