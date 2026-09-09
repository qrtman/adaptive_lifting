# Adaptive Lifting — Agent Instructions

Read this before editing code.

---

## 1. What the documents in this repo are

**The code is the source of truth for what this app does.** `design.md` and `architecture.md` record
decisions and intent. They are written by people and they go stale.

When a document disagrees with the code:

1. The code is right about what exists.
2. Decide whether the document is describing a decision that was never implemented, or is simply out of date.
3. Fix the document in the same change. Do not silently leave the contradiction for the next agent.

Both documents label every section:

| Label | Meaning | What you may do |
| :--- | :--- | :--- |
| **Built** | Exists in the code and is expected to keep working. | Change it only on request. Keep the states listed. |
| **Partly built** | Some of it exists. The gap is described. | Safe to extend. Do not assume the missing half works. |
| **Not built** | A wish. Nothing backs it. | **Do not implement because it is written down.** Build it only when asked. |

A thing being described in detail is not evidence that it exists, that it is wanted now, or that it is
next. Length is not priority. Most of what these documents once contained was aspiration written in
the present tense, which is why they used to produce wrong code.

---

## 2. Where each kind of rule lives

Each rule has exactly one home. Do not copy rules between files — duplicated rules drift apart and then
contradict each other.

| Kind of rule | Home |
| :--- | :--- |
| Product and UI decisions (layout, states, copy, what a screen shows) | `design.md` §3 |
| System behaviour (data model, sync, auth, integrations, API) | `architecture.md` |
| How to work in this repo | This file |

---

## 3. Engineering rules

These are always active.

- Numeric training values stay numeric end to end. Never store or pass kg, reps, RPE, or percentages as strings.
- Workout data lives in IndexedDB snapshots and mutation queues. `LocalStorage` is UI preferences only.
- Prescriptions are structured data. Never parse them out of freeform text.
- Never key application logic on a specific athlete, block name, or id prefix. Athlete-scoped data resolves
  through the registry in `src/data/athletePlans.ts`, so adding the next athlete is data, not code.
- A real athlete's name, block label, and logged numbers are **fixture data**. They belong in
  `src/data/fixtures/`, never in `design.md`, `architecture.md`, or as test acceptance criteria. Conversion
  fidelity for a real import is checked by one fixture-integrity test that sits beside the fixture.
- Tests assert mechanisms against neutral fixtures, so a test failing tells you the behaviour broke rather
  than that someone's training numbers changed.
- Cached data carries provenance and a version and refreshes itself. Never ask the user to re-open, re-import,
  or re-run something to pick up fresh data. Discarding a user's work is a separate, explicitly labelled action.
- Routers validate and delegate. Business logic belongs in services, not in route handlers or ORM callbacks.
- Do not bypass RBAC, workout locks, tombstones, idempotency, or audit logging where they exist. Where they
  do not exist yet, `architecture.md` §9 lists the gaps honestly — read it before assuming an invariant holds.

---

## 4. Changing a decision

When the user overrides a decision:

1. Edit the decision where it lives (`design.md` §3 for product, `architecture.md` for system behaviour).
2. **Delete or correct every other passage that now contradicts it, in the same change.** Search for it.
3. Do not add a new "overrides" or "exceptions" layer on top of the old text. That is what broke these
   documents before: corrections accumulated at the top while the body kept describing the rejected design,
   and each new agent implemented whichever it read first.

If a section becomes untrue and you cannot fix it properly, relabel it **Not built** rather than leaving it
looking authoritative.

---

## 5. Working method

Before implementing, be concrete about: what the user asked for, which documented decisions govern it, which
files you expect to change, and how you will know it works. Keep this proportionate — a one-line fix does not
need a plan.

While implementing:

- Change only what the task needs. Do not refactor unrelated files.
- Include the states the surface actually needs: loading, empty, error, permission-denied, and where relevant
  offline/syncing, rejected/conflict, and locked/read-only. Hiding these states is a bug.
- Match the surrounding code's naming, comment density, and idiom.

Before finishing:

- Run the relevant checks: `npm run lint`, `npm test`, `npm run test:e2e`, `pytest`. If one cannot run, say so
  and why.
- Re-read the documented decisions you touched and confirm the code matches them.
- If you changed behaviour a document describes, update that document now.

---

## 6. Final response

Say what changed, what you verified, and what is still missing or uncertain. Be specific and brief. If you
left a known gap, name it rather than letting it be discovered later.
