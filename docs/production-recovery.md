# Production backup and recovery

**Status, 2026-10-15: recovery is BLOCKED / NOT TESTED.** No production backup,
secret export, restore, scheduler, provider request, or remote change was performed
for this document. A successful dump command, schema checkpoint, or migration
replay does not establish recoverability. The hosted-runner + Cloudflare R2 route
below is a candidate only; it has not been authorized, configured, cost-tested,
or exercised with production data.

The current assigned production target is `gadusaizqnshxqcckibq`, already initialized
with the 63 migrations. **Do not bootstrap it, reapply those migrations, repair its
ledger, reset it, or restore into it.** Older “project not provisioned” wording in
the architecture and launch runbook predates this state. The historical database,
backups, and WSL distribution are separate and remain untouched.

## Task and boundaries

Task: implement a cloud-only encrypted backup and isolated restore path for the
Supabase Free production database. The owner's PC holds code and runbooks only;
production database contents, restored databases and backup keys stay off the PC.

Source of truth:

- `architecture.md` sections 5, 7, 9, 11.5, 14, and 15.2–15.6: canonical data,
  tombstones/revisions, authorization, idempotency, integrations, and recovery.
- `design.md` section 10: preserve offline mutations and show conflicts/rejections.
  This work adds no UI.
- `supabase/bootstrap/README.md`, `replay.py`, `managed-postflight.sql`,
  `catalog.sql`, and `PRODUCTION_CUTOVER.md`: existing isolation and verification
  patterns. The importer is historical tooling and is not a recovery procedure.

Scope: this document and `scripts/recovery/` synthetic rehearsal code/template.
No bespoke encryption, production connection, local Docker execution, Windows
policy change, commit, workflow publication or cloud execution is authorized here.

Required operational states: pending, running, failed, verified, and overdue must
be distinguishable. A missed backup never appears successful because a previous
artifact exists. Unreadable keys, incomplete uploads, unexpected schemas, identity
mismatches, restore errors, and reconciliation failures stop the operation.

Acceptance: recover a complete encrypted point into an isolated disposable target;
reconcile its data/security state; test core behavior and key compatibility; measure
RPO/RTO; retain evidence. Only then may that point receive PASS.

## Hosted execution requirements

Local PostgreSQL, Docker, disks, WSL and encryption tools are outside this recovery
path. Their availability is not a launch prerequisite. Do not start local Docker,
install local database tools, change Windows controls, or bring production contents
onto the workstation to run this drill. Local checks are limited to source-code
validation and pure unit tests without database or encryption-key material.

The rehearsal requires an ephemeral GitHub-hosted Linux runner with Docker and
checksum-pinned `age`. Production capture additionally requires explicit source
data-handling approval, isolated storage permissions and independently recoverable
key custody. The bootstrap checkpoint remains catalog evidence, not a backup.

The existing harness pins this Supabase PostgreSQL image:

```text
supabase/postgres@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00
```

It uses PostgreSQL 17 and Vault/Cron/pg_net. The production server and extension
versions must still be measured during an authorized backup. Do not assume this
image matches a later server or silently substitute an unpinned tag. Any image
pull/container execution belongs exclusively on the approved hosted runner.

### Synthetic implementation checkpoint

`scripts/recovery/synthetic-drill.mjs` is a synthetic-only rehearsal, with pure
unit tests in `synthetic-drill.node-test.mjs`. It has no production source, credential,
R2 upload or scheduler mode. Its runtime guard rejects a local/self-hosted runner.
The workflow template `scripts/recovery/synthetic-drill.workflow.yml` is deliberately
outside `.github/workflows`, so preparing it does not activate automation.

After review and explicit commit/publication approval, copy that template to
`.github/workflows/synthetic-recovery.yml` on the default branch. Manually dispatch
it there; no secrets are needed. It downloads checksum-pinned age and the
digest-pinned database image on the cloud runner. It generates synthetic fixtures
and an ephemeral encryption identity, encrypts a custom-format dump, decrypts and
restores into a second network-isolated database, reconciles the fixtures, and
cleans up. No fixtures, keys or archives are uploaded as GitHub artifacts.

Local verification command (code-only; safe on the development PC):

```text
node --test scripts/recovery/synthetic-drill.node-test.mjs
```

Hosted execution remains NOT VERIFIED until observed. Even a successful run proves
only the synthetic transport/restore mechanics; application catalog/permissions,
R2 retrieval, real production capture, Vault/key recovery and full data consistency
remain separate gates before production recovery can PASS.

Local checkpoint, 2026-10-15: seven Node unit tests PASS; JavaScript syntax and
workflow YAML/manual-trigger/permission checks PASS; direct invocation on the PC
rejects execution with exit 1 before tool invocation. These checks created no
database, encryption identity or backup artifact and do not prove a hosted restore.

## Backup contract and ownership

Name a primary operator, alternate, alert destination, backup location, and key
custodian before public writes. Run a nightly backup and retain **at least 14
complete restore points**. Target RPO ≤24 hours and RTO ≤4 hours, including
download, key retrieval, restore, verification, and controlled service recovery.
Measure these; they are targets, not current evidence.

Supabase recommends off-site exports for Free projects; downloadable managed
backups cannot be assumed. Database backups do not contain Storage object bytes.
See [Supabase backups](https://supabase.com/docs/guides/platform/backups).

A Windows machine that may be off cannot provide unattended nightly coverage.
The owner does not have a protected local destination for production contents, so
do not stage production plaintext or restore data on that PC. An off-PC runner and
alerting destination are required for unattended operation. This document creates
no scheduler or cloud resource. Check measured dump size, transfer, retention
capacity, and current quotas before choosing a storage/runner arrangement; a free
tier is not evidence of zero charges.

### Candidate: ephemeral GitHub runner + private Cloudflare R2

Read-only inspection found an existing Cloudflare R2 bucket named
`goatedmethod-production-backups`, in APAC, Standard storage, with public `r2.dev`
access disabled and no custom domain. Its object contents have not been inventoried;
do not assume it is empty or inspect/delete unrelated objects. Any future artifacts must
use a newly agreed, exclusive production prefix and collision-resistant names.
No bucket configuration, access credential, or object was changed or read for this
proposal.

GitHub-hosted Actions runners can provide the off-PC disposable environment. This
means GitHub temporarily processes production plaintext during capture and restore;
encryption at rest in R2 does not remove that processing exposure. Use only a
manually dispatched, default-branch-only workflow initially, with no pull-request
trigger, no untrusted checkout/ref, tightly scoped Actions environment secrets,
protected default branch, redacted logs, and a pinned PostgreSQL tool/container
image. Production secrets and data require owner acceptance of GitHub as a data
processor and verification of branch/environment protections. The synthetic-only
workflow template contains no production credentials and processes no real data.

The intended data path is a consistent read-only logical snapshot streamed directly
through authenticated client-side encryption to the private R2 prefix; avoid writing
plaintext dumps to runner disk. The temporary runner still handles plaintext in
process memory, so this is a material trust decision. Keep the decryption identity
outside R2 and the repository, with an independently recoverable owner-controlled
copy. A restore drill would download ciphertext, decrypt only inside the ephemeral
runner, and restore into a digest-pinned Supabase PostgreSQL container with Docker
network disabled, no published ports or mounts, and Cron consumers disabled before
SQL restore. It must prove that no app worker, provider client, `pg_net` request, or
scheduled consumer can send external effects.

Initial capture and isolated restore should be manual and synthetic first. Only
after a real production-point restore passes all reconciliation gates should an
owner authorize nightly scheduling and retention. R2 Standard currently includes
10 GB-month storage and free internet egress; additional Standard storage is
currently listed at $0.015/GB-month. Actual archive size, other bucket use, request
counts, and account billing status are not yet measured, so neither $0 nor capacity
is guaranteed. Recheck current pricing/usage before enabling automation. Use a
separate R2 credential with the minimum supported bucket/operation permissions;
do not assume ordinary bucket tokens enforce a prefix boundary. Verify prefix
restrictions are technically enforced, or use a dedicated bucket before giving a
future job write/delete access. Do not reuse account-wide credentials.

If GitHub is not an acceptable temporary processor, this option is rejected. A
Supabase-managed paid backup/clone path can keep data within Supabase services, but
its current plan eligibility, restore isolation, Cron/`pg_net` side effects, Vault
key handling, and cost need separate verification before selection; native project
clone is not automatically a safe substitute for the isolated restore drill.

Keep backups outside the project/database failure domain, under a dedicated
production path with least-privilege access. Keep an independent encrypted copy.
Never delete the newest known verified point to make room for an unverified one.
Apply retention only after a complete new point is uploaded and readable. Keep
enough overlap for failures and avoid including staging or historical backups in
the production retention rule.

## What a complete restore point contains

| Artifact | Required contents and treatment |
| --- | --- |
| Application archive | One consistent logical archive of `public`, `al_private`, and `supabase_migrations`; all application rows, private routines, tables, sequence state, constraints, indexes, triggers, grants, policies, and exact migration records |
| Dependency/security manifest | PostgreSQL/extension versions and schemas; custom role attributes/memberships; ownership/default privileges; application-owned Realtime policy/publication definitions; any dependencies outside the three archived schemas |
| Snapshot reconciliation manifest | Every included table and column, row counts, deterministic row digests, FK/unique invariants, migration versions, catalog hashes, sequence values/ownership, revision/tombstone/idempotency/outbox state |
| Release/configuration record | Reviewed commit, build/public configuration, Edge function artifacts and private configuration identifiers, Data API disablement, origins/cookie contract, provider enablement state, worker schedules and operational owner |
| Separately protected recovery secrets | Archive decryption identity plus the original application signing/encryption material and required Vault values, recoverable through an authorized secret manager; never values in this document or ordinary evidence |
| Storage/object export, if used | Object bytes and metadata reconciled to the database point; “not used” requires a measured inventory, not an assumption |

New schemas, extension configuration tables, large objects, or application-owned
objects outside the archive scope must be explicitly covered or the backup fails
its completeness gate. Managed Supabase service schemas are not interchangeable
with the local SQL fixture. Custom application auth is in `public`; exporting only
Supabase Auth users would miss the application accounts and sessions.

The application archive deliberately does **not** claim to back up Vault or the
managed platform. Application payload keys and other required configuration must
be escrowed separately under the owner's existing secret-management process and
tested for compatibility. If instead retaining encrypted Vault rows, design and
test that additional archive explicitly and retain its original project root key.
Vault ciphertext alone is insufficient; a new project's root key differs. Current
[Supabase restore guidance](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
documents this dependency. Key retrieval/copy is secret access and, for a new
managed target, a remote mutation requiring exact authorization. Never overwrite
an unrelated project's root key or print decrypted Vault rows.

Do not rotate application encryption keys merely to make a restored project start.
Verify existing provider/outbox ciphertext can be decrypted without logging the
plaintext or sending a message. Decide deliberately whether app sessions and
offline/Realtime signing keys are preserved or revoked. Requiring reauthentication
is preferable to bypassing session checks; it does not recover unsynced browser
mutations. Browser IndexedDB queues are outside the database backup and must be
preserved for explicit conflict review.

## Authorized backup procedure

These are operator requirements, not authorization to connect now. A future
operation must name the exact source, read permissions, data/key handling, runner,
off-site destination, and retention actions. For the assigned source, the existing
guarded connection identity is:

```text
project: gadusaizqnshxqcckibq
host: aws-0-ap-northeast-2.pooler.supabase.com
port: 5432 (Session Pooler; not transaction port 6543)
user: postgres.gadusaizqnshxqcckibq
database: postgres
```

1. Use an administrator-approved `pg_dump`/`psql`/`pg_restore` version matching the
   server major version and record exact versions/hashes. Discover supported flags
   with `--help`. Verify TLS certificate/hostname with the platform's trusted CA
   and `sslmode=verify-full`; do not silently fall back to unverified TLS.
2. Confirm source identity and expected migration versions before reading data.
   Supply passwords through the approved secret mechanism, never connection URLs,
   command arguments, transcripts, logs, committed files, or chat. Clear temporary
   process credentials after completion. No use of the repository's staging link.
3. Execute only on the approved ephemeral hosted runner. Stream archive bytes
   directly through authenticated encryption; use restricted temporary runner
   storage only for ciphertext and necessary protected ephemeral keys. Plaintext
   restored database files reside in container tmpfs. Account for runner memory,
   swap and crash artifacts in the approved processor's handling contract. Never
   use a workstation, self-hosted PC runner or synced local directory.
4. Inventory dependencies and capture one exported transaction snapshot; keep the
   exporting read-only repeatable-read transaction open while `pg_dump --snapshot`
   and all row-count/digest queries import it. Capture tables in deterministic
   primary-key order with a lossless typed representation, explicit NULL handling,
   stable timezone/encoding/float settings, and bounded streaming hashes. Include
   all rows, including tombstones, sessions, receipts, and queued/leased jobs.
   Counts taken later from the live database are not valid comparison evidence.
5. Produce a custom-format application archive with explicit schema allowlist,
   `--strict-names`, `--snapshot`, and `--file`; preserve object owners/ACLs in the
   archive. Check each native exit status and stderr separately; native errors do
   not reliably become PowerShell exceptions. Use `pg_dump --file` or binary-safe
   process streams, never a Windows PowerShell text pipeline for archive bytes.
   A schema-only or data-only file cannot substitute for this point.
6. Sequence increments are nontransactional. Record and validate sequence state
   explicitly, allowing only a safe forward next value above retained IDs; never
   reset backwards. For an exact final incident/cutover point, separately authorize
   and verify a complete write/worker freeze before capturing sequence state.
7. Inspect the archive table of contents and reconcile it to the inventory before
   accepting the point. Use a maintained, approved authenticated encryption tool
   such as `age` with an escrowed identity and public recipient; no custom cipher.
   Encrypt archive plus sensitive manifests/logs. The decryption identity stays
   separately protected and must not accompany the uploaded ciphertext.
8. Verify ciphertext size/hash after upload; retrieve it independently and verify
   authenticated decryption and original archive hash in the protected workspace.
   Record completion time, snapshot time, bytes, tool versions, non-secret key ID,
   and artifact hashes. Mark it **captured, restore unverified** until the drill
   below passes. Only then perform the scoped retention step.

PostgreSQL documents consistent dump snapshots and version constraints in
[pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html). The final
operator commands are intentionally not fabricated here: the working toolchain,
snapshot collector, encryption/secret mechanism, and runner remain unprovisioned
and untested. Do not substitute several independently timed CLI schema/data dumps
and call them one reconciled snapshot.

## Isolated restore drill

1. First validate the complete capture/encrypt/download/decrypt/restore workflow
   with synthetic data, including accounts, linked/unlinked coaches, sessions,
   logs, locks, tombstones, receipts, revisions and queued/leased jobs. Then, under
   explicit data-handling authorization, restore an actual production point. A
   synthetic drill alone does not demonstrate production data/key recovery.
2. Use a fresh dedicated disposable PostgreSQL cluster, never production, the
   shared staging project, or historical WSL runtime. Use the hosted runner's
   digest-pinned Supabase image after version verification. Require Docker
   `--network none`, no published ports, no Docker socket mount, no host network,
   non-root execution, disposable database storage, and no production directories
   mounted. Stage encrypted input read-only; keep plaintext/key material protected.
   Container isolation is defense in depth, not permission to execute an untrusted
   archive in a runner with production credentials. Separate capture and restore
   credentials/jobs before handling real data.
3. **Before loading any archive SQL**, start PostgreSQL with
   `listen_addresses=''`, socket-only access, `cron.launch_active_jobs=off`, and
   the required extension/key-provider configuration. Independently inspect
   Docker network/port/mount configuration and query `SHOW
   cron.launch_active_jobs` to establish the guard. Keep network isolation for
   the whole drill, including inspection and cleanup.
4. Run no API, Edge worker, Python consumer, SMTP server, provider SDK, Supabase
   local service stack, or application browser pointed at this restore. Do not
   set up webhooks, production URL routes, OAuth callbacks or Telegram bots.
   `pg_net` can deliver restored requests independently of Cron; unscheduling jobs
   after restore is too late. Network denial must precede restore execution.
5. Inspect the trusted archive SQL/TOC offline. Restore only into the empty
   disposable target, with `pg_restore --exit-on-error --single-transaction` and
   explicit local socket/user/database. Never `--clean`, `--create`, `--linked`,
   a managed database URL, or implicit `PGHOST`/service defaults. Clear inherited
   source connection environment in restore processes. Resolve managed-extension,
   role, `public` schema, Realtime and ownership prerequisites in a reviewed
   target-only plan. Fail unexpected collisions or unsupported objects rather
   than suppressing errors. Do not replay all migrations over restored functions
   or fabricate/restamp migration history.
6. Restore custom grants and policy semantics faithfully. Any local-only managed
   SQL fixture is explicitly a test substitute; it cannot prove managed Realtime
   or platform behavior. Do not use `--no-acl`/`--no-owner` as a blanket error fix
   without separately reconstructing and checking the exact intended privileges.
7. With isolation still active, inventory restored Cron rows and queued network
   requests without dispatching them. Capture counts/identifiers, not provider
   secrets. Preserve the immutable restored point for reconciliation. A separate
   drill clone may disable restored schedules/quarantine jobs using a reviewed
   target-only transaction; record every deviation. Do not erase queues in the
   verification copy and then claim exact data parity.
8. Reconcile the restored point and run the acceptance checks below. Record wall
   time from recovery request to verified usable state, plus snapshot age at the
   simulated incident. Failed checks retain FAIL/BLOCKED and preserve redacted
   diagnostics. Discard the exact disposable container/volume only after its
   target label/name has been checked; do not recursively delete computed paths.

Restore executes code from the archive, even for a partial restore. Review and
isolation are mandatory; see [pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html).

## Required evidence before PASS

- Every table/column/count/digest matches the captured snapshot, including empty
  tables; no table is silently omitted. FK/unique constraints and indexes are
  valid, numeric values/timestamps are preserved, sequences cannot collide, and
  migration versions/hashes match the backup's reviewed release exactly.
- Catalog, trigger, function, ownership/default-privilege, role-membership and
  policy checks pass. At the current 63-migration release the managed postflight
  expects 36 application tables, 302 columns, 99 constraints and 98 indexes.
  Those counts alone are insufficient; run the matching `catalog.sql` comparison
  and `managed-postflight.sql` against the isolated restore with errors fatal.
- Read-only checks pass first. On a disposable test copy, run the reviewed
  `test_behavior.sql`, `test_sequence_behavior.sql`, and Realtime SQL policy
  checks only where fixture prerequisites are met. The sequence check advances
  state despite transaction rollback; never run it against production. Realtime
  SQL fixtures do not prove WebSocket delivery.
- Verify athlete ownership, active coach shared access, ended-link denial,
  revoked/expired session denial, concurrent-workout lease locks, tombstones, canonical
  numeric math, revision conflicts and idempotent mutation replay. New plans stay
  empty. No legacy importer, demo seed, auto-queue replay or RBAC bypass is used.
- Verify original encrypted payload compatibility inside the isolated process
  without exposing plaintext. Record only success/failure and non-secret key IDs.
  No provider delivery occurs. Evidence distinguishes data integrity, secret
  compatibility and managed platform/browser behavior.
- Verify network isolation and disabled Cron both before and after restore. Record
  no running provider/application consumers, no published ports and zero external
  effects. An empty Cron table alone does not establish outbound safety.
- Record off-site retrieval, encryption authentication, restored row checks, RPO,
  RTO, operator/alternate access and retention results. A second operator must be
  able to locate the point and recover its key through the documented custody path.

Use a redacted evidence record with: drill ID/date, source ref, release and
migration IDs, source snapshot timestamp, encrypted artifact SHA-256/size,
decryption/tool versions, exact isolated target identity and network settings,
per-check PASS/FAIL/BLOCKED/NOT TESTED, durations, discrepancies, reviewer and
cleanup result. Do not include connection passwords, tokens, private keys,
Vault rows, account emails or training rows. No such successful drill record exists
for this task.

## Incident recovery and return to service

Restoring a drill never authorizes restoring production or routing traffic. An
incident action needs an explicit source point, exact new target, maintenance
window, accepted data-loss interval, operator/reviewer and abort authority. Keep
the source preserved. Inventory writes since the snapshot, preserve browser queues
and reconcile them against recovered revisions; a stale backup is not permission
to discard later accepted writes or replay receipts blindly.

Before any recovered environment is network-enabled, reconcile outbox leases,
OAuth state and provider webhook/idempotency records with provider evidence.
An accepted email, Sheets create, or payment after the snapshot may already have
occurred even though the restored database does not remember it. Do not blanket
retry, cancel, truncate or mark jobs successful. Keep dispatch disabled until each
uncertain job has an owner-approved disposition. Use a separately reviewed restore
plan for a managed Supabase target; confirm its Data API remains disabled and
browser roles lack direct table/private-RPC access. Independently validate the
actual platform, restricted runtime credentials, auth, private Realtime, same-origin
cookies, and isolated providers before routing or enabling each consumer.

## Authorization and remaining work

Required next authorization must explicitly cover the exact production **read**
export and sensitive backup/key handling, the off-site destination/runner and its
cost ceiling, and the isolated restore target. Tool installation/allowlisting is an
administrator action; it does not authorize production access. Managed project
creation, secret retrieval/copy, scheduler configuration, provider reconciliation,
return to service and traffic changes need their own exact scope before execution.

Current gaps: hosted synthetic execution, protected workflow publication and
runner authorization, key escrow/alternate access, scoped R2 access, snapshot
collector and production capture implementation, actual encrypted backup,
real isolated restore, managed platform validation, measured RPO/RTO and alerting.
No recovery gate is PASS merely because this procedure has been written.
