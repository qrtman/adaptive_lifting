# Historical empty-database bootstrap evidence

> **HISTORICAL / NOT THE PRODUCTION LAUNCH PROCEDURE.** Production project
> `gadusaizqnshxqcckibq` is already initialized and all 63 migrations are
> applied and validated. Never run bootstrap, `-Apply`, or migration replay
> against production or staging. The guarded tooling and evidence below are
> retained for audit and for a separately approved, genuinely empty future
> target only. Current state: [production status](../../docs/PRODUCTION_STATUS.md).

This directory contains executable database foundation tooling. Its history
includes an explicitly authorized production initialization. That work is
complete; this file is not authority to connect to or change production. The
confirmed production domain is `app.goatedmethod.me`; no domain or project
origin belongs in the schema artifact.

## Artifact and provenance

`application.sql` establishes **35 tables, 289 columns, 93 constraints, 93
indexes, and one owned sequence** immediately before the first Supabase SQL
migration. It is generated from `backend/migrations/schema_0001.py` and the
empty-install DDL in Alembic `0002` through `0011`. The `0001` legacy adoption,
pattern backfill, and accessory data conversion affect no rows in an empty
database and are not run. The artifact has no data, Alembic stamp, passwords,
JWT keys, provider configuration, staging secrets, or runtime login password.

The generator does not import `backend.database`, load `.env`, instantiate an
application engine, or call `Base.metadata.create_all()`. Tests inspect the
retained SQLAlchemy classes offline to confirm column/type/nullability parity.
The baseline deliberately uses the **historical `sync_mutations(mutation_id)`
primary key**; migration `20261002181756` changes it to the device-scoped key.
Later columns, `telegram_link_tokens`, RPCs and role grants are not preloaded.

The bootstrap requires an empty `public` application schema, fails on any
existing table/view/sequence, and executes transactionally. Existing databases
and data imports need separate procedures. Managed default grants to browser
roles are explicitly revoked without changing the historical RLS state.
Synthetic historical-data mapping and offline-queue compatibility rehearsal is
documented in [`IMPORT_REHEARSAL.md`](IMPORT_REHEARSAL.md); it uses fake data
only. The owner has finalized a fresh production launch: this importer and its
evidence are archived engineering tools, not production launch steps. No
historical accounts, sessions, workout data, billing state, provider secrets,
or queued jobs are to be imported.

## Reproduce locally

Requirements: Docker Engine/Desktop running, Linux containers, Python 3.11+,
and sufficient local disk/RAM for the image. No host `psql` is needed.

From repository root (PowerShell or a Unix shell):

```text
python -m pip install -r supabase/bootstrap/requirements.txt
docker pull supabase/postgres@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00
python supabase/bootstrap/generate.py --check
python supabase/bootstrap/test_schema.py
python supabase/bootstrap/replay.py --evidence supabase/bootstrap/verification-strict.json
```

The four historical files previously contained a literal backslash followed
by `n` at EOF, outside SQL. Only those exact two bytes were removed after
matching the hash-pinned diagnostic manifest. The byte-for-byte source changes,
original and corrected hashes, preserved BOMs, and unchanged migration IDs are
recorded in `sql-eof-correction-audit.json`. Each Git blob before correction is
available in Git history. No executable SQL or database migration record changed.

`replay-repair.json`, `verification-strict-before-eof-fix.json`, and
`verification-repaired.json` are retained as historical evidence of the
original defect and diagnostic run. The replay tool has no repair flag or SQL
rewriter. It rejects any migration whose last non-whitespace bytes contain a
literal `\n` token, then sends each checked-in migration file to `psql` as
original bytes. Regenerate the canonical baseline with `python supabase/bootstrap/generate.py`, then repeat the strict checks above.

Each replay invocation creates **two independent empty clusters**, each with database
name `postgres` (required by historical CONNECT grants and pg_cron), applies
prerequisites then the baseline, and replays every migration in lexical order.
The first 62 files are compared with the retained staging catalog snapshot before
the new forward-only workout-revision migration is applied. That later migration
adds server-issued revisions to workouts, exercises, and exercise sets; the
resulting catalog delta is intentional and is not represented as staging parity.
Each migration receives its own transaction with `ON_ERROR_STOP=1`; input bytes
are streamed without newline conversion or content rewriting. Image entrypoint
initializers are bypassed so no inherited application/managed migration state
is present. No Supabase migration-history rows are fabricated or restamped.

The executable managed workflow is in [`deploy-managed.ps1`](deploy-managed.ps1).
It verifies the authenticated account's exact project reference and either a
matching direct database hostname or the specifically approved production
Session Pooler endpoint, rejects the validated staging ref, and runs
`managed-preflight.sql` before any writes. The preflight requires an empty
`public` application schema, no `al_*` application schemas, empty migration
history, and zero Auth users/identities/sessions, Storage objects/buckets, or
Cron jobs when those managed tables exist. Its default mode performs only
those checks. `-Apply` requires a private checkpoint directory outside the
repository and typed confirmation of the project ref before applying anything.

The ordered application procedure is: create the protected checkpoint, run
the pinned CLI's explicit-URL dry run and validate all 63 versions before any
SQL write, apply managed prerequisites, apply explicit `application.sql`, then
use the isolated temporary Supabase CLI workdir containing only these 63
migration files for migration-list inspection, a second dry run, strict
version-set assertion, `db push --skip-vault`, exact ledger version assertion,
managed postflight, and rollback-only core database checks in `test_behavior.sql`.
The production core file uses explicit relationship IDs because PostgreSQL
sequence increments survive rollback. The local harness separately checks
sequence advancement in `test_sequence_behavior.sql` and runs
`test_realtime_policy.sql` against its Realtime SQL fixture, which supplies a
default partition. Production SQL verification does not depend on
service-created Realtime partitions; live private-channel behavior has a
separate authenticated end-to-end procedure.
The deploy script deliberately does not use `--include-all`, seed files,
`migration repair`, or automatic reset. It stops on any mismatch and requires
a forward recovery review; rerunning from an already nonempty schema is
refused. For a future preflight-only check:

The workflow pins Supabase CLI `2.120.0` and validates the version before any
database writes. This version rejects `--project-ref` when `--db-url` is used,
so the migration list, dry-run and push commands select the target only by the
validated, password-free production Session Pooler URL. They omit
`--project-ref` and `--linked`; an isolated temporary workdir also prevents
fallback to the repository's staging link. `PGPASSWORD` is inherited from the
locally entered `SUPABASE_DB_PASSWORD` value; neither variable is placed in a
CLI argument or database URL.
Compatibility was checked with the actual v2.120.0 CLI: the combined
`--project-ref`/`--db-url` form returns `MigrationTargetFlagsError`, while
password-free `--db-url` migration listing and a dry run of all 63 migrations
succeeded against an isolated disposable PostgreSQL database using inherited
`PGPASSWORD`. No managed project was contacted during this check.

```powershell
.\supabase\bootstrap\deploy-managed.ps1 -ValidateFilesOnly
```

The production-specific invocation, credentials, and connection details have
been removed from active instructions because initialization is complete. Do
not use this document to connect to or mutate that target. Any future
empty-database bootstrap requires a newly reviewed exact-target runbook and
separate authorization. The old `-Apply` guard does not make it an appropriate
production launch step now.

These checkpoints are evidence only, not independent backups. Production
backup and restore are unresolved; see
[`docs/PRODUCTION_STATUS.md`](../../docs/PRODUCTION_STATUS.md).
## Completed API-only release reference

The initial production API-only release is complete. The old pre-deployment
secret, database, and smoke-test checklist has been removed because it is
superseded. See [`docs/PRODUCTION_STATUS.md`](../../docs/PRODUCTION_STATUS.md)
for recorded results and [`supabase/PRODUCTION_CUTOVER.md`](../PRODUCTION_CUTOVER.md)
for the remaining release path. Do not use this bootstrap document to provision
secrets, alter roles, or deploy the API.
## Managed dependencies and limits

`managed-prerequisites.sql` is the ordered prerequisite artifact: `extensions`
schema, real pgcrypto, Vault, pg_cron and pg_net extensions, existing Supabase
roles, and service-owned Realtime objects. It validates extension placement,
database name, and Vault encryption/decryption with a random probe deleted
within the transaction. **Do not install `local-managed-fixture.sql` on a
managed Supabase project.**

The local pinned Supabase Postgres image runs PostgreSQL 17.6, matching the
inspected staging major/minor. It provides real Vault 0.3.1 and pg_cron 1.6.4.
Its pg_net is 0.20.3; inspected staging is 0.20.4. The local Vault library needs
preloading and a getkey script: the harness generates a new private random
root key in temporary memory-backed storage for each run. No key is printed,
checked in, reused, or copied from a managed project. Cron jobs are registered
but automatic execution is disabled; pg_net has no external network.

The Realtime server normally creates `realtime.messages` and `realtime.topic()`;
managed partitions may not exist until a WebSocket client connects. The harness
supplies their required SQL interface as a clearly marked fixture, including a
default partition, and tests the real PostgreSQL RLS policy in
`test_realtime_policy.sql`. Production's `test_behavior.sql` checks core
database constraints and grants without reading or writing `realtime.messages`
or consuming sequence values. Use `managed-realtime-inspect.sql` for read-only
inspection of the managed table, partition metadata, policy, role, and grants.
The local harness does **not** run Realtime WebSocket delivery, managed
partition retention, Auth, PostgREST, Edge Functions, Cron dispatch, or provider
calls. Passing SQL replay is not full managed-service E2E. See
[`PRODUCTION_REALTIME_E2E.md`](PRODUCTION_REALTIME_E2E.md) for the separate live
test procedure and its authorization prerequisites.
No plaintext substitutes for Vault, pg_net, or Cron are used.

## Verification evidence

`staging-catalog.json` was collected through read-only `pg_catalog` inspection
of staging ref `admyuepbbtstayaydjmo`. `catalog.sql` exports application schema
definitions only: no user rows, Vault values, sequence current values, passwords,
or credentials. `alembic_version` and extension-owned tables are excluded;
schema ownership and environment-specific ACL identities are not part of the
structural comparison. Historical bootstrap generation does not use this final
catalog as an input.

Evidence recorded on 2026-10-09:

| Check | Result |
| --- | --- |
| Deterministic generation and retained-model parity | PASS |
| Python schema/regression tests | 11 passed (10 existing plus EOF/hash regression) |
| Baseline structural validation in two independent clusters | PASS; identical catalogs |
| Reject bootstrap on nonempty schema; preserve catalog | PASS |
| Roll back an SQL file ending in an invalid psql command | PASS; no partial schema persists |
| Strict byte-for-byte replay, two invocations; two databases each | PASS; 63/63 in all four databases |
| Baseline repeatability across clean databases | PASS; exact match |
| Final schema repeatability across clean databases | PASS; exact match |
| Final application catalog versus read-only staging snapshot | PASS; exact match |
| SQL behavior tests, failed-file rollback, literal-EOF guard | PASS |
| Original 62-migration staging catalog | 36 tables, 299 columns, 96 constraints, 98 indexes, one sequence |
| Local final catalog after migration 63 | 36 tables, 302 columns, 99 constraints, 98 indexes, one sequence |
| PK/FK/unique/check/default/sequence behavioral checks | PASS |
| Device-scoped idempotency and browser-role denial | PASS |
| Realtime SQL policy, valid topic vs mismatched identity | PASS; fixture only |
| Full managed-service runtime equivalence | NOT TESTED |

Machine-readable 63-migration evidence is in `verification-revisions.json`;
`deploy-managed.ps1` pins every migration and the bootstrap hash against it and
also verifies the first 62 files against the preserved `verification-strict.json`
staging-parity checkpoint. Historical failure evidence is retained in `verification-strict-before-eof-fix.json`,
`verification-repaired.json`, and `replay-repair.json`. Evidence records the
image digest, raw and normalized migration hashes, migration order, schema
hashes/counts, comparison result and cleanup. The correction-level old/new raw
and normalized hashes are in `sql-eof-correction-audit.json`.
Future migration application must use the new empty-target guard; production
project provisioning and cutover are not authorized here.

## Historical recovery preparation notes

The requirements below are generic recovery considerations, not an approved backup provider or implementation. The method remains undecided; see the [production status](../../docs/PRODUCTION_STATUS.md) before taking action.


Choose the production Supabase plan and retention requirement before provisioning.
Supabase documents daily managed database backups on paid plans and PITR as a
paid add-on; confirm exact project availability, retention, download/restore
behavior, and cost in the selected account before relying on it. Keep an
independent encrypted logical export on a separate owner-controlled storage
location. A restore drill must target an isolated project with matching
PostgreSQL/extensions, verify the migration ledger and catalog, then reconcile
row counts and domain invariants. Keep Cron disabled or its jobs unscheduled
until webhook/outbox destinations and Vault are verified; restored network jobs
can produce external effects. Separately preserve the Vault root key and
required application encryption/signing keys when choosing a logical restore
path. Supabase's logical dump and project-restore procedures have different
coverage; a schema-only pre-bootstrap checkpoint is not a substitute for a
tested production backup/restore. No plan, PITR add-on, backup or restore was
provisioned or exercised by this task.
