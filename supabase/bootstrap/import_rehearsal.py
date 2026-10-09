"""Import the all-fake legacy revision-0011 fixture into two strict local targets.

This script has no DSN, Supabase CLI, provider, or network option. It creates an
Alembic SQLite source and invokes the same isolated PostgreSQL replay harness
used by replay.py. Docker containers use network=none and are always removed.
"""
from __future__ import annotations

import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import sys
import tempfile
from datetime import date, datetime
from itertools import groupby

from sqlalchemy import Boolean, Date, DateTime, Float, Integer, MetaData, Table, create_engine, inspect, select, text

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
FIXTURE = HERE / "synthetic_legacy_data.json"
SYNTHETIC_SOURCE_REVISION = "0011_email_verification"
LEDGER_TABLE = "alembic_version"


def _parse(value, column_type):
    if value is None:
        return None
    if isinstance(column_type, DateTime) and isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    if isinstance(column_type, Date) and isinstance(value, str):
        return date.fromisoformat(value)
    if isinstance(column_type, Boolean):
        return bool(value)
    if isinstance(column_type, Integer) and not isinstance(value, bool):
        return int(value)
    if isinstance(column_type, Float):
        return float(value)
    return value


def _legacy_source(path: Path):
    db_url = "sqlite:///" + path.as_posix()
    env = os.environ.copy()
    env["DATABASE_URL"] = db_url
    subprocess.run([sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade",
                    "0010_voucher_redemption_limits"], cwd=ROOT, env=env,
                   check=True, capture_output=True, text=True)

    # Import only after setting DATABASE_URL, so the retained legacy ORM never
    # opens the repository's normal/local database file.
    os.environ["DATABASE_URL"] = db_url
    from backend.database import Base, engine as backend_engine, migrate_accessories_to_exercises
    from sqlalchemy.orm import Session

    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    engine = create_engine(db_url)
    existing_tables = set(inspect(engine).get_table_names())
    try:
        with engine.begin() as connection:
            for table in Base.metadata.sorted_tables:
                if table.name not in existing_tables or table.name == LEDGER_TABLE:
                    continue
                rows = fixture.get(table.name, [])
                if not rows:
                    continue
                reflected = Table(table.name, MetaData(), autoload_with=connection)
                existing_columns = set(reflected.c.keys())
                prepared = []
                for row in rows:
                    values = {key: _parse(value, table.c[key].type) for key, value in row.items()
                              if key in existing_columns and key in table.c}
                    for key in existing_columns - set(values):
                        default = table.c[key].default if key in table.c else None
                        if default is not None:
                            if callable(default.arg):
                                try:
                                    generated = default.arg()
                                except TypeError:
                                    generated = default.arg(None)
                            else:
                                generated = default.arg
                            values[key] = generated
                    prepared.append(values)
                for _, batch in groupby(sorted(prepared, key=lambda row: tuple(sorted(row))),
                                        key=lambda row: tuple(sorted(row))):
                    connection.execute(reflected.insert(), list(batch))
        # The historical 0001 migration's real accessory expansion preserves
        # the old row as a tombstone and creates canonical Exercise/ExerciseSet rows.
        with Session(engine) as session:
            migrate_accessories_to_exercises(session)
    except Exception:
        engine.dispose()
        backend_engine.dispose()
        raise
    engine.dispose()
    backend_engine.dispose()

    subprocess.run([sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
                   cwd=ROOT, env=env, check=True, capture_output=True, text=True)
    engine = create_engine(db_url)
    # Rows and tables that did not exist until 0011 are added after the actual
    # source database has replayed the real revision.
    late_tables = {"email_verification_tokens", "auth_security_subjects", "auth_security_events"}
    try:
        with engine.begin() as connection:
            for table in Base.metadata.sorted_tables:
                if table.name not in late_tables:
                    continue
                rows = fixture.get(table.name, [])
                if rows:
                    prepared = [{key: _parse(value, table.c[key].type) for key, value in row.items()} for row in rows]
                    connection.execute(table.insert(), prepared)
            revision = connection.scalar(text("SELECT version_num FROM alembic_version"))
            assert revision == SYNTHETIC_SOURCE_REVISION, revision
            assert connection.scalar(text("SELECT count(*) FROM users WHERE email_verification_legacy_exempt IS NOT TRUE")) == 0
            assert connection.scalar(text("SELECT email_verified_at IS NOT NULL FROM users WHERE id='fake-google-user'")) == 1
            assert connection.scalar(text("SELECT deleted_at IS NOT NULL FROM accessories WHERE id='fixture-exercise-accessory'")) == 1
            assert connection.scalar(text("SELECT count(*) FROM exercise_sets WHERE exercise_id='fixture-exercise-accessory'")) == 2
    finally:
        engine.dispose()
    return db_url, Base


def _sql_literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, (datetime, date)):
        value = value.isoformat(sep=" ") if isinstance(value, datetime) else value.isoformat()
    return "'" + str(value).replace("'", "''") + "'"


def _normalize(value, column_type):
    if value is None:
        return None
    if isinstance(column_type, DateTime):
        if isinstance(value, str):
            value = datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
        return value.isoformat(timespec="microseconds")
    if isinstance(column_type, Date):
        return value.isoformat() if hasattr(value, "isoformat") else str(value)
    if isinstance(column_type, Boolean):
        return bool(value)
    if isinstance(column_type, Integer) and not isinstance(value, bool):
        return int(value)
    if isinstance(column_type, Float):
        return float(value)
    return value


def _digest(rows):
    data = json.dumps(rows, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def _quote(name):
    return '"' + name.replace('"', '""') + '"'


def _mapping_and_source_rows(source_engine, Base, target_catalog):
    source_inspector = inspect(source_engine)
    target_tables = {row["name"] for row in target_catalog["tables"]}
    target_columns = {}
    target_types = {}
    target_column_details = {}
    for column in target_catalog["columns"]:
        target_columns.setdefault(column["table"], set()).add(column["name"])
        target_types[(column["table"], column["name"])] = column["type"]
        target_column_details[(column["table"], column["name"])] = {
            "type": column["type"], "default": column.get("default"),
            "not_null": column.get("not_null", False),
        }

    source_tables = set(source_inspector.get_table_names()) - {LEDGER_TABLE}
    missing_tables = sorted(source_tables - target_tables)
    if missing_tables:
        raise RuntimeError(f"Nonempty or unreviewed legacy tables have no target mapping: {missing_tables}")

    mapping = []
    source_rows = {}
    for table in Base.metadata.sorted_tables:
        name = table.name
        if name not in source_tables:
            continue
        source_cols = source_inspector.get_columns(name)
        source_names = [column["name"] for column in source_cols]
        missing_columns = sorted(set(source_names) - target_columns.get(name, set()))
        if missing_columns:
            raise RuntimeError(f"Unmapped legacy columns in {name}: {missing_columns}")
        mapped = [column for column in source_names if column in target_columns[name]]
        with source_engine.connect() as connection:
            rows = connection.execute(select(table).order_by(*table.primary_key.columns)).mappings().all()
        source_rows[name] = [dict(row) for row in rows]
        mapping.append({
            "source_table": name,
            "target_table": "public." + name,
            "fields": [{"source": col["name"], "target": col["name"],
                        "source_type": str(col["type"]), "target_type": target_types[(name, col["name"])],
                        "transform": "identity"} for col in source_cols],
            "target_only_fields": [target_column_details[(name, col)]
                                   | {"name": col, "disposition": "database default or NULL"}
                                   for col in sorted(target_columns[name] - set(mapped))],
            "source_rows": len(rows),
        })
    return mapping, source_rows, sorted(target_tables - source_tables)


def _mapped_canonical(rows, table, columns):
    return [{column.name: _normalize(row[column.name], column.type) for column in columns}
            for row in rows]


def _import_rows(name, source_rows, Base, mapping):
    statements = []
    for item in mapping:
        table_name = item["source_table"]
        columns = [field["source"] for field in item["fields"]]
        table = Base.metadata.tables[table_name]
        for row in source_rows[table_name]:
            names = ",".join(_quote(column) for column in columns)
            values = ",".join(_sql_literal(row[column]) for column in columns)
            statements.append(f"INSERT INTO public.{_quote(table_name)} ({names}) VALUES ({values});")
    if statements:
        from replay import psql
        psql(name, "\n".join(statements), transaction=True)


def _target_rows(name, table_name, columns, pk_columns):
    from replay import psql
    column_sql = ",".join(_quote(column) for column in columns)
    order_sql = ",".join(_quote(column) for column in pk_columns)
    query = ("SELECT coalesce(json_agg(to_jsonb(q) ORDER BY " + order_sql + "),'[]'::json)::text FROM (SELECT "
             + column_sql + f" FROM public.{_quote(table_name)} ORDER BY {order_sql}) q;")
    return json.loads(psql(name, query).stdout.strip())


def _rollback_probe(name):
    from replay import psql
    probe = "synthetic-import-rollback-user"
    sql = f"""INSERT INTO public.users(id,email,hashed_password,role)
      VALUES('{probe}','rollback@example.invalid','synthetic-invalid-hash','ATHLETE');
      INSERT INTO public.workouts(id,date,\"dayLabel\",title,color,status,owner_id)
      VALUES('synthetic-import-rollback-workout','2026-01-01','Day 1','rollback','gray','PLANNED','missing-user');"""
    result = psql(name, sql, transaction=True, check=False)
    assert result.returncode != 0, "Invalid source row unexpectedly imported"
    remaining = psql(name, f"SELECT count(*) FROM public.users WHERE id='{probe}';").stdout.strip()
    assert remaining == "0", f"Failed import left partial user rows: {remaining}"
    return "PASS"


def _fk_violations(name, source_rows, Base):
    from replay import psql
    checked = 0
    for table in Base.metadata.sorted_tables:
        if not source_rows.get(table.name):
            continue
        for constraint in table.foreign_key_constraints:
            local_cols = [element.parent.name for element in constraint.elements]
            remote_table = constraint.elements[0].column.table.name
            remote_cols = [element.column.name for element in constraint.elements]
            nonnull = " AND ".join(f"s.{_quote(col)} IS NOT NULL" for col in local_cols)
            match = " AND ".join(f"r.{_quote(remote)} = s.{_quote(local)}" for local, remote in zip(local_cols, remote_cols))
            query = (f"SELECT count(*) FROM public.{_quote(table.name)} s WHERE {nonnull} AND NOT EXISTS "
                     f"(SELECT 1 FROM public.{_quote(remote_table)} r WHERE {match});")
            count = int(psql(name, query).stdout.strip())
            checked += 1
            if count:
                raise RuntimeError(f"{count} orphan rows at {table.name}.{','.join(local_cols)}")
    return {"foreign_keys_checked": checked, "orphan_count": 0}


def _reconcile(name, source_engine, source_rows, Base, mapping, target_only_tables):
    from replay import psql
    source_tables = []
    target_tables = []
    for item in mapping:
        table_name = item["source_table"]
        table = Base.metadata.tables[table_name]
        columns = [table.c[field["source"]] for field in item["fields"]]
        source_data = _mapped_canonical(source_rows[table_name], table, columns)
        pk_columns = [col.name for col in table.primary_key.columns]
        target_data = _target_rows(name, table_name, [col.name for col in columns], pk_columns)
        normalized_target = [{col.name: _normalize(row.get(col.name), col.type) for col in columns}
                             for row in target_data]
        source_digest = _digest(source_data)
        target_digest = _digest(normalized_target)
        source_tables.append({"table": table_name, "rows": len(source_data), "digest": source_digest})
        target_tables.append({"table": table_name, "rows": len(normalized_target), "digest": target_digest})
        if len(source_data) != len(normalized_target) or source_digest != target_digest:
            raise RuntimeError(f"Reconciliation differs for {table_name}: source={source_digest}, target={target_digest}")
    fk = _fk_violations(name, source_rows, Base)
    sequence_rows = json.loads(psql(name, """SELECT coalesce(json_agg(json_build_object(
      'table',table_name,'column',column_name) ORDER BY table_name,column_name),'[]'::json)::text
      FROM information_schema.columns WHERE table_schema='public' AND column_default LIKE 'nextval(%';""").stdout.strip())
    sequences = []
    for item in sequence_rows:
        table_name, column = item["table"], item["column"]
        sequence = psql(name, f"SELECT pg_get_serial_sequence('public.{table_name}','{column}');").stdout.strip()
        if not sequence:
            continue
        sql = (f"SELECT setval('{sequence}'::regclass,coalesce(max({_quote(column)}),1),"
               f"max({_quote(column)}) IS NOT NULL)::text FROM public.{_quote(table_name)};")
        psql(name, sql)
        sequences.append({"table": table_name, "column": column, "sequence": sequence, "advanced_after_explicit_ids": True})
    for item in sequences:
        table_name, column, sequence = item["table"], item["column"], item["sequence"]
        next_value = int(psql(name, f"SELECT nextval('{sequence}'::regclass);").stdout.strip())
        max_value = int(psql(name, f"SELECT coalesce(max({_quote(column)}),0) FROM public.{_quote(table_name)};").stdout.strip())
        if next_value <= max_value:
            raise RuntimeError(f"Sequence {sequence} did not advance beyond imported keys")
        item["next_value_after_check"] = next_value
    result = {
        "source_tables": source_tables,
        "target_tables": target_tables,
        "table_digests_match": True,
        "fk_check": fk,
        "sequences": sequences,
        "target_only_fields_defaulted_or_null": [],
    }
    for item in mapping:
        for field in item["target_only_fields"]:
            query = (f"SELECT count(*) FILTER (WHERE {_quote(field['name'])} IS NULL)::text "
                     f"FROM public.{_quote(item['source_table'])};")
            null_count = int(psql(name, query).stdout.strip())
            if field["not_null"] and null_count:
                raise RuntimeError(f"Unmapped non-null target column was not initialized: {item['source_table']}.{field['name']}")
            result["target_only_fields_defaulted_or_null"].append({
                "table": item["source_table"], **field, "null_rows": null_count,
                "status": "PASS" if not field["not_null"] or null_count == 0 else "FAIL",
            })
    for table_name in target_only_tables:
        count = int(psql(name, f"SELECT count(*) FROM public.{_quote(table_name)};").stdout.strip())
        if count:
            raise RuntimeError(f"Target-only table unexpectedly contains imported rows: {table_name} ({count})")
    unmatched_vouchers = int(psql(name, """SELECT count(*) FROM public.vouchers v
      WHERE v.redeemed_at IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.access_grants ag JOIN public.workspaces w ON w.id=ag.workspace_id
        WHERE ag.reason='voucher:'||v.id AND ag.plan_key=v.plan_key
          AND w.owner_user_id=v.redeemed_by_user_id);""").stdout.strip())
    if unmatched_vouchers:
        raise RuntimeError(f"Redeemed vouchers without matching grants: {unmatched_vouchers}")
    active_grants = int(psql(name, """SELECT count(*) FROM public.access_grants ag
      JOIN public.workspaces w ON w.id=ag.workspace_id
      WHERE w.owner_user_id='fake-coach-001' AND ag.plan_key='coach_beta'
        AND ag.starts_at<=clock_timestamp() AND (ag.expires_at IS NULL OR ag.expires_at>clock_timestamp())
        AND ag.revoked_at IS NULL;""").stdout.strip())
    active_subscriptions = int(psql(name, """SELECT count(*) FROM public.subscriptions s
      JOIN public.workspaces w ON w.id=s.workspace_id
      WHERE w.owner_user_id='fake-coach-001' AND s.status='ACTIVE'
        AND s.current_period_end>clock_timestamp();""").stdout.strip())
    if active_grants != 1 or active_subscriptions != 1:
        raise RuntimeError("Synthetic workspace grant/subscription entitlement did not reconcile")
    result["billing_consistency"] = {
        "redeemed_vouchers_matching_grants": True,
        "active_workspace_grants": active_grants,
        "active_subscriptions": active_subscriptions,
    }
    return result


def _sync_compatibility(name):
    from replay import psql

    def invoke(actor, session_id, workout_id, device_id, changes):
        encoded = json.dumps(changes, separators=(",", ":")).replace("'", "''")
        sql = (f"SELECT al_private.al_workout_sync('{actor}','{session_id}','{workout_id}',"
               f"'{workout_id}','{device_id}',false,3,'{encoded}'::jsonb)::text;")
        return json.loads(psql(name, sql).stdout.strip())

    def current_set():
        raw = psql(name, "SELECT json_build_object('revision',revision,'actual',actual,'note',note)::text FROM public.exercise_sets WHERE id='fixture-set-active';").stdout.strip()
        return json.loads(raw)

    actor, session_id, workout_id, device_id = "fake-athlete-001", "fake-session-athlete-valid", "fixture-workout-active", "fixture-device-001"
    initial = current_set()
    legacy_v1 = {"entity": "ExerciseSet", "id": "fixture-set-active", "mutation_id": "legacy-v1-no-baseline",
                 "updated_at": "2099-01-01T00:00:00", "fields": {"note": "legacy-offline-edit"}}
    old_result = invoke(actor, session_id, workout_id, device_id, [legacy_v1])
    old_repeat = invoke(actor, session_id, workout_id, device_id, [legacy_v1])
    assert old_result["denial"] == "revision_conflict" and old_result["conflicts"][0]["reason"] == "BASELINE_REQUIRED"
    assert old_repeat["conflicts"][0]["mutation_id"] == legacy_v1["mutation_id"]
    assert current_set() == initial
    assert psql(name, "SELECT count(*) FROM public.sync_mutations WHERE mutation_id='legacy-v1-no-baseline';").stdout.strip() == "0"

    change = {"entity": "ExerciseSet", "id": "fixture-set-active", "mutation_id": "legacy-replay-set-001",
              "updated_at": "2001-01-01T00:00:00", "base_revision": initial["revision"],
              "base_fields": {"actual": initial["actual"], "reps": 5, "executedRpe": 8},
              "fields": {"actual": 92.5, "reps": 5, "executedRpe": 8}}
    accepted = invoke(actor, session_id, workout_id, device_id, [change])
    assert accepted.get("denial") is None and accepted["accepted_mutation_ids"] == [change["mutation_id"]], accepted
    repeated = invoke(actor, session_id, workout_id, device_id, [change])
    assert repeated["accepted_mutation_ids"] == [change["mutation_id"]], repeated
    assert psql(name, "SELECT count(*) FROM public.sync_mutations WHERE client_device_id='fixture-device-001' AND mutation_id='legacy-replay-set-001';").stdout.strip() == "1"
    assert psql(name, "SELECT actual::text FROM public.exercise_sets WHERE id='fixture-set-active';").stdout.strip() == "92.5"

    # The direct online Set Log REST path uses the same compare-and-swap token.
    direct_baseline = current_set()["revision"]
    direct_write = psql(name, "SELECT al_private.al_set_log_checked('fake-athlete-001','fake-session-athlete-valid',"
        "'fixture-workout-active','fixture-exercise-active','fixture-set-active',93,5,8,NULL,NULL,NULL,NULL,false,3,"
        + str(direct_baseline) + ")::text;")
    direct_result = json.loads(direct_write.stdout.strip())
    assert direct_result.get("denial") is None, direct_result
    assert current_set()["actual"] == 93
    direct_stale = psql(name, "SELECT al_private.al_set_log_checked('fake-athlete-001','fake-session-athlete-valid',"
        "'fixture-workout-active','fixture-exercise-active','fixture-set-active',94,5,8,NULL,NULL,NULL,NULL,false,3,"
        + str(direct_baseline) + ")::text;")
    direct_stale_result = json.loads(direct_stale.stdout.strip())
    assert direct_stale_result["denial"] == "revision_conflict", direct_stale_result
    assert current_set()["actual"] == 93

    # Device A goes offline at revision N. Device B commits the same field;
    # A reconnects with a clock behind. The server must preserve B's value.
    before = current_set()
    stale = {"entity": "ExerciseSet", "id": "fixture-set-active", "mutation_id": "device-a-stale-note",
             "updated_at": "2001-01-01T00:00:00", "base_revision": before["revision"],
             "base_fields": {"note": None}, "fields": {"note": "offline-device-a-edit"}}
    psql(name, "UPDATE public.exercise_sets SET note='newer-device-b-value' WHERE id='fixture-set-active';")
    stale_result = invoke(actor, session_id, workout_id, device_id, [stale])
    assert stale_result["denial"] == "revision_conflict"
    conflict = stale_result["conflicts"][0]
    assert conflict["server_fields"]["note"] == "newer-device-b-value"
    assert conflict["client_fields"]["note"] == "offline-device-a-edit"
    assert current_set()["note"] == "newer-device-b-value"
    stale_repeat = invoke(actor, session_id, workout_id, device_id, [stale])
    assert stale_repeat["denial"] == "revision_conflict"
    assert stale_repeat["conflicts"] == stale_result["conflicts"]
    assert current_set()["note"] == "newer-device-b-value"

    # A valid baseline cannot use a far-future client clock to force a write.
    before = current_set()
    future = {"entity": "ExerciseSet", "id": "fixture-set-active", "mutation_id": "future-client-clock",
              "updated_at": "2099-01-01T00:00:00", "base_revision": before["revision"],
              "base_fields": {"actual": before["actual"]}, "fields": {"actual": 999.0}}
    future_result = invoke(actor, session_id, workout_id, device_id, [future])
    assert future["mutation_id"] in future_result["rejected_mutations"]
    assert any(item["reason"] == "CLIENT_CLOCK_SKEW" for item in future_result["conflicts"])
    assert current_set()["actual"] == before["actual"]

    # Different fields observed at the same baseline remain independently writable.
    before = current_set()
    disjoint = [
        {"entity": "ExerciseSet", "id": "fixture-set-active", "mutation_id": "disjoint-actual",
         "updated_at": "2001-01-01T00:00:00", "base_revision": before["revision"],
         "base_fields": {"actual": before["actual"]}, "fields": {"actual": 101.0}},
        {"entity": "ExerciseSet", "id": "fixture-set-active", "mutation_id": "disjoint-note",
         "updated_at": "2001-01-01T00:00:00", "base_revision": before["revision"],
         "base_fields": {"note": before["note"]}, "fields": {"note": "disjoint-device-note"}},
    ]
    disjoint_result = invoke(actor, session_id, workout_id, device_id, disjoint)
    assert set(disjoint_result["accepted_mutation_ids"]) == {item["mutation_id"] for item in disjoint}, disjoint_result
    assert current_set()["actual"] == 101 and current_set()["note"] == "disjoint-device-note"

    # True concurrent calls share a baseline for the same field. Exactly one commits.
    before = current_set()
    concurrent = []
    for value, mutation_id in ((111.0, "concurrent-a"), (112.0, "concurrent-b")):
        concurrent.append({"entity": "ExerciseSet", "id": "fixture-set-active", "mutation_id": mutation_id,
                           "updated_at": "2001-01-01T00:00:00", "base_revision": before["revision"],
                           "base_fields": {"actual": before["actual"]}, "fields": {"actual": value}})
    with ThreadPoolExecutor(max_workers=2) as pool:
        concurrent_results = list(pool.map(
            lambda pair: invoke(actor, session_id, workout_id, pair[0], [pair[1]]),
            [("concurrent-device-a", concurrent[0]), ("concurrent-device-b", concurrent[1])],
        ))
    assert sum(result.get("accepted_mutation_ids") == [item["mutation_id"]] for result, item in zip(concurrent_results, concurrent)) == 1
    assert sum(result.get("denial") == "revision_conflict" for result in concurrent_results) == 1
    assert current_set()["actual"] in (111, 112)

    # A child set write advances the parent exercise revision, so a full-list
    # replacement based on the older parent revision cannot tombstone that write.
    exercise_revision = int(psql(name, "SELECT revision FROM public.exercises WHERE id='fixture-exercise-active';").stdout.strip())
    child = current_set()
    child_change = {"entity": "ExerciseSet", "id": "fixture-set-active", "mutation_id": "nested-child-edit",
                    "updated_at": "2001-01-01T00:00:00", "base_revision": child["revision"],
                    "base_fields": {"note": child["note"]}, "fields": {"note": "new-child-value"}}
    assert invoke(actor, session_id, workout_id, device_id, [child_change])["accepted_mutation_ids"] == [child_change["mutation_id"]]
    nested = psql(name, "SELECT al_private.al_session_replace_exercise_sets_checked('fake-athlete-001','fake-session-athlete-valid','fixture-workout-active','fixture-exercise-active',"
        + str(exercise_revision) + ",false,3,'[]'::jsonb)::text;")
    nested_result = json.loads(nested.stdout.strip())
    assert nested_result["denial"] == "revision_conflict"
    assert current_set()["note"] == "new-child-value"

    tombstone = {"entity": "ExerciseSet", "id": "fixture-set-deleted", "mutation_id": "legacy-deleted-set-002",
                 "updated_at": "2026-09-01T12:00:00", "base_revision": 1, "base_fields": {"actual": None}, "fields": {"actual": 100, "reps": 1}}
    denied_tombstone = invoke(actor, session_id, workout_id, device_id, [tombstone])
    assert denied_tombstone["denial"] == "revision_conflict"
    assert denied_tombstone["conflicts"][0]["mutation_id"] == tombstone["mutation_id"]
    assert any(item["reason"] == "TOMBSTONE_CONFLICT" for item in denied_tombstone["conflicts"])

    expired = invoke("fake-athlete-001", "fake-session-expired", "fixture-workout-active", "fixture-device-001", [])
    assert expired["denial"] == "invalid_session"
    revoked = invoke("fake-athlete-001", "fake-session-revoked", "fixture-workout-active", "fixture-device-001", [])
    assert revoked["denial"] == "invalid_session"

    coach_allowed = invoke("fake-coach-001", "fake-session-coach-valid", "fixture-workout-active", "coach-fixture-device", [])
    assert coach_allowed["denial"] is None, coach_allowed
    ended = psql(name, "UPDATE public.coaching_relationships SET ended_at=clock_timestamp() WHERE id=701;")
    assert ended.returncode == 0
    coach_revoked = invoke("fake-coach-001", "fake-session-coach-valid", "fixture-workout-active", "coach-fixture-device", [])
    assert coach_revoked["denial"] == "coach_relationship_required", coach_revoked

    pending_jobs = int(psql(name, "SELECT count(*) FROM public.integration_outbox WHERE status='queued';").stdout.strip())
    assert pending_jobs == 1, f"Synthetic provider outbox job count changed unexpectedly: {pending_jobs}"
    return {
        "old_client_mutation_accepted": False,
        "same_mutation_replay_deduplicated": True,
        "tombstoned_set_rejected": True,
        "expired_and_revoked_sessions_rejected": True,
        "coach_active_relationship_allowed": True,
        "ended_relationship_revoked": True,
        "provider_side_effects": "none; fixture only, worker absent, container network disabled",
        "queued_synthetic_jobs_preserved": pending_jobs,
        "legacy_v1_missing_baseline_conflicted": True,
        "legacy_v1_original_edit_retained_in_conflict": True,
        "legacy_v1_mutation_not_acknowledged": True,
        "stale_server_value_preserved": True,
        "stale_conflict_repeat_stable": True,
        "direct_set_log_cas": True,
        "different_fields_same_baseline_merge": True,
        "same_field_concurrent_cas": True,
        "client_clock_skew_ignored_for_baseline": True,
        "future_client_clock_rejected_without_write": True,
        "nested_set_replace_conflict_safe": True,
    }


def main():
    os.chdir(ROOT)
    sys.path.insert(0, str(ROOT))
    sys.path.insert(0, str(HERE))
    import replay

    evidence = {
        "mode": "synthetic-only legacy SQLite -> local Supabase PostgreSQL import",
        "source_revision_expected": SYNTHETIC_SOURCE_REVISION,
        "fixture_path": "supabase/bootstrap/synthetic_legacy_data.json",
        "production_or_staging_connection": False,
        "provider_side_effects": "none",
        "status": "FAIL",
        "targets": [],
    }
    with tempfile.TemporaryDirectory(prefix="adaptive-lifting-import-") as temp_dir:
        source_path = Path(temp_dir) / "legacy-source.sqlite"
        source_url, Base = _legacy_source(source_path)
        source_engine = create_engine(source_url)
        try:
            inspector = inspect(source_engine)
            with source_engine.connect() as connection:
                revision = connection.scalar(text("SELECT version_num FROM alembic_version"))
            assert revision == SYNTHETIC_SOURCE_REVISION
            evidence["source_revision"] = revision
            with source_engine.connect() as connection:
                source_counts = {table: len(connection.execute(select(Base.metadata.tables[table])).all())
                                 for table in inspector.get_table_names() if table != LEDGER_TABLE}
            evidence["source_row_counts"] = source_counts
            captures = []
            for number in (1, 2):
                target_capture = {}

                # Extend the callback with the exact data exercise after the raw
                # 62-migration replay. run_one still applies its full schema checks.
                def complete(name, capture=target_capture):
                    catalog = replay.snapshot(name)
                    mapping, source_rows, target_only = _mapping_and_source_rows(source_engine, Base, catalog)
                    rollback = _rollback_probe(name)
                    _import_rows(name, source_rows, Base, mapping)
                    reconciliation = _reconcile(name, source_engine, source_rows, Base, mapping, target_only)
                    compatibility = _sync_compatibility(name)
                    capture.update({"mapping": mapping, "source_rows": source_rows, "target_only_tables": target_only,
                                    "rollback": rollback, "reconciliation": reconciliation,
                                    "compatibility": compatibility})

                migration_files = sorted((ROOT / "supabase/migrations").glob("*.sql"))
                replay_evidence = {"runs": []}
                replay.run_one(number, migration_files,
                               replay_evidence, after_replay=complete,
                               staging_path=HERE / "staging-catalog.json")
                digest_map = {item["table"]: item["digest"] for item in target_capture["reconciliation"]["source_tables"]}
                evidence["targets"].append({
                    "database": number, "status": "PASS", "migration_count": len(migration_files),
                    "original_62_migration_staging_parity": replay_evidence["runs"][0].get("original_62_migration_staging_parity"),
                    "intentional_forward_schema_delta": replay_evidence["runs"][0].get("intentional_forward_schema_delta"),
                    "source_revision": revision, "mapping": target_capture["mapping"],
                    "target_only_tables_unmapped": target_capture["target_only_tables"],
                    "rollback": target_capture["rollback"],
                    "reconciliation": target_capture["reconciliation"],
                    "sync_compatibility": target_capture["compatibility"],
                    "source_digest_map": digest_map,
                })
                captures.append(digest_map)
            evidence["repeatable_import"] = captures[0] == captures[1]
            core_import_pass = evidence["repeatable_import"] and all(
                target["reconciliation"]["table_digests_match"] and target["rollback"] == "PASS"
                for target in evidence["targets"]
            )
            required_sync_checks = (
                "legacy_v1_missing_baseline_conflicted",
                "legacy_v1_original_edit_retained_in_conflict",
                "legacy_v1_mutation_not_acknowledged",
                "stale_server_value_preserved",
                "stale_conflict_repeat_stable",
                "direct_set_log_cas",
                "different_fields_same_baseline_merge",
                "same_field_concurrent_cas",
                "future_client_clock_rejected_without_write",
                "nested_set_replace_conflict_safe",
                "tombstoned_set_rejected",
                "expired_and_revoked_sessions_rejected",
                "ended_relationship_revoked",
            )
            offline_pass = all(
                all(target["sync_compatibility"].get(check) is True for check in required_sync_checks)
                for target in evidence["targets"]
            )
            evidence["data_import_rehearsal"] = "PASS" if core_import_pass else "FAIL"
            evidence["offline_queue_compatibility"] = "PASS" if offline_pass else "PARTIAL"
            evidence["status"] = "PASS" if core_import_pass and offline_pass else "PARTIAL" if core_import_pass else "FAIL"
        finally:
            source_engine.dispose()
    output = HERE / "import-rehearsal-evidence.json"
    output.write_text(json.dumps(evidence, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Evidence: {output}")
    print(f"Synthetic import rehearsal: {evidence['status']}")
    if evidence["status"] == "FAIL":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
