# Adaptive Lifting Agent Instructions

This file is the first instruction layer for AI coding tools working in this repo. Read it before editing code. Then read the project source-of-truth documents:

- `architecture.md` for system behavior, backend boundaries, data model, sync, integrations, deployment, and security.
- `design.md` for UI/UX, component contracts, layout rules, copy, states, and acceptance checks.

If this file conflicts with `architecture.md` or `design.md`, prefer the more specific instruction from the relevant source-of-truth document.

---

## 1. Three-Layer Working Method

Use this method for every task.

### Layer 1: Repo Rules

These rules are always active:

- Do not invent architecture that conflicts with `architecture.md`.
- Do not invent UI patterns that conflict with `design.md`. If the user overrides a design rule, update `design.md` section **0.5 Product Overrides** and the matching later section in the same change.
- Do not put prescription Mode (`RPE_TARGET`, `PERCENTAGE`, `AMRAP`, `TOP_SET_BACKDOWN`, `HYBRID`), Sets, Reps, RPE, %, or kg controls in Add Exercise. Edit Rx on the exercise card after the lift is added.
- Do not invent D-labels. Add Session assigns a **microcycle** and labels days chronologically in that microcycle (`D1`, `D2`, …). Inserting between D1 and D2 becomes D2; later days increment.
- Do not build a marketing landing page unless explicitly requested.
- Do not make Telegram chat commands the primary mobile UI. Telegram is a Telegram Mini App launched from the bot, with bot messages as entry points, reminders, alerts, and fallback commands.
- Do not use Google Sheets as canonical storage. Sheets is one-way publish/export unless a future import-review workflow is explicitly requested.
- Do not parse workout prescriptions from freeform text. Use structured prescription data.
- Do not write a real athlete's data into `design.md`, `architecture.md`, or test assertions. Names, block labels, and logged kg/reps/RPE from a real import are **fixture data**, not product specification. Spec documents describe the capability generically. Tests assert the mechanism against neutral fixtures. Conversion fidelity for a real import is checked by one fixture-integrity test that lives beside the fixture in `src/data/fixtures/`.
- Do not key application logic on a specific athlete, block name, or id prefix. Athlete-scoped data is resolved through a registry keyed by athlete id, so adding the next athlete is data, not code.
- Do not make the user re-run an import to refresh stale local data. Cached plans carry provenance and a version and reconcile automatically. Discarding logged work is a separate, explicitly labeled action.
- Do not hide offline, sync, conflict, lock, rejected, or session-revoked states.
- Do not store numeric training values as strings.
- Do not use `LocalStorage` for workout sync. Use IndexedDB mutation queues and snapshots.
- Do not bypass RBAC, workout locks, tombstones, idempotency, backend canonical math, or audit logging from integrations.
- Do not create nested cards, decorative hero sections, gradient-orb backgrounds, or generic SaaS filler UI.

### Layer 2: Task Brief

Before implementing, restate the task in concrete terms and identify:

- Architecture sections that govern the behavior.
- Design sections that govern the UI.
- Files you expect to edit.
- Required states and acceptance criteria.

Use this task brief format:

```md
Task:
Build or modify [specific feature].

Source of truth:
- architecture.md section(s): [...]
- design.md section(s): [...]

Scope:
- Edit only: [...]
- Do not refactor unrelated files.

Required behavior:
- [...]
- [...]

Required UI states:
- loading
- empty
- success
- offline/syncing where relevant
- rejected/conflict where relevant
- locked/readonly where relevant
- permission denied where relevant

Acceptance criteria:
- [...]
- [...]

Verification:
- Run lint/typecheck/tests if available.
- If a command cannot run, explain why.
```

### Layer 3: Review Gate

Before stopping, review the work against the source documents. Fix mismatches before final response.

Use this review gate:

```md
Review against architecture.md:
- Data model matches.
- Sync/offline behavior matches.
- RBAC and session behavior match.
- Telegram Mini App behavior matches.
- Google Sheets one-way publish behavior matches.
- Backend canonical math is respected.
- Deployment/runtime assumptions are not contradicted.

Review against design.md:
- Correct product surface and role.
- Required UI states exist.
- Component contracts are satisfied.
- Mobile and desktop layouts follow the rules.
- Prohibited patterns are absent.
- Copy and domain terms are correct.

Final response must include:
- Files changed.
- Verification run.
- Any known gaps.
```

---

## 2. Task Templates

### 2.1 UI Feature Template

```md
Build [UI feature].

Read first:
- architecture.md sections: [...]
- design.md sections: [...]

Implement:
- [component/view]
- [states]
- [actions]

Rules:
- Follow design.md component contracts.
- Include loading, empty, error, permission, locked, and sync states where applicable.
- No nested cards, no decorative hero, no generic SaaS filler.
- Use domain terms exactly: e1RM, INOL, ACWR, DOTS, RPE, mesocycle, microcycle.

Verify:
- Typecheck/lint.
- Check mobile 360px and desktop 1440px layout if browser tools are available.
```

### 2.2 Backend/API Template

```md
Build [backend/API feature].

Read first:
- architecture.md sections: [...]

Implement:
- Endpoint/service/schema/repository changes.
- RBAC checks.
- Audit events where needed.
- Idempotency where needed.
- Tests or test notes.

Rules:
- Routers validate and delegate; business logic belongs in services.
- Do not let integrations write directly to ORM models.
- Do not bypass tombstones, locks, idempotency, or backend canonical math.
- Numeric training values stay numeric.

Verify:
- Run backend tests or the closest available check.
```

### 2.3 Integration Template

```md
Build [Telegram Mini App / Google Sheets] integration feature.

Read first:
- architecture.md section 14.
- design.md sections 8 or 9.

Rules:
- Telegram is a Mini App launched from the bot; verify initData server-side.
- Bot messages are entry points, reminders, alerts, and fallback commands.
- Google Sheets is one-way publish/export only.
- Provider failures must not block core workout logging.
- Use IntegrationOutbox for retries and AuditEvent for important actions.

Verify:
- Invalid auth is rejected.
- Duplicate provider events/jobs are idempotent.
- RBAC prevents unrelated athlete access.
```

### 2.4 Bug Fix Template

```md
Fix [bug].

Expected behavior:
- [...]

Observed behavior:
- [...]

Constraints:
- Do not refactor unrelated code.
- Preserve architecture.md and design.md contracts.

Verify:
- Add or update the smallest useful test.
- Run the relevant check.
```

---

## 3. Common Failure Corrections

If the generated result does any of the following, revise immediately:

| Failure | Correction |
| :--- | :--- |
| Builds a landing page | Replace with the actual app surface for the requested role. |
| Creates pretty cards but no states | Add loading, empty, error, offline, sync, lock, and conflict states as relevant. |
| Treats Telegram as just chat commands | Convert to Telegram Mini App launched from bot, with bot fallback. |
| Treats Sheets as editable database | Convert to one-way publish/export. |
| Uses freeform prescription text | Replace with structured controls and readonly generated preview. |
| Stores numbers as strings | Use numeric types end to end. |
| Hides sync failures | Add per-row status and conflict review. |
| Ignores locks/tombstones | Add disabled/read-only behavior and recovery copy. |
| Adds generic gradients/glass | Use restrained dark operational UI from `design.md`. |
| Writes a real athlete's name or numbers into spec docs or test assertions | Move the data to `src/data/fixtures/`, describe the capability generically in the spec, and assert the mechanism against a neutral fixture. |
| Hardcodes one athlete, block, or id prefix in app logic | Resolve through the athlete-keyed registry so the next athlete is a data change. |
| Tells the user to re-open or re-import to pick up fresh data | Version the cached plan and reconcile automatically without discarding logged sets. |

---

## 4. Final Response Format

Keep final responses short and concrete:

```md
Changed:
- [file]: [what changed]

Verified:
- [command/check]

Notes:
- [known limitation or none]
```

