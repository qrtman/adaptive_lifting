"""Adopt and converge legacy Adaptive Lifting schemas to the current model.

This first revision supports the historical SQLite schema produced by previous
releases' create_all/startup ALTER workflow. It is additive for user data.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.orm import Session as OrmSession
from backend.database import Base, migrate_accessories_to_exercises
from backend.exercise_patterns import pattern_for
from backend.migrations.schema_0001 import create_missing_indexes, create_missing_tables

revision = "0001_current_schema"
down_revision = None
branch_labels = None
depends_on = None

# Previously absent columns were introduced by these startup ALTER statements.
LEGACY_ADDITIVE_COLUMNS = {
    "microcycles": {"owner_id"},
    "exercise_sets": {"velocity", "readiness", "hrv", "intensity_type", "scope"},
    "workouts": {"athlete_bw", "block_label", "week_label", "owner_id"},
    "exercises": {"tier", "lift_category", "movement_pattern", "lift_note"},
    "users": {"display_name", "google_sub"},
}
LEGACY_COLUMN_SPECS = {
    "microcycles": [("owner_id", sa.String(), None, True)],
    "exercise_sets": [
        ("velocity", sa.Float(), None, True), ("readiness", sa.Integer(), None, True),
        ("hrv", sa.Float(), None, True), ("intensity_type", sa.String(), None, True),
        ("scope", sa.String(), "both", False),
    ],
    "workouts": [
        ("athlete_bw", sa.Float(), None, True), ("block_label", sa.String(), None, True),
        ("week_label", sa.String(), None, True), ("owner_id", sa.String(), None, True),
    ],
    "exercises": [
        ("tier", sa.String(), "Comp", True), ("lift_category", sa.String(), "Squat", True),
        ("movement_pattern", sa.String(), None, True), ("lift_note", sa.String(), None, True),
    ],
    # google_sub was introduced in 0002_google_subject and must remain owned
    # by that revision for fresh installs and historical upgrades alike.
    "users": [("display_name", sa.String(), None, True)],
}
CORE_TABLES = {"users", "workouts", "exercises", "exercise_sets"}


def validate_supported_legacy_schema(bind, existing_tables):
    """Reject unknown layouts before making any changes to an unversioned DB."""
    known_tables = set(Base.metadata.tables)
    extra_tables = existing_tables - known_tables - {"alembic_version"}
    if extra_tables:
        raise RuntimeError(f"Unsupported unversioned database tables: {sorted(extra_tables)}")
    missing_core = CORE_TABLES - existing_tables
    if existing_tables and missing_core:
        raise RuntimeError(f"Not a recognized Adaptive Lifting database; missing core tables: {sorted(missing_core)}")

    inspector = inspect(bind)
    for table_name in existing_tables & known_tables:
        model_table = Base.metadata.tables[table_name]
        reflected = {column["name"]: column for column in inspector.get_columns(table_name)}
        expected = {column.name for column in model_table.columns}
        actual = set(reflected)
        extra_columns = actual - expected
        if extra_columns:
            raise RuntimeError(f"Unsupported columns in {table_name}: {sorted(extra_columns)}")
        missing_columns = expected - actual
        unsupported = missing_columns - LEGACY_ADDITIVE_COLUMNS.get(table_name, set())
        if unsupported:
            raise RuntimeError(f"Unsupported unversioned schema; {table_name} is missing columns: {sorted(unsupported)}")
        for column in model_table.columns:
            if column.name not in reflected:
                continue
            actual_column = reflected[column.name]
            if actual_column["type"]._type_affinity is not column.type._type_affinity:
                raise RuntimeError(f"Unsupported type for {table_name}.{column.name}: {actual_column['type']}")
            # SQLite's historical MODIFY microcycle_id NULL statement was
            # ignored by old startup code; permit only this known difference.
            if column.name == "microcycle_id" and table_name == "workouts":
                continue
            known_old_scope = table_name == "exercise_sets" and column.name == "scope" and bool(actual_column["nullable"])
            if column.name not in {pk.name for pk in model_table.primary_key.columns} and bool(actual_column["nullable"]) != bool(column.nullable) and not known_old_scope:
                raise RuntimeError(f"Unsupported nullability for {table_name}.{column.name}")

        expected_pk = {column.name for column in model_table.primary_key.columns}
        actual_pk = set(inspector.get_pk_constraint(table_name).get("constrained_columns") or ())
        if expected_pk != actual_pk:
            raise RuntimeError(f"Unsupported primary key for {table_name}: {sorted(actual_pk)}")

        expected_fks = {
            (tuple(element.parent.name for element in constraint.elements),
             constraint.elements[0].column.table.name,
             tuple(element.column.name for element in constraint.elements))
            for constraint in model_table.foreign_key_constraints
        }
        actual_fks = {
            (tuple(fk.get("constrained_columns") or ()), fk.get("referred_table"),
             tuple(fk.get("referred_columns") or ()))
            for fk in inspector.get_foreign_keys(table_name)
        }
        if expected_fks != actual_fks:
            raise RuntimeError(f"Unsupported foreign-key definitions for {table_name}")

        expected_unique = {
            tuple(constraint.columns.keys())
            for constraint in model_table.constraints
            if isinstance(constraint, sa.UniqueConstraint)
        }
        actual_unique = {
            tuple(constraint.get("column_names") or ())
            for constraint in inspector.get_unique_constraints(table_name)
        }
        # Older releases had a global unique athlete index; the following
        # migration explicitly removes it and installs the active-only index.
        legacy_relationship_unique = table_name == "coaching_relationships" and actual_unique <= {("athlete_id",)}
        if expected_unique != actual_unique and not legacy_relationship_unique:
            raise RuntimeError(f"Unsupported unique constraints for {table_name}")

def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if existing_tables - {"alembic_version"}:
        validate_supported_legacy_schema(bind, existing_tables)

    # Add columns missing from known pre-Alembic versions before creating any
    # new tables. Unknown schemas are not stamped; normal migration errors surface.
    for table_name, column_specs in LEGACY_COLUMN_SPECS.items():
        if table_name not in existing_tables:
            continue
        present = {column["name"] for column in inspect(bind).get_columns(table_name)}
        for column_name, column_type, default, nullable in column_specs:
            if column_name in present:
                continue
            kwargs = {"nullable": nullable}
            if default is not None:
                kwargs["server_default"] = sa.text("'" + default.replace("'", "''") + "'")
            op.add_column(table_name, sa.Column(column_name, column_type, **kwargs))

    # The old startup ALTER added scope as nullable. Tighten the constraint to
    # match the intended model while preserving every set row and its values.
    if bind.dialect.name == "sqlite" and "exercise_sets" in existing_tables:
        scope_column = next(
            (column for column in inspect(bind).get_columns("exercise_sets") if column["name"] == "scope"),
            None,
        )
        if scope_column is not None and scope_column["nullable"]:
            with op.batch_alter_table("exercise_sets", recreate="always") as batch:
                batch.alter_column(
                    "scope", existing_type=sa.String(), nullable=False,
                    existing_server_default=sa.text("'both'"),
                )

    # Older SQLite databases had UNIQUE(athlete_id), which prevented ended
    # relationships from remaining as history. sqlite_autoindex entries cannot
    # be dropped. Rebuild into the current table definition and copy every row;
    # foreign keys are disabled by env.py before the migration transaction and
    # checked again before they are re-enabled.
    if bind.dialect.name == "sqlite" and "coaching_relationships" in set(inspect(bind).get_table_names()):
        global_unique = False
        for item in bind.exec_driver_sql("PRAGMA index_list('coaching_relationships')").fetchall():
            data = item._mapping
            if not data["unique"] or data.get("partial"):
                continue
            cols = bind.exec_driver_sql(f"PRAGMA index_info('{data['name']}')").fetchall()
            if [row._mapping["name"] for row in cols] == ["athlete_id"]:
                global_unique = True
                if not str(data["name"]).startswith("sqlite_autoindex_"):
                    bind.exec_driver_sql('DROP INDEX "' + data["name"].replace('"', '""') + '"')
                else:
                    break
        if global_unique:
            bind.exec_driver_sql("""CREATE TABLE coaching_relationships__alembic_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                coach_id VARCHAR NOT NULL REFERENCES users(id),
                athlete_id VARCHAR NOT NULL REFERENCES users(id),
                created_at DATETIME,
                ended_at DATETIME,
                updated_at DATETIME,
                deleted_at DATETIME
            )""")
            bind.exec_driver_sql("""INSERT INTO coaching_relationships__alembic_new
                (id, coach_id, athlete_id, created_at, ended_at, updated_at, deleted_at)
                SELECT id, coach_id, athlete_id, created_at, ended_at, updated_at, deleted_at
                FROM coaching_relationships""")
            bind.exec_driver_sql("DROP TABLE coaching_relationships")
            bind.exec_driver_sql("ALTER TABLE coaching_relationships__alembic_new RENAME TO coaching_relationships")

    # Frozen operation snapshot: later model changes belong in a new revision.
    create_missing_tables(op, existing_tables)

    create_missing_indexes(op, bind)

    # Historical data transformations formerly hidden in application startup.
    if "exercises" in inspect(bind).get_table_names():
        rows = bind.execute(sa.text("SELECT id, title, lift_category, movement_pattern FROM exercises")).fetchall()
        for row in rows:
            if not row[3]:
                bind.execute(sa.text("UPDATE exercises SET movement_pattern=:pattern WHERE id=:id"),
                             {"pattern": pattern_for(row[1], row[2]), "id": row[0]})
        bind.execute(sa.text("""UPDATE exercises SET variation=title
            WHERE (title='Squat' AND variation IN ('Competition','Competition Squat'))
               OR (title='Bench' AND variation IN ('Competition','Competition Bench'))
               OR (title='Deadlift' AND variation IN ('Competition','Competition Deadlift'))"""))

    # Idempotent conversion: legacy accessories become canonical exercise/set
    # records and are tombstoned by the established data conversion service.
    if "accessories" in inspect(bind).get_table_names():
        session = OrmSession(bind=bind)
        try:
            migrate_accessories_to_exercises(session, commit=False)
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

def downgrade():
    raise RuntimeError("This data-preserving baseline has no automatic downgrade; restore a verified backup instead.")
