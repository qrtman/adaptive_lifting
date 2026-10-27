# Recovery maintenance checkpoint — 2026-10-27

**Owner-only production rehearsal: BLOCKED / NOT TESTED.** This continuation
implements the read-only inspection and isolated fault-testing checkpoint. It
does not implement or approve a production pause, backup, or successful restore.

## Task and boundary

Complete the owner-only encrypted backup and two-target isolated restore under
architecture sections 9 and 15.3–15.6. Design section 0 requires no UI changes.
The owner selected **production schema unchanged**, with a stop before capture
if existing controls cannot safely freeze writers and recover after interruption.

Edit scope is recovery scripts/tests, a synthetic-only workflow, and these status
notes. Preserve the pre-existing recovery and browser-test work. No production
migrations are replayed; no production recovery-control schema or sequence DDL is added.

## Fresh read-only observations

Production Supabase metadata, inspected through the connected SQL tool:

- Project `gadusaizqnshxqcckibq`: `ACTIVE_HEALTHY`, Seoul, PostgreSQL 17.11
  (`server_version_num=170011`). The migration ledger contains 63 entries.
- The current three-schema capture scope has 37 tables and one sequence:
  `public.coaching_relationships_id_seq`, owned by
  `public.coaching_relationships.id`. It is integer, ascending, noncycling,
  increment 1, cache 1. No sequence values or application rows were selected.
- Both `email-verification-edge-worker` and `al-google-sheets-worker` cron jobs
  are active. Pausing future cron ticks does not establish that dispatched HTTP
  requests or Edge/provider work have drained.
- `al_edge_catalog_runtime`, `authenticator`, `postgres`, and `supabase_admin`
  are login roles. The latter two have privileged attributes. This selected-role
  observation is not a complete writer inventory.
- Installed dependencies include `pg_cron` 1.6.4, `pg_net` 0.20.4, and
  `supabase_vault` 0.3.1. The `pgsodium` extension is not installed. A separate
  count-only check observed two Vault ciphertext rows; no secret values/root
  material were selected or retrieved.

Cloudflare metadata, inspected through the dedicated connector in account
`05a07c48f5e8e3afb784e11931502508`:

- `goatedmethod-production-backups` remains Standard, APAC, default jurisdiction.
- Managed public access is disabled; custom domains are absent.
- Lifecycle contains the existing seven-day incomplete-multipart abort rule;
  no completed-object expiration was observed.
- No objects were read, uploaded, overwritten, or deleted. Bucket dedication,
  recovery-prefix exclusivity and account-wide free R2 capacity remain unproven.

GitHub public API confirms `qrtman/adaptive_lifting` is public and defaults to
`main`, currently observed at `ae320af0cdd4c46c17a0741bd64b5ae7c97f3261` before
this test branch was created. The historical local recovery branch no longer
exists remotely. The dedicated GitHub connector is authenticated as `qrtman`.
A local names-only settings readback failed without exposing diagnostics or
credentials; no current secret-value or enablement-flag verification is claimed.

## Implemented checkpoint

- `maintenance-readiness.mjs`: fixed, bounded read-only metadata queries with
  `search_path=pg_catalog`, strict validation, unconditional rollback, and owned
  connection cleanup. It reads no application payloads, sequence values, Vault
  rows, role passwords, cron commands, or request/query text. Counts never prove
  a closed writer inventory, admission control or worker drain. Every report is
  `BLOCKED`, `captureAllowed:false`; rollback/close failures invalidate it.
- Local capture connector and snapshot changes verify client-to-pooler TLS,
  expected database/version, and current/session roles. Backend `pg_stat_ssl`
  cannot substitute for client transport. The snapshot requires trusted client
  transport before opening its transaction. Exact pinned pg 8.23.1 source and
  [Node TLS semantics](https://nodejs.org/api/tls.html#tlssocketauthorized)
  were consulted. This adapter correction is locally tested, not a fresh hosted
  production connection result.
- Local capture CLI adds `--inspect-maintenance`, a separate hosted manual,
  default-branch observation path with exit 2 for a blocked report. It does not
  load an inventory, pause writers, retrieve a root, capture data or access R2.
  Release `--preflight` now reports `release-package-validated` and explicitly
  excludes maintenance/recovery approval.
- `maintenance-fault-drill.mjs`: isolated PostgreSQL 17 negative controls using
  synthetic roles, tables and a sequence. Tests whether SHARE table locks allow
  readers, standalone `nextval`/`setval` and cache allocation; whether an existing
  login survives `NOLOGIN`; and whether backend loss releases locks while a
  committed login pause persists. Synthetic independent restoration preserves
  an initially-disabled role. This is not a durable encrypted cleanup proof.
- The standalone synthetic workflow uses pinned actions/Node/image,
  `ubuntu-24.04`, no production credentials/environments, no R2 or artifacts,
  bounded work/cleanup deadlines, and a separate always-run absence check.
  Docker-inspection failure cannot appear clean through empty stdout.

The source/CLI/snapshot corrections remain local alongside the pre-existing
recovery changes. The separate remote test branch contains only the new
maintenance modules/tests and synthetic workflow; it does not replace or publish
the rest of the local recovery work.

## Verification and independent review

- Baseline recovery tests: 347/347 PASS. Current local recovery suite: 369/369
  PASS; `npm run lint` PASS; Python secret-transfer suite 7/7 PASS.
- Routing validation FAIL: the personal Lead configuration uses `high`, while
  policy requires `low`; the corresponding actual-configuration unit check fails
  (11/12 routing unit checks pass). No personal/global setting was changed.
- Independent reviewer `maintenance_feasibility`, tier 5, requested
  `gpt-6.1-sol/high`: bounded code and source/snapshot review PASS, production
  readiness BLOCKED. Review found and fixed overly broad acceptance of terminated
  process failures, insufficient cleanup deadline margin, and an independent
  cleanup shell expression that could hide failed Docker inspection. Latest
  independent snapshot/hosted-pair checks passed; no model escalation.
- The first source/snapshot integration run exposed a wrapper fixture that did
  not forward verified transport identity; corrected before the passing run.
- Exact remote candidate `5d78f3147e94cc96c236e69ae074dd84e383730d` was downloaded
  independently of this dirty checkout: 24 recovery-module blob hashes verified,
  and the 18 hosted-pair unit checks passed against that dependency tree.
- First hosted synthetic run
  [40499935863](https://github.com/qrtman/adaptive_lifting/actions/runs/40499935863),
  commit `83844011d122d1de2e9b0422a520223e858178b9`: 18 unit checks PASS, image pull
  PASS, real fault drill FAIL, independent owned-container cleanup PASS. Generic
  diagnostics did not identify its stage. The bounded correction forces psql to
  observe the terminated backend before requiring a confirmed failed process
  exit, and adds hardcoded failure-stage telemetry without native diagnostics.
  The original failure cause is not asserted as proven.
- Corrected hosted run
  [40500385203](https://github.com/qrtman/adaptive_lifting/actions/runs/40500385203),
  commit `2ef3ce1af65cbd92f8c03f113a1fa7e8682840f3`: **PASS**, 2026-10-27
  12:00:26–12:00:58 UTC. All 18 unit checks, actual PostgreSQL negative controls,
  and the independent owned-container absence check passed. The emitted result
  is `synthetic-negative-controls-verified`, with `captureAllowed:false`.
  This verifies the counterexamples, not a working production maintenance fence,
  durable encrypted cleanup, hosted pooler admission or production recovery.
- Local Docker Linux engine is unavailable; it was not reconfigured. Standard
  hosted runners are free for public repositories under the current
  [GitHub billing rule](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
  That rule does not establish free R2 operation or full rehearsal consumption.
- Actual model token/billing counters are unavailable. Review retries and both
  hosted attempts remain part of this task's evidence, not production success.

## Required next gate

Independently verify a complete writer/consumer inventory, effective connection
admission and pooler drain, already-dispatched worker completion, sequence safety,
and encrypted durable cleanup armed independently before any committed pause.
Advisory ownership alone, equal sequence samples, read-only defaults, disabled
cron, and `NOLOGIN` alone cannot satisfy that gate. Do not wire placeholders to
production or add sequence DDL under this unchanged-schema choice.

The reviewed release inventory/prerequisite package, Vault ciphertext/original-
root/application-dependency recovery, full-path hosted capture/retrieval, two
independent restore targets and measured RPO/RTO also remain incomplete. No
production mutation, backup, root retrieval, key provisioning, storage write,
enablement change, daily scheduling, retention, DNS change, public cutover or
launch was performed. Owner-only rehearsal and full P0 remain unpassed.

