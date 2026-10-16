# Production backup and recovery

**Status, 2026-10-16: production backup, restore, and R2 recovery remain BLOCKED / NOT TESTED.**
A historical hosted synthetic restore run is recorded below. It did not use real
data, production credentials, a production export, provider requests, production
mutations, or R2, and does not establish production recoverability. In this branch,
`scripts/recovery/synthetic-drill.workflow.yml` is an inert reviewed template; no
active workflow exists under `.github/workflows/`. The hosted-runner + Cloudflare R2
production route remains unconfigured, cost-untested, and unexercised with
production data.

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

Scope: this document, the synthetic rehearsal, and the locally tested backup library
components described below. The historical hosted synthetic rehearsal did not
include production credentials or data, R2 access, scheduler setup, provider
requests, or production mutation. This document grants no additional authorization.

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

The synthetic rehearsal runs manually on an ephemeral GitHub-hosted Linux runner
with Docker and checksum-pinned `age`. Production capture additionally requires
explicit source data-handling approval, isolated storage permissions and
independently recoverable key custody. The bootstrap checkpoint remains catalog
evidence, not a backup.

The existing harness pins this Supabase PostgreSQL image:

```text
supabase/postgres@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00
```

It uses PostgreSQL 17 and Vault/Cron/pg_net. The production server and extension
versions must still be measured during an authorized backup. Do not assume this
image matches a later server or silently substitute an unpinned tag. Any image
pull/container execution belongs exclusively on the approved hosted runner.

### Synthetic implementation and historical hosted checkpoint

`scripts/recovery/synthetic-drill.mjs` is a synthetic-only rehearsal, with pure
unit tests in `synthetic-drill.node-test.mjs`. It has no production source, credential,
R2 upload or scheduler mode. Its runtime guard rejects a local/self-hosted runner.
The historical workflow record points to a manually dispatched hosted job with no
schedule or secrets. The current branch contains only the inert workflow template
described above. The historical job downloaded checksum-pinned age and the
digest-pinned database image, created synthetic fixtures and an ephemeral encryption
identity, encrypted a custom-format dump, decrypted and restored into a second
network-isolated database, compared the fixtures, and cleaned up.

The workflow was tested at commit
[`672411717c3cc3ab66c7f104df30f3b8947ab071`](https://github.com/qrtman/adaptive_lifting/commit/672411717c3cc3ab66c7f104df30f3b8947ab071).
Hosted run [38739412498](https://github.com/qrtman/adaptive_lifting/actions/runs/38739412498)
completed PASS on 2026-10-15 at 13:03:24 UTC. All 11 Node unit tests passed. The
synthetic encrypted archive was 8,346 bytes; decryption and corruption rejection,
single-transaction restore, row/revision/tombstone/idempotency/sequence/constraint/
index comparison all passed. The script reported PASS after container and temporary
file cleanup completed. An earlier hosted attempt, [38738650643](https://github.com/qrtman/adaptive_lifting/actions/runs/38738650643),
failed in the synthetic step; its log only exposed a cleanup failure that masked the
original error, so no more specific cause is recorded.

Local verification command (code-only; safe on the development PC):

```text
node --test scripts/recovery/synthetic-drill.node-test.mjs
```

This PASS establishes only the synthetic transport and restore mechanics. The run
did not test the application schema or migration ledger, RLS/authorization, Vault
key recovery, R2 upload/retrieval, production capture, provider reconciliation, or
full production data consistency. Those remain separate gates; production recovery
is still BLOCKED / NOT TESTED.

Historical local checkpoint, 2026-10-15: 11 synthetic-drill Node unit tests PASS;
JavaScript syntax and workflow YAML/manual-trigger/permission checks PASS; direct
local invocation rejects execution before tool invocation. Local checks created no
database, encryption identity or backup artifact and do not prove a hosted restore.

### Backup library checkpoint (2026-10-15)

The next production backup components are libraries under `scripts/recovery/`.
They have no production entrypoint, deployed workflow, configured credentials,
or schedule. Their unit tests use synthetic bytes and mocked processes/database
clients; running those tests on the PC does not create a database or private key.

- `encrypt-stream.mjs`: archive stream to native age with only a public x25519
  recipient. Ciphertext is created exclusively in a private temporary directory;
  the caller owns `cleanup()`. Subprocess and stream failures, timeout, abort, and
  cleanup failure are fatal; sensitive diagnostics are suppressed. No plaintext
  archive file is created. Original archive SHA-256 and byte count are computed in
  the stream for later encrypted-manifest reconciliation. Actual age validation
  remains a hosted integration check.
- `ciphertext-store.mjs`: explicit canonical R2 account endpoint, reviewed bucket
  and production prefix inputs, UUID object names, conditional single-object PUT,
  independent GET and SHA-256/size comparison. It refuses symlink source files and
  local/self-hosted execution. Only ciphertext format is screened; `byteVerified`
  means matching ciphertext bytes, not authenticated decryption or restore success.
  The AWS CLI subprocess uses argv without a shell, isolated configuration/static
  credentials, suppressed output and a timeout. CLI service redirects remain an
  integration review item. No listing, deletion, retention or credential creation
  is implemented. Single PUT is bounded to 5 GiB; larger artifacts fail closed.
- `snapshot-capture.mjs`: an exclusively owned, connected database client must be
  supplied by a future reviewed adapter. It holds one read-only repeatable-read
  exported snapshot until the archive/encrypted-manifest callbacks have completed,
  checks a supplied exact relation inventory and migration version list, disables
  silent RLS filtering, and hashes framed row text without parsing numeric JSON.
  Server-side chunks are at most 16,384 characters (64 KiB UTF-8); client batches
  contain at most 16 chunks. Per-table manifests also capture owner/ACL, RLS flags,
  column types/defaults, constraints, indexes, triggers, and policy definitions;
  incomplete or malformed catalog results fail before archive capture. Sorting can still consume source server resources and
  must be measured. Partitioned/inherited, foreign, materialized or unlogged
  relations fail closed pending a reviewed strategy. A callback must await the
  actual pg_dump exit and encryption, not return only a stream handle. Returned
  status is always `captured-restore-unverified`, never recoverable/PASS.
- `production-source.mjs`: a local, unconnected adapter now pins the production
  session-pooler host, port, project-qualified database user and `postgres`
  database. Its node-postgres TLS config supplies the project CA, requires
  certificate verification and the fixed SNI host, then checks database identity,
  PostgreSQL 17 and `pg_stat_ssl` before exposing the query wrapper. The pinned
  `pg` dependency is isolated to `scripts/recovery/`; it does not affect the app.
  The pg_dump adapter uses a minimal environment with no inherited PG service or
  staging values, exact production host/user/database, `verify-full`, a private
  temporary CA file, `--no-password`, fixed schemas and the exported snapshot.
  It checks pg_dump major version 17, drains but never logs stderr, streams binary
  stdout into the encryption callback, and awaits both native exit and encryption.
  It has no CLI entrypoint or workflow and has not connected to production. The
  source user is privileged; provisioning or using it needs the exact owner
  authorization described below.

These components do **not** constitute a complete production backup implementation.
The per-table catalog snapshot is now present, but still needs validation against
the real PostgreSQL 17 schema and comparison with restored catalog output. Remaining
engineering includes a complete schema/role/extension/sequence inventory, snapshot-to-archive TOC
reconciliation, encrypted manifest bundling and publication/commit marker, a
reviewed protected hosted workflow, authenticated retrieval/decryption, and the
actual application restore checks. Do not enable production capture merely because
the component tests pass. An uploaded object left by a failed run is uncommitted;
its existence is not a successful restore point, and automatic deletion is disabled.

Code-only verification:

```text
node --test scripts/recovery/*.node-test.mjs
```

Current local component checkpoint, verified 2026-10-16: **59/59 Node tests PASS**
across all recovery unit-test files. The synthetic drill imports `encrypt-stream.mjs`
and `snapshot-capture.mjs`; the independent `ciphertext-store.mjs` component
implements the documented R2 ciphertext transfer boundary. The recovery workflow
template runs the complete `scripts/recovery/*.node-test.mjs` suite. These files and
their tests must be included together in any clean checkout that runs the recovery
tests or synthetic drill. The production-source adapter tests use mocked clients/processes
and synthetic CA text on Windows; its Linux file-mode check only runs on Linux.
The prior hosted synthetic integration at commit
[`64d92ac8fc8fac88d9cffc2389687c54f4c9bc50`](https://github.com/qrtman/adaptive_lifting/commit/64d92ac8fc8fac88d9cffc2389687c54f4c9bc50),
hosted run [38743474313](https://github.com/qrtman/adaptive_lifting/actions/runs/38743474313),
on 2026-10-15 at 13:32:22 UTC passed the then-current 46 unit tests, the bounded
PostgreSQL chunk-cursor SQL against synthetic PostgreSQL rows (large UTF-8, duplicate
rows, high-precision numeric, NULL, delimiter and newline values), streaming archive
encryption, authenticated decryption and original archive SHA-256/size comparison,
isolated single-transaction restore, source/restored fixture comparisons, and
container/temp-file cleanup before PASS. The encrypted synthetic artifact was 9,144
bytes. The run used no production credentials, R2, production data, or schedules.
The template remains inert in this checkout. This hosted integration still does not
exercise the production schema, source adapter, catalog/sequence completeness, key
custody, or R2 behavior; production recovery remains BLOCKED / NOT TESTED. The
current working tree extends that synthetic drill to execute and compare the new
relation-catalog query, but this integration check has not run on a hosted runner.

### Cloud-only key custody and activation inputs

The owner confirmed they already use a password manager; its provider and recovery
access procedure have not been supplied. No production encryption identity has been
generated. Before activation, name the
owner and alternate and their independently recoverable cloud password-manager
locations. Generate the identity only through a separately approved cloud procedure
with private output delivered directly to the owner-controlled vault, never chat,
Actions logs/artifacts, source control, R2, or a workstation file. Test alternate
access. A public recipient and non-secret key ID may be supplied to the capture job;
the private identity must not be accessible to that job. A separate protected manual
restore environment receives it only for an authorized recovery drill.

Also choose/verify the dedicated private R2 destination and a bucket-scoped static
credential, GitHub protected environment/default branch and reviewers, pinned
toolchain, and primary/alternate alert destination. A syntactically valid prefix
does not enforce an R2 permission boundary. Creating credentials, setting secrets,
changing bucket protections, publishing a production workflow, and processing
production data each require exact owner authorization; none occurred for this
library checkpoint. Live backup/storage/restore remain BLOCKED / NOT TESTED.

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
processor and verification of branch/environment protections. The published
synthetic-only workflow contains no production credentials and processes no real
data; its successful run does not exercise this production path.

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
[pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html). The source
adapter is a tested library boundary, not an operational capture command. The
release inventory, sequence/catalog collectors, archive TOC reconciliation,
manifest encryption and commit-marker workflow remain unimplemented or untested.
Do not substitute several independently timed CLI schema/data dumps and call them
one reconciled snapshot.

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
for production data; the synthetic hosted result above is not production recovery
evidence.

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
cost ceiling, and the isolated restore target. The source adapter expects the
existing database password only as protected hosted-job input
`RECOVERY_DB_PASSWORD`, plus the project CA bundle as `RECOVERY_DB_CA_PEM`; it
targets only the fixed production session pooler shown above. These inputs have
not been collected or configured. The source user is privileged, so no production
capture can proceed until the owner approves that exact data read and hosted
processing scope. A dedicated read-only backup role would require a separate
review and explicit database-change authorization; none has been created.
Tool installation/allowlisting is an administrator action and does not authorize
production access. Managed project creation, secret retrieval/copy, R2 credential
or bucket changes, key escrow, scheduler configuration, provider reconciliation,
return to service and traffic changes need their own exact scope before execution.

Current gaps: production-specific runner authorization, key escrow/alternate access,
scoped R2 access, complete catalog/sequence/security manifest and archive
reconciliation, actual encrypted production backup, real production-point isolated
restore, managed platform validation, measured RPO/RTO and alerting. The synthetic
backup-component integration PASSes; production recovery remains BLOCKED / NOT TESTED.
