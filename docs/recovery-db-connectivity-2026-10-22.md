# Production recovery database connectivity — 2026-10-22

**Result: PASS for hosted source connectivity only. Owner-only recovery rehearsal: NOT TESTED.**

The owner authorized testing the existing protected database password. The
manual-only workflow ran on a standard GitHub-hosted `ubuntu-24.04` runner after
the owner approved the `production-recovery` environment. The public repository
and standard runner establish free runner use for this bounded test; this is not
a capacity assessment for the full recovery drill or R2.

## Accepted evidence

- Workflow: [recovery-db-connectivity.yml](../.github/workflows/recovery-db-connectivity.yml).
- Successful run: [39770197340](https://github.com/qrtman/adaptive_lifting/actions/runs/39770197340).
- Workflow commit: `98cbb420675393ba4af27f6e6444c5113c35cdab`.
- Job: `119795515643`, completed successfully from 11:24:10 to 11:24:14 UTC.
- Reviewed changes: [PR #43](https://github.com/qrtman/adaptive_lifting/pull/43)
  and [PR #44](https://github.com/qrtman/adaptive_lifting/pull/44).

| Check | Result |
| --- | --- |
| Saved `RECOVERY_DB_PASSWORD` authentication | PASS |
| `RECOVERY_DB_CA_PEM`, certificate chain and hostname (`sslmode=verify-full`) | PASS |
| Client TLS connection | PASS |
| Expected database and database role | PASS |
| PostgreSQL major version 17 | PASS |
| Read-only transaction, explicitly rolled back | PASS |
| Normal completion and tmpfs temporary-file cleanup | PASS |

The job logged only Boolean assertion results and a fixed success message. It
used the pinned production Session Pooler on port 5432. The password was passed
through the client environment without URL encoding, rather than embedded in a
connection URL or command argument. GitHub secret values were never read back.

## Safety and review

The three-minute job receives only the database password and CA. It has empty
GitHub token permissions, no checkout, external actions, uploads, artifacts,
schedule or retention operation. Connection, query, lock and subprocess timeouts
bound the test. The query reads connection metadata only; it reads no application
rows, Vault payloads or encryption roots and issues no database writes.

The CA file is restricted to runner tmpfs. Normal cleanup passed. Abrupt runner
termination cannot guarantee execution of the Python cleanup handler; this test
does not establish recovery cleanup after interruption.

Independent verifier `connectivity_safety_review`: tier 5, requested
`gpt-6.1-sol` / high, static security review PASS for both workflow revisions.
No escalation; actual usage was unavailable. Embedded Python syntax, routing
validation, whitespace checks and local success/failure/redaction fixtures passed.
The review's locale recommendation was applied (`LANG=C`, `LC_ALL=C`).

## First attempt and correction

[Run 39769321212](https://github.com/qrtman/adaptive_lifting/actions/runs/39769321212)
authenticated and completed read-only SQL, but failed a combined assertion that
included `pg_stat_ssl` for the backend session. Behind the Session Pooler, that
query does not establish the client TLS state. PR #44 switched to captured,
unprinted `psql` client connection metadata and separate Boolean database checks.
The corrected hosted run passed every assertion. The initial failure is retained
as test history, not counted as a successful run.

## Remaining acceptance

This test did not capture, encrypt, upload, retrieve or restore production data.
It did not verify Vault/application encryption dependencies, migration/catalog
reconciliation, maintenance/quiescence, sequence safety, failure notifications,
key custody, isolated restore behavior or interruption cleanup. It did not activate
the prepared capture/restore jobs, daily scheduling or remote deletion.

RPO ≤24 hours and database RTO ≤4 hours remain unmeasured. The four-second job
duration is a connectivity-test duration, not recovery time. Full-service recovery
and recovery without the owner's access remain unproven; the original full P0
alternate-custodian requirement remains unsatisfied.
