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
    result = subprocess.run(args, input=sql, text=True, encoding="utf-8", capture_output=True)
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
        for phase in ("baseline", "final"):
            catalog = run.pop(phase + "_catalog", None)
            if catalog is not None:
                serialized = json.dumps(catalog, sort_keys=True, separators=(",", ":")).encode()
                run[phase + "_schema"] = {
                    "sha256": hashlib.sha256(serialized).hexdigest(),
                    "counts": {k: len(v) for k, v in catalog.items()},
                }
    return result


def migration_sql(path, reviewed_repair):
    sql = path.read_text(encoding="utf-8")
    if reviewed_repair:
        repairs = json.loads((HERE / "replay-repair.json").read_text(encoding="utf-8"))["files"]
        repair = next((r for r in repairs if r["file"] == path.name), None)
        if repair:
            assert digest(path) == repair["source_sha256_lf"], "Repair must be reviewed again after any source change"
            assert sql.endswith("\n\\n")
            return sql[:-2]
    return sql


def run_one(number, migrations, evidence, reviewed_repair=False):
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
        for file in ("local-managed-fixture.sql", "managed-prerequisites.sql", "application.sql"):
            record["blocking_file"] = file
            psql(name, (HERE / file).read_text(encoding="utf-8"))
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
        for path in migrations:
            record["blocking_file"] = path.name
            psql(name, migration_sql(path, reviewed_repair), transaction=True)
            record["applied"].append(path.name)
            print(f"database {number}: {len(record['applied'])}/62 {path.name}", flush=True)
        record["blocking_file"] = None
        record["final_catalog"] = snapshot(name)
        validate_final(record["final_catalog"])
        record["structural_validation"] = "PASS"
        behavioral_checks(lambda sql: psql(name, sql).stdout)
        record["schema_tests"] = "PASS"
        record["extensions"] = json.loads(psql(name,
            "SELECT json_agg(json_build_object('name',extname,'version',extversion) ORDER BY extname) FROM pg_extension;").stdout)
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
    parser.add_argument("--reviewed-local-repair", action="store_true",
                        help="Diagnostic ONLY: omit hash-pinned malformed trailing literals; history stays unchanged")
    args = parser.parse_args()
    migrations = sorted((ROOT / "supabase/migrations").glob("*.sql"))
    assert len(migrations) == 62, "Review migration count/order before changing the harness"
    command([sys.executable, str(HERE / "generate.py"), "--check"])
    command(["docker", "image", "inspect", IMAGE])
    evidence = {
        "image": IMAGE, "image_tag": "supabase/postgres:17.6.1.136",
        "source_commit": command(["git", "-C", str(ROOT), "rev-parse", "HEAD"]).stdout.strip(),
        "verified_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "bootstrap_sha256_lf": digest(HERE / "application.sql"),
        "tooling_sources_sha256_lf": {name: digest(HERE / name) for name in (
            "generate.py", "replay.py", "test_schema.py", "test_behavior.sql", "catalog.sql",
            "managed-prerequisites.sql", "local-managed-fixture.sql", "replay-repair.json", "staging-catalog.json")},
        "migrations": [{"file": p.name, "sha256_lf": digest(p)} for p in migrations],
        "managed_dependencies": {"Vault": "real extension", "Cron": "real extension; jobs disabled",
                                 "pg_net": "real extension; network none", "Realtime": "SQL fixture only; no service"},
        "runs": [], "status": "FAIL",
        "replay_mode": "DIAGNOSTIC_REPAIRED" if args.reviewed_local_repair else "STRICT_UNMODIFIED",
    }
    if args.reviewed_local_repair:
        evidence["repair"] = json.loads((HERE / "replay-repair.json").read_text(encoding="utf-8"))
    try:
        errors = []
        for number in (1, 2):
            try:
                run_one(number, migrations, evidence, args.reviewed_local_repair)
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
            evidence["staging_comparison"] = {"status": "DIFFERENCES" if differences else "PASS",
                                              "differences": differences,
                                              "source": str(args.staging_catalog.name)}
        else:
            evidence["staging_comparison"] = {"status": "UNAVAILABLE"}
        evidence["status"] = "PASS"
    finally:
        args.evidence.write_text(json.dumps(summarized_evidence(evidence), indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
        print(f"Evidence: {args.evidence}", flush=True)
    print("Two clean replays and schema validation: PASS (" + evidence["replay_mode"] + ")")


if __name__ == "__main__":
    main()
