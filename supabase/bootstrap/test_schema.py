"""Structural and behavioral tests for the historical foundation and SQL replay."""
import ast
import datetime
import hashlib
import json
import re
import unittest
from collections import Counter

import sqlalchemy as sa
from sqlalchemy.schema import AddConstraint, CreateIndex

from generate import DIALECT, HERE, ROOT, historical_metadata, render


def normalize(definition):
    # PostgreSQL rewrites IN into = ANY(ARRAY[]) and adds casts/parentheses.
    text = re.sub(r"::(?:character varying|text|integer)(?:\[\])?", "", definition)
    text = re.sub(r"\bIN\s*\(", "= ANY (ARRAY[", text, flags=re.I)
    text = text.replace("public.", "").replace(" USING btree", "")
    return re.sub(r"[\s()\[\]]+", "", text).lower()


def type_name(column):
    value = column.type.compile(dialect=DIALECT).lower()
    return value.replace("varchar", "character varying").replace("float", "double precision")


def validate_baseline(catalog):
    metadata, _ = historical_metadata()
    assert {t["name"] for t in catalog["tables"]} == set(metadata.tables), "Historical table set differs"
    columns = {(c["table"], c["name"]): c for c in catalog["columns"]}
    assert set(columns) == {(t.name, c.name) for t in metadata.tables.values() for c in t.c}, "Column set differs"
    for table in metadata.tables.values():
        for col in table.c:
            actual = columns[table.name, col.name]
            assert actual["type"] == type_name(col), (table.name, col.name, actual["type"], type_name(col))
            assert actual["not_null"] == (not col.nullable), (table.name, col.name, "nullability")
            expected_default = str(col.server_default.arg) if col.server_default else None
            if (table.name, col.name) == ("coaching_relationships", "id"):
                expected_default = "nextval('coaching_relationships_id_seq'::regclass)"
            assert actual["default"] == expected_default, (table.name, col.name, "default", actual["default"])
            assert actual["identity"] == actual["generated"] == ""
        actual_cons = [c for c in catalog["constraints"] if c["table"] == table.name]
        assert len(actual_cons) == len(table.constraints), (table.name, "constraint count")
        for constraint in table.constraints:
            compiled = str(AddConstraint(constraint).compile(dialect=DIALECT))
            definition = re.sub(r"^ALTER TABLE \S+ ADD (?:CONSTRAINT \S+ )?", "", compiled)
            matches = [c for c in actual_cons if normalize(c["definition"]) == normalize(definition)]
            assert len(matches) == 1, (table.name, "constraint definition", definition, actual_cons)
            actual = matches[0]
            assert actual["validated"] and not actual["deferrable"] and not actual["deferred"]
            if constraint.name:
                assert constraint.name == actual["name"], (table.name, "constraint name")
        for index in table.indexes:
            matches = [i for i in catalog["indexes"] if i["table"] == table.name and i["name"] == index.name]
            assert len(matches) == 1, (table.name, index.name)
            assert normalize(matches[0]["definition"]) == normalize(str(CreateIndex(index).compile(dialect=DIALECT)))
    assert all(i["valid"] and i["ready"] for i in catalog["indexes"])
    assert len(catalog["indexes"]) == sum(len(t.indexes) + sum(isinstance(c, (sa.PrimaryKeyConstraint, sa.UniqueConstraint)) for c in t.constraints)
                                          for t in metadata.tables.values())
    assert catalog["sequences"] == [{
        "name": "coaching_relationships_id_seq", "data_type": "integer", "start_value": 1,
        "min_value": 1, "max_value": 2147483647, "increment_by": 1, "cycle": False,
        "cache_size": 1, "owned_table": "coaching_relationships", "owned_column": "id",
    }], "Sequence definition/ownership differs"
    assert not any(t["rls"] for t in catalog["tables"]), "Historical RLS state differs"


def validate_final(catalog):
    # Exact catalog parity verifies every final column, default, PK, FK, index,
    # check, sequence and RLS bit against READ-ONLY validated staging evidence.
    from replay import compare
    expected = json.loads((HERE / "staging-catalog.json").read_text(encoding="utf-8"))["catalog"]
    differences = compare(catalog, expected)
    assert not differences, json.dumps(differences, indent=2)
    pk = next(c for c in catalog["constraints"] if c["name"] == "sync_mutations_pkey")
    assert pk["definition"] == "PRIMARY KEY (client_device_id, mutation_id)"
    assert len(catalog["tables"]) == 36


def validate_revision_delta(baseline, final):
    """Allow only the three forward-only revision columns and their checks."""
    for section in ("tables", "indexes", "sequences"):
        assert final[section] == baseline[section], f"Unexpected post-baseline {section} changes"
    expected_columns = {
        ("workouts", "revision"), ("exercises", "revision"), ("exercise_sets", "revision"),
    }
    base_columns = {(row["table"], row["name"]) for row in baseline["columns"]}
    final_columns = {(row["table"], row["name"]) for row in final["columns"]}
    assert final_columns - base_columns == expected_columns
    assert base_columns <= final_columns
    for row in final["columns"]:
        if (row["table"], row["name"]) in expected_columns:
            assert row["type"] == "bigint" and row["not_null"]
            assert "1" in str(row["default"])
    base_cons = Counter((row["table"], row["name"], row["type"], row["definition"]) for row in baseline["constraints"])
    final_cons = Counter((row["table"], row["name"], row["type"], row["definition"]) for row in final["constraints"])
    added = final_cons - base_cons
    assert len(added) == 3, f"Unexpected constraints added by revision migration: {added}"
    assert all(table in {"workouts", "exercises", "exercise_sets"} and kind == "c"
               and "revision > 0" in definition for table, _, kind, definition in added.elements())


def behavioral_checks(execute):
    # All synthetic inserts roll back. Exercise FK/unique/check/default/sequence
    # enforcement rather than just checking catalog object names.
    execute((HERE / "test_behavior.sql").read_text(encoding="utf-8"))


class CatalogTests(unittest.TestCase):
    def test_historical_foundation_matches_retained_model_columns(self):
        # Inspect the complete frozen/retained model without executing its
        # environment loader, engine construction or backend runtime imports.
        from sqlalchemy.orm import declarative_base, relationship
        parsed = ast.parse((ROOT / "backend/database.py").read_text(encoding="utf-8"))
        nodes = [n for n in parsed.body if isinstance(n, ast.ClassDef)]
        namespace = {name: getattr(sa, name) for name in (
            "Column", "String", "Integer", "Float", "Boolean", "ForeignKey",
            "DateTime", "UniqueConstraint", "CheckConstraint", "Index", "text", "true", "false")}
        namespace.update(Base=declarative_base(), relationship=relationship, datetime=datetime)
        exec(compile(ast.Module(body=nodes, type_ignores=[]), "retained-model-classes-only", "exec"), namespace)
        model = namespace["Base"].metadata
        history, _ = historical_metadata()
        self.assertEqual(set(model.tables), set(history.tables))
        for name, table in history.tables.items():
            self.assertEqual(set(table.c.keys()), set(model.tables[name].c.keys()), name)
            for column in table.c:
                expected = model.tables[name].c[column.name]
                self.assertEqual(type_name(column), type_name(expected), (name, column.name))
                self.assertEqual(column.nullable, expected.nullable, (name, column.name))
        # Current compatibility model already includes the later Supabase key.
        # It must never silently replace the HISTORICAL pre-delta key.
        self.assertEqual(list(history.tables["sync_mutations"].primary_key.columns.keys()), ["mutation_id"])
        self.assertEqual(list(model.tables["sync_mutations"].primary_key.columns.keys()), ["mutation_id", "client_device_id"])

    def test_sql_is_deterministic_and_premigration(self):
        self.assertEqual((HERE / "application.sql").read_text(encoding="utf-8"), render())
        sql = render()
        self.assertIn("PRIMARY KEY (mutation_id)", sql)
        self.assertNotIn("CREATE TABLE telegram_link_tokens", sql)
        self.assertNotIn("CREATE SCHEMA al_private", sql)
        self.assertNotIn("INSERT INTO", sql)

    def test_validated_staging_snapshot(self):
        catalog = json.loads((HERE / "staging-catalog.json").read_text(encoding="utf-8"))["catalog"]
        validate_final(catalog)

    def test_missing_column_is_detected(self):
        catalog = json.loads((HERE / "staging-catalog.json").read_text(encoding="utf-8"))["catalog"]
        catalog["columns"].pop()
        with self.assertRaises(AssertionError):
            validate_final(catalog)

    def test_changed_foreign_key_is_detected(self):
        catalog = json.loads((HERE / "staging-catalog.json").read_text(encoding="utf-8"))["catalog"]
        fk = next(c for c in catalog["constraints"] if c["type"] == "f")
        fk["definition"] += " ON DELETE CASCADE"
        with self.assertRaises(AssertionError):
            validate_final(catalog)

    def test_missing_index_is_detected(self):
        catalog = json.loads((HERE / "staging-catalog.json").read_text(encoding="utf-8"))["catalog"]
        catalog["indexes"].pop()
        with self.assertRaises(AssertionError):
            validate_final(catalog)

    def test_changed_sequence_ownership_is_detected(self):
        catalog = json.loads((HERE / "staging-catalog.json").read_text(encoding="utf-8"))["catalog"]
        catalog["sequences"][0]["owned_column"] = "wrong"
        with self.assertRaises(AssertionError):
            validate_final(catalog)

    def test_changed_primary_key_is_detected(self):
        catalog = json.loads((HERE / "staging-catalog.json").read_text(encoding="utf-8"))["catalog"]
        pk = next(c for c in catalog["constraints"] if c["name"] == "sync_mutations_pkey")
        pk["definition"] = "PRIMARY KEY (mutation_id)"
        with self.assertRaises(AssertionError):
            validate_final(catalog)

    def test_changed_check_constraint_is_detected(self):
        catalog = json.loads((HERE / "staging-catalog.json").read_text(encoding="utf-8"))["catalog"]
        check = next(c for c in catalog["constraints"] if c["name"] == "ck_vouchers_duration_positive")
        check["definition"] = "CHECK (duration_days >= 0)"
        with self.assertRaises(AssertionError):
            validate_final(catalog)

    def test_original_source_hashes_are_pinned_in_audit(self):
        # Retain the original source hashes as history; strict replay never
        # imports the diagnostic correction manifest or rewrites SQL bytes.
        manifest = json.loads((HERE / "replay-repair.json").read_text(encoding="utf-8"))
        audit = json.loads((HERE / "sql-eof-correction-audit.json").read_text(encoding="utf-8"))
        expected = {item["file"]: item["source_sha256_lf"] for item in manifest["files"]}
        actual = {item["file"]: item["original_sha256_lf_normalized"] for item in audit["files"]}
        self.assertEqual(actual, expected)
        for item in audit["files"]:
            path = ROOT / "supabase/migrations" / item["file"]
            source = path.read_bytes()
            self.assertFalse(source.rstrip().endswith(b"\\n"), item["file"])
            self.assertEqual(hashlib.sha256(source.replace(b"\r\n",b"\n")).hexdigest(),
                             item["corrected_sha256_lf_normalized"])

    def test_no_supabase_migration_has_literal_eof_escape(self):
        files = sorted((ROOT / "supabase/migrations").glob("*.sql"))
        bad = [p.name for p in files if p.read_bytes().rstrip().endswith(b"\\n")]
        self.assertEqual(bad, [])


if __name__ == "__main__":
    unittest.main()
