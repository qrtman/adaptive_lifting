"""Validated adoption of a pre-Alembic database.

Only a structurally validated 0001 baseline (or current schema) is stamped. Later
revisions are then applied normally; unknown or partial schemas are never marked current.
"""
import argparse
import re
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect
from backend.database import Base, engine

LEGACY_SERVER_DEFAULTS = {
    ("exercises", "tier"): "Comp",
    ("exercises", "lift_category"): "Squat",
    ("exercise_sets", "scope"): "both",
}
BASELINE_REVISION = "0001_current_schema"
POST_BASELINE_COLUMNS = {("users", "google_sub"), ("integration_outbox", "result")}
POST_BASELINE_TABLES = {"oauth_states"}


def _normalize_default(value):
    return re.sub(r"[\s()\"']+", "", str(value)).lower()


def validate_schema(connection):
    inspector = inspect(connection)
    expected = set(Base.metadata.tables)
    actual = set(inspector.get_table_names()) - {"alembic_version"}
    problems = []
    missing_tables = expected - actual - POST_BASELINE_TABLES
    extra_tables = actual - expected
    if missing_tables:
        problems.append("missing tables: " + ", ".join(sorted(missing_tables)))
    if extra_tables:
        problems.append("unrecognized tables: " + ", ".join(sorted(extra_tables)))
    for name in sorted(expected & actual):
        expected_table = Base.metadata.tables[name]
        reflected_columns = {column["name"]: column for column in inspector.get_columns(name)}
        actual_columns = set(reflected_columns)
        expected_pk = tuple(column.name for column in expected_table.primary_key.columns)
        missing_columns = {column.name for column in expected_table.columns} - actual_columns
        unsupported_missing = {
            (name, column) for column in missing_columns
            if (name, column) not in POST_BASELINE_COLUMNS
        }
        extra_columns = actual_columns - {column.name for column in expected_table.columns}
        if unsupported_missing:
            problems.append(f"{name} missing columns: {', '.join(sorted(column for _, column in unsupported_missing))}")
        if extra_columns:
            problems.append(f"{name} has unrecognized columns: {', '.join(sorted(extra_columns))}")
        for column in expected_table.columns:
            reflected = reflected_columns.get(column.name)
            if reflected is None:
                continue
            if reflected["type"]._type_affinity is not column.type._type_affinity:
                problems.append(f"{name}.{column.name} type differs: expected {column.type}, found {reflected['type']}")
            if column.name not in expected_pk and bool(reflected["nullable"]) != bool(column.nullable):
                problems.append(f"{name}.{column.name} nullability differs")
            expected_default = str(column.server_default.arg) if column.server_default is not None else None
            actual_default = reflected.get("default")
            if expected_default is None and actual_default is not None:
                allowed_legacy_default = LEGACY_SERVER_DEFAULTS.get((name, column.name))
                if allowed_legacy_default is None or _normalize_default(actual_default) != _normalize_default(allowed_legacy_default):
                    problems.append(f"{name}.{column.name} has an unrecognized server default")
        actual_pk = tuple(inspector.get_pk_constraint(name).get("constrained_columns") or ())
        if set(expected_pk) != set(actual_pk):
            problems.append(f"{name} primary key differs: expected {expected_pk}, found {actual_pk}")
        expected_fks = {(tuple(fk.parent.name for fk in constraint.elements),
                         constraint.elements[0].column.table.name,
                         tuple(fk.column.name for fk in constraint.elements))
                        for constraint in expected_table.foreign_key_constraints}
        actual_fks = {(tuple(fk.get("constrained_columns") or ()), fk.get("referred_table"),
                       tuple(fk.get("referred_columns") or ()))
                      for fk in inspector.get_foreign_keys(name)}
        if expected_fks != actual_fks:
            problems.append(f"{name} foreign keys differ")
        expected_unique = {tuple(constraint.columns.keys()) for constraint in expected_table.constraints
                           if constraint.__class__.__name__ == "UniqueConstraint"}
        expected_unique.update(
            tuple(column.name for column in index.columns)
            for index in expected_table.indexes
            if index.unique and set(column.name for column in index.columns) <= actual_columns
        )
        actual_unique = {tuple(constraint.get("column_names") or ())
                         for constraint in inspector.get_unique_constraints(name)}
        actual_unique.update(tuple(index["column_names"]) for index in inspector.get_indexes(name)
                             if index.get("unique"))
        if expected_unique != actual_unique:
            problems.append(f"{name} unique constraints differ")
        expected_indexes = {
            index.name: index for index in expected_table.indexes
            if index.name and set(column.name for column in index.columns) <= actual_columns
        }
        actual_indexes = {index["name"]: index for index in inspector.get_indexes(name)}
        if set(actual_indexes) - set(expected_indexes):
            problems.append(f"{name} has unrecognized indexes: {', '.join(sorted(set(actual_indexes) - set(expected_indexes)))}")
        for index_name, expected_index in expected_indexes.items():
            actual_index = actual_indexes.get(index_name)
            if actual_index is None:
                problems.append(f"{name} missing index: {index_name}")
                continue
            expected_cols = tuple(column.name for column in expected_index.columns)
            actual_cols = tuple(actual_index.get("column_names") or ())
            if expected_cols != actual_cols or bool(expected_index.unique) != bool(actual_index.get("unique")):
                problems.append(f"{name}.{index_name} definition differs")
            expected_where = expected_index.dialect_options["sqlite"].get("where")
            actual_where = actual_index.get("dialect_options", {}).get("sqlite_where")
            if expected_where is not None:
                normalize = lambda value: re.sub(
                    r"[\s()\"`]+", "", re.sub(r"\b[a-z_][a-z0-9_]*\.", "", str(value), flags=re.I)
                ).lower()
                if actual_where is None or normalize(actual_where) != normalize(expected_where):
                    problems.append(f"{name}.{index_name} partial-index predicate differs")
    return problems


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["validate", "adopt"])
    args = parser.parse_args()
    with engine.connect() as connection:
        problems = validate_schema(connection)
        if problems:
            raise SystemExit("Database schema does not exactly match this release; no version was stamped.\n- " + "\n- ".join(problems) + "\nBack up the database, then run `alembic upgrade head` to apply supported historical upgrades, or inspect the schema manually.")
    if args.action == "validate":
        print("Schema matches the current SQLAlchemy model metadata.")
        return
    config = Config("alembic.ini")
    command.stamp(config, BASELINE_REVISION)
    command.upgrade(config, "head")
    print(f"Validated schema based at {BASELINE_REVISION}; later revisions applied through head.")

if __name__ == "__main__":
    main()
