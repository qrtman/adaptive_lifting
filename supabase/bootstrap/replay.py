"""Create two isolated PostgreSQL clusters; replay baseline + untouched migrations.

No DSN argument, host port, external network, real data, or production connection.
Requires Docker and Python 3.11+. Containers and anonymous volumes are removed
even on failure. Every SQL file uses psql ON_ERROR_STOP and each migration runs
in its own transaction. Evidence contains schema only, never Vault rows.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
import uuid

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
IMAGE = "supabase/postgres@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"


def command(args, sql=None, check=True):
    binary = isinstance(sql, bytes)
    result = subprocess.run(args, input=sql, text=not binary,
                            encoding=None if binary else "utf-8", capture_output=True)
    if check and result.returncode:
        raise RuntimeError(f"Command failed: {args[0]} {args[1]}\n{result.stderr}\n{result.stdout}")
    return result


def psql(name, sql, transaction=False, check=True):
    args = ["docker", "exec", "-i", name, "psql", "-X", "-h", "/tmp", "-U", "postgres",
            "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q"]
    if transaction:
        # -1 applies to -c/-f actions; explicitly name stdin as a file action.
        args.extend(["--single-transaction", "--file", "-"])
    return command(args, sql, check)


def snapshot(name):
    return json.loads(psql(name, (HERE / "catalog.sql").read_text(encoding="utf-8")).stdout)


def empty_checkpoint_snapshot(name):
    """Execute the psql-only checkpoint query on an isolated empty target."""
    sql = (HERE / "managed-empty-checkpoint.sql").read_text(encoding="utf-8")
    raw = psql(name, sql).stdout
    catalog = json.loads(raw)
    assert catalog["format"] == "adaptive-lifting-empty-database-catalog-v1"
    assert catalog["database"] == "postgres"
    assert catalog["effective_user"] == "postgres"
    assert int(catalog["server_version_num"]) // 10000 == 17
    assert catalog["migration_ledger"]["exists"] is False
    assert any(row["name"] == "public" for row in catalog["schemas"])
    assert not any(row["name"] == "al_private" for row in catalog["schemas"])
    return catalog, hashlib.sha256(raw.encode("utf-8")).hexdigest()


def compare(actual, expected):
    differences = []
    for section in sorted(set(actual) | set(expected)):
        def keyed(rows):
            return {(r.get("table", ""), r["name"]): r for r in rows}
        left, right = keyed(actual.get(section, [])), keyed(expected.get(section, []))
        for key in sorted(set(left) | set(right)):
            if left.get(key) != right.get(key):
                differences.append({"section": section, "key": list(key),
                                    "local": left.get(key), "staging": right.get(key)})
    return differences


def digest(path):
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def summarized_evidence(evidence):
    """Keep catalog hashes/counts rather than four redundant schema copies."""
    result = json.loads(json.dumps(evidence))
    for run in result["runs"]:
        for phase in ("baseline", "pre_forward", "final"):
            catalog = run.pop(phase + "_catalog", None)
            if catalog is not None:
                serialized = json.dumps(catalog, sort_keys=True, separators=(",", ":")).encode()
                run[phase + "_schema"] = {
                    "sha256": hashlib.sha256(serialized).hexdigest(),
                    "counts": {k: len(v) for k, v in catalog.items()},
                }
    return result


def run_one(number, migrations, evidence, after_replay=None, staging_path=None):
    name = "al-bootstrap-" + uuid.uuid4().hex[:12]
    record = {"database": number, "status": "FAIL", "applied": [], "blocking_file": None}
    evidence["runs"].append(record)
    startup = (
        "set -euo pipefail; umask 077; head -c 32 /dev/urandom | od -A n -t x1 | tr -d ' \\n' >/tmp/vault-root.key; "
        "printf '#!/bin/sh\\ncat /tmp/vault-root.key\\n' >/tmp/vault-getkey.sh; chmod 700 /tmp/vault-getkey.sh; "
        "initdb -D /tmp/bootstrap-db --encoding=UTF8 --locale=C.UTF-8 "
        "--auth-local=trust --auth-host=reject >/tmp/init.log && "
        "exec postgres -D /tmp/bootstrap-db -c listen_addresses='' "
        "-c unix_socket_directories=/tmp -c shared_preload_libraries=pg_cron,pg_net,supabase_vault "
        "-c vault.getkey_script=/tmp/vault-getkey.sh "
        "-c cron.database_name=postgres -c cron.launch_active_jobs=off"
    )
    created = False
    try:
        command(["docker", "run", "-d", "--name", name, "--label", "adaptive-lifting.bootstrap=true",
                 "--network", "none", "--user", "postgres", "--tmpfs", "/tmp:rw,exec,mode=1777",
                 "--entrypoint", "bash", IMAGE, "-c", startup])
        created = True
        for _ in range(60):
            if psql(name, "SELECT 1;", check=False).returncode == 0:
                break
            if command(["docker", "inspect", "--format", "{{.State.Running}}", name]).stdout.strip() != "true":
                logs = command(["docker", "logs", name])
                raise RuntimeError("PostgreSQL exited: " + logs.stdout + logs.stderr)
            time.sleep(1)
        else:
            raise RuntimeError("PostgreSQL startup failed: " + command(["docker", "logs", name]).stdout)
        record["server_version"] = psql(name, "SHOW server_version;").stdout.strip()
        for file in ("local-managed-fixture.sql", "managed-prerequisites.sql"):
            record["blocking_file"] = file
            psql(name, (HERE / file).read_text(encoding="utf-8"))
        record["blocking_file"] = "managed-preflight.sql"
        psql(name, (HERE / "managed-preflight.sql").read_text(encoding="utf-8"))
        record["blocking_file"] = "managed-empty-checkpoint.sql"
        checkpoint_catalog, checkpoint_hash = empty_checkpoint_snapshot(name)
        record["empty_database_checkpoint"] = {
            "status": "PASS",
            "sha256": checkpoint_hash,
            "schema_count": len(checkpoint_catalog["schemas"]),
            "relation_count": len(checkpoint_catalog["relations"]),
            "routine_count": len(checkpoint_catalog["routines"]),
            "type_count": len(checkpoint_catalog["types"]),
            "restorable_backup": False,
        }
        record["blocking_file"] = "application.sql"
        psql(name, (HERE / "application.sql").read_text(encoding="utf-8"))
        record["baseline_catalog"] = snapshot(name)
        # Validate the historical baseline separately before any Supabase delta.
        from test_schema import validate_baseline, validate_final, behavioral_checks
        validate_baseline(record["baseline_catalog"])
        record["baseline_validation"] = "PASS"
        refused = psql(name, (HERE / "application.sql").read_text(encoding="utf-8"), check=False)
        assert refused.returncode and "requires an empty" in refused.stderr
        assert snapshot(name) == record["baseline_catalog"], "Failed rerun changed schema"
        record["nonempty_rejection"] = "PASS"
        failed_delta = psql(name, "CREATE TABLE public.bootstrap_transaction_probe(id integer);\n\\n\n",
                            transaction=True, check=False)
        assert failed_delta.returncode and "invalid command" in failed_delta.stderr
        assert psql(name, "SELECT to_regclass('public.bootstrap_transaction_probe') IS NULL;").stdout.strip() == "t"
        assert snapshot(name) == record["baseline_catalog"], "Failed delta changed schema"
        record["failed_migration_rollback"] = "PASS"
        for index, path in enumerate(migrations):
            if index == 62:
                record["pre_forward_catalog"] = snapshot(name)
                validate_final(record["pre_forward_catalog"])
                if staging_path and staging_path.is_file():
                    staging = json.loads(staging_path.read_text(encoding="utf-8"))["catalog"]
                    baseline_differences = compare(record["pre_forward_catalog"], staging)
                    assert not baseline_differences, json.dumps(baseline_differences, indent=2)
                    record["original_62_migration_staging_parity"] = "PASS"
            record["blocking_file"] = path.name
            # Send the checked-in migration file as bytes, preserving its exact
            # content, BOM, and newline sequence at execution time.
            psql(name, path.read_bytes(), transaction=True)
            record["applied"].append(path.name)
            print(f"database {number}: {len(record['applied'])}/{len(migrations)} {path.name}", flush=True)
        record["blocking_file"] = None
        record["final_catalog"] = snapshot(name)
        if len(migrations) == 63:
            from test_schema import validate_revision_delta
            validate_revision_delta(record["pre_forward_catalog"], record["final_catalog"])
            record["intentional_forward_schema_delta"] = {
                "migration": migrations[-1].name,
                "additions": ["workouts.revision", "exercises.revision", "exercise_sets.revision"],
                "staging_updated": False,
            }
        else:
            validate_final(record["final_catalog"])
        record["structural_validation"] = "PASS"
        behavioral_checks(lambda sql: psql(name, sql).stdout)
        record["schema_tests"] = "PASS"
        record["extensions"] = json.loads(psql(name,
            "SELECT json_agg(json_build_object('name',extname,'version',extversion) ORDER BY extname) FROM pg_extension;").stdout)
        if after_replay is not None:
            record["after_replay"] = after_replay(name)
        record["blocking_file"] = None
        record["status"] = "PASS"
    except Exception as error:
        record["error"] = str(error)
        raise
    finally:
        if created:
            command(["docker", "rm", "-f", "-v", name])
            record["container_removed"] = True


def main():
    if not __debug__:
        raise RuntimeError("Run without -O: schema validation assertions must stay enabled")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", type=Path, default=HERE / "verification.json")
    parser.add_argument("--staging-catalog", type=Path, default=HERE / "staging-catalog.json")
    args = parser.parse_args()
    migrations = sorted((ROOT / "supabase/migrations").glob("*.sql"))
    assert len(migrations) in (62, 63), "Review migration count/order before changing the harness"
    if len(migrations) == 63:
        historical = json.loads((HERE / "verification-strict.json").read_text(encoding="utf-8"))
        assert len(historical["migrations"]) == 62
        current_history = [(p.name, hashlib.sha256(p.read_bytes()).hexdigest()) for p in migrations[:62]]
        pinned_history = [(item["file"], item["sha256_raw"]) for item in historical["migrations"]]
        assert current_history == pinned_history, "One of the validated historical migration files changed"
    malformed = [path.name for path in migrations if path.read_bytes().rstrip().endswith(b"\\n")]
    assert not malformed, f"Migrations must be executed byte-for-byte; invalid EOF escape(s): {malformed}"
    command([sys.executable, str(HERE / "generate.py"), "--check"])
    command(["docker", "image", "inspect", IMAGE])
    evidence = {
        "image": IMAGE, "image_tag": "supabase/postgres:17.6.1.136",
        "source_commit": command(["git", "-C", str(ROOT), "rev-parse", "HEAD"]).stdout.strip(),
        "verified_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "bootstrap_sha256_lf": digest(HERE / "application.sql"),
        "tooling_sources_sha256_lf": {name: digest(HERE / name) for name in (
            "generate.py", "replay.py", "test_schema.py", "test_behavior.sql", "catalog.sql",
            "managed-prerequisites.sql", "managed-preflight.sql", "managed-empty-checkpoint.sql",
            "local-managed-fixture.sql", "replay-repair.json", "sql-eof-correction-audit.json",
            "staging-catalog.json", "README.md")},
        "migrations": [{"file": p.name, "sha256_raw": hashlib.sha256(p.read_bytes()).hexdigest(),
                        "sha256_lf": digest(p)} for p in migrations],
        "managed_dependencies": {"Vault": "real extension", "Cron": "real extension; jobs disabled",
                                 "pg_net": "real extension; network none", "Realtime": "SQL fixture only; no service"},
        "runs": [], "status": "FAIL",
        "historical_62_migration_evidence": "verification-strict.json" if len(migrations) == 63 else None,
        "replay_mode": "STRICT_UNMODIFIED_BYTES",
    }
    try:
        errors = []
        staging_path = args.staging_catalog if args.staging_catalog.is_file() else None
        for number in (1, 2):
            try:
                run_one(number, migrations, evidence, staging_path=staging_path)
            except Exception as error:
                errors.append(str(error))
                print(f"database {number}: FAIL: {error}", flush=True)
        if errors:
            if all("baseline_catalog" in r for r in evidence["runs"]):
                assert evidence["runs"][0]["baseline_catalog"] == evidence["runs"][1]["baseline_catalog"]
                evidence["baseline_reproducibility"] = "PASS"
            raise RuntimeError("; ".join(errors))
        assert evidence["runs"][0]["baseline_catalog"] == evidence["runs"][1]["baseline_catalog"]
        assert evidence["runs"][0]["final_catalog"] == evidence["runs"][1]["final_catalog"]
        evidence["reproducibility"] = "PASS"
        if args.staging_catalog.is_file():
            staging = json.loads(args.staging_catalog.read_text(encoding="utf-8"))
            differences = compare(evidence["runs"][0]["final_catalog"], staging["catalog"])
            if len(migrations) == 63:
                evidence["staging_comparison"] = {
                    "status": "ORIGINAL_62_BASELINE_PASS_FORWARD_REVISION_DELTA_EXPECTED",
                    "original_baseline": "PASS",
                    "forward_delta": "workouts.revision, exercises.revision, exercise_sets.revision plus positive-value checks",
                    "staging_updated": False,
                    "differences": differences,
                    "source": str(args.staging_catalog.name),
                }
            else:
                evidence["staging_comparison"] = {"status": "DIFFERENCES" if differences else "PASS",
                                                  "differences": differences,
                                                  "source": str(args.staging_catalog.name)}
        else:
            evidence["staging_comparison"] = {"status": "UNAVAILABLE"}
        evidence["status"] = "PASS"
    finally:
        args.evidence.write_text(json.dumps(summarized_evidence(evidence), indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
        print(f"Evidence: {args.evidence}", flush=True)
    print("Two clean byte-for-byte replays and schema validation: PASS")


if __name__ == "__main__":
    main()
