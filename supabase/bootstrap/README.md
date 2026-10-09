# Empty-database application bootstrap

This directory contains executable database foundation tooling. It does not
deploy an application, import data, create cloud infrastructure, or connect to
production. The confirmed production domain is `app.goatedmethod.me`; no domain
or project origin belongs in this schema artifact.

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

**Strict replay currently exits nonzero at file 29.** Four historical files
contain a literal backslash followed by `n` at EOF, outside any SQL statement:

- `20261005161820_sessions_replace_exercise_sets_private_rpc.sql`
- `20261005162355_sessions_replace_exercise_sets_encoding_correction.sql`
- `20261005181600_account_security_auth_rpcs.sql`
- `20261005181950_account_security_coach_rpcs.sql`

The source files and migration records are untouched. The expected strict
failure is checked evidence, not a completed unmodified migration replay.
`replay-repair.json` pins each malformed source hash and describes a narrowly
scoped **local diagnostic** removal of that final token. To test all later
SQL statements and compare the resulting catalog, run explicitly:

```text
python supabase/bootstrap/replay.py --reviewed-local-repair --evidence supabase/bootstrap/verification-repaired.json
```

This opt-in mode is not a production migration policy or authorization to
rewrite history. Resolve the source/execution policy transparently before
using the history on any future target. The harness never silently repairs
files. Regenerating the canonical baseline is `python
supabase/bootstrap/generate.py`, followed by the checks above.

Each replay creates **two independent empty clusters**, each with database
name `postgres` (required by historical CONNECT grants and pg_cron), applies
prerequisites then the baseline, and replays the 62 filenames in lexical order.
Each delta runs in its own transaction with `ON_ERROR_STOP=1`. Image entrypoint
initializers are bypassed so no inherited application/managed migration state
is present. No Supabase migration-history rows are fabricated or restamped.

Containers have no external network, no published ports, no host/database
mounts, and a temporary filesystem. Synthetic constraint tests roll back; the
containers and anonymous image volumes are removed on success or failure.
An interrupted process can leave a labeled container; inspect only this
harness's containers with `docker ps -a --filter
label=adaptive-lifting.bootstrap=true`, then remove the explicitly named
disposable container with `docker rm -f -v <name>`.

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

The Realtime server normally creates `realtime.messages` and `realtime.topic()`.
The harness supplies their required SQL interface as a clearly marked fixture
and tests the real PostgreSQL RLS policy. It does **not** run Realtime WebSocket
delivery, managed partition retention, Auth, PostgREST, Edge Functions, Cron
dispatch, or provider calls. Passing SQL replay is not full managed-service E2E.
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
| Python schema/regression tests | 10 passed |
| Baseline structural validation in two independent clusters | PASS; identical catalogs |
| Reject bootstrap on nonempty schema; preserve catalog | PASS |
| Roll back an SQL file ending in an invalid psql command | PASS; no partial schema persists |
| Strict unmodified replay, both clean databases | FAIL at file 29; 28/62 applied |
| Explicit repaired diagnostic replay, both clean databases | PASS; 62/62 applied |
| Final application catalog versus read-only staging snapshot | PASS; exact match |
| Final schema size | 36 tables, 299 columns, 96 constraints, 98 indexes, one sequence |
| PK/FK/unique/check/default/sequence behavioral checks | PASS |
| Device-scoped idempotency and browser-role denial | PASS |
| Realtime SQL policy, valid topic vs mismatched identity | PASS; fixture only |
| Full managed-service runtime equivalence | NOT TESTED |

Machine-readable evidence is in `verification-strict.json` and
`verification-repaired.json`, including image digest, source hashes, migration
order, exact failure, schema hashes/counts, comparison result and cleanup.
Future migration application must use a separately approved empty target;
this work does not authorize production setup or cutover.
