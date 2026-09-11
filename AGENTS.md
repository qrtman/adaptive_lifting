# Adaptive Lifting Agent Instructions

This file is the first instruction layer for AI coding tools working in this repo. Read it before editing code. Then read the project source-of-truth documents:

- `architecture.md` for system behavior, backend boundaries, data model, sync, integrations, deployment, and security.
- `design.md` for UI/UX, component contracts, layout rules, copy, states, and acceptance checks.
- `knowledge.md` for compressed current product focus.

If this file conflicts with `architecture.md` or `design.md`, prefer the more specific instruction from the relevant source-of-truth document.

---

## 1. Three-Layer Working Method

Use this method for every task.

### Layer 1: Repo Rules

These rules are always active:

- Do not invent architecture that conflicts with `architecture.md`.
- Do not invent UI patterns that conflict with `design.md`.
- Do not build a marketing landing page unless explicitly requested.
- Do not make Telegram chat commands the primary mobile UI. Telegram is a Telegram Mini App launched from the bot, with bot messages as entry points, reminders, alerts, and fallback commands.
- Do not use Google Sheets as canonical storage. Sheets is one-way publish/export unless a future import-review workflow is explicitly requested.
- Do not parse workout prescriptions from freeform text. Use structured prescription data.
- Do not hide offline, sync, conflict, lock, rejected, or session-revoked states.
- Do not store numeric training values as strings.
- Do not use `LocalStorage` for workout sync. Use IndexedDB mutation queues and snapshots.
- Do not bypass RBAC, workout locks, tombstones, idempotency, backend canonical math, or audit logging from integrations.
- Do not create nested cards, decorative hero sections, gradient-orb backgrounds, or generic SaaS filler UI.
- Do not auto-seed demo microcycles, sample athletes (e.g. Zahar), or restore seed plans on empty fetch / reset / coach push. New athlete plans start empty.
- Treat the training plan as **athlete-owned space**. A linked coach has shared full write. Athlete unlink revokes coach access only; the plan stays with the athlete.
- Coach–athlete linking uses a **coach code** the athlete enters. Do not use coach email as the link code.
- Sessions (dated workouts) are first-class. Block/Week are optional grouping labels (block is a prefix of week). Labels may be set at create or anytime later; unlabeled sessions are allowed.
- Do not invent fixed Mon–Sun week containers or require creating a week before the first session.
- Calendar is date-first. Sessions view groups by Block/Week labels when present. Coach Calendar/Sessions must follow the active athlete switcher.
- **Web first:** Build Calendar, Sessions, and the web session screen (add lifts, prescribe, log) before Telegram Mini App / phone logging. Do not swap the web session into a phone mock. Do not block web logging on mobile work.

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
- Athlete-owned plan + coach code link/unlink match.
- Session-first + optional Block/Week labels match.
- No demo auto-seed.
- Telegram Mini App behavior matches.
- Google Sheets one-way publish behavior matches.
- Backend canonical math is respected.
- Deployment/runtime assumptions are not contradicted.

Review against design.md:
- Correct product surface and role.
- Athlete switcher drives coach Calendar/Sessions.
- Required UI states exist (including empty plan).
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
- Use domain terms exactly: e1RM, INOL, ACWR, DOTS, RPE, mesocycle, microcycle, Block, Week, session.
- Empty athlete plans show empty states — never inject demo data.

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
- RBAC checks (athlete owns plan; linked coach shared write; ended links blocked).
- Audit events where needed.
- Idempotency where needed.
- Tests or test notes.

Rules:
- Routers validate and delegate; business logic belongs in services.
- Do not let integrations write directly to ORM models.
- Do not bypass tombstones, locks, idempotency, or backend canonical math.
- Numeric training values stay numeric.
- Do not auto-seed demo programs.

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
| Auto-seeds demo weeks / Zahar / sample block | Return empty plan; show empty UI states. |
| Forces Mon–Sun week before first session | Create dated session; optional Block/Week labels anytime. |
| Uses coach email as invite code | Use coach code generate + athlete enter code. |
| Puts plan ownership on the coach | Keep plan in athlete space; unlink only ends access. |

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
