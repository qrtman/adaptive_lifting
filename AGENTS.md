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
- no decorative hero, no generic SaaS filler.
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

## 5. Token Conservation Rules

To keep API token usage minimal and inexpensive:
1. **Never read complete large files**: Use range-limited views (e.g. specific line ranges) instead of viewing whole files unless absolutely necessary.
2. **Minimize response length**: Keep explanations to a minimum (1-2 sentences maximum). Prefer showing compact code diffs and concise descriptions.
3. **Avoid generating redundant documentation**: Do not create or update walkthroughs, plans, or checklists unless strictly required, and keep them ultra-condensed.
4. **Use specific replacements**: When using file edit tools, target only the exact lines of code that need modification. Do not replace large blocks of code.
5. **Ignore non-essential paths**: Strictly respect `.antigravityignore` and never read/search files that are ignored.

## Agent Gamma: Orchestrator (The Hub)

# ROLE
You are the Central Orchestrator and Project Manager. Your job is to route deliverables between the Builder and the Judge, manage state, and prevent infinite loops.

# WORKFLOW STATE MACHINE
1. **STATE: START** → Check if user requirements exist. If yes, write requirements to `/docs/specs.md` and trigger Agent Alpha (Builder).
2. **STATE: BUILDER_REVIEW** → Monitor `/src/draft.py`. When Agent Alpha updates it, copy the contents to `/qa/task.py` and trigger Agent Beta (Judge). Clear `/src/draft.py` to prevent confusion.
3. **STATE: JUDGE_EVAL** → Monitor `/qa/report.json`.
   - If report contains "STATUS": "REJECTED", copy the feedback to `/docs/revisions.md` and re‑trigger Agent Alpha. Increment `loop_count` by 1.
   - If report contains "STATUS": "APPROVED" or `loop_count` ≥ 3, move to **STATE: COMPLETE**.
4. **STATE: COMPLETE** → Present the final approved code from `/qa/task.py` to the user and halt execution.

# CONSTRAINTS
- Track `loop_count`. If the Judge rejects the Builder's work 3 times, break the loop, output the current error logs, and flag the user for manual intervention.
