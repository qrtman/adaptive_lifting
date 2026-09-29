import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect, text

ROOT = Path(__file__).resolve().parents[1]


def _run_python(tmp_path, *args):
    database_url = f"sqlite:///{(tmp_path / 'app.sqlite').as_posix()}"
    environment = os.environ.copy()
    environment["DATABASE_URL"] = database_url
    return subprocess.run(
        [sys.executable, *args], cwd=ROOT, env=environment,
        check=True, capture_output=True, text=True,
    ), database_url


def test_fresh_database_migrates_repeats_and_starts(tmp_path):
    _run_python(tmp_path, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head")
    _run_python(tmp_path, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head")
    schema_check, _ = _run_python(tmp_path, "-m", "alembic", "-c", "alembic.ini", "check")
    assert "No new upgrade operations detected" in schema_check.stdout
    database_url = f"sqlite:///{(tmp_path / 'app.sqlite').as_posix()}"
    engine = create_engine(database_url)
    try:
        names = set(inspect(engine).get_table_names())
        assert {"users", "workouts", "exercises", "exercise_sets", "oauth_states", "workspaces", "workspace_members", "access_grants", "subscriptions", "billing_customers", "billing_checkout_reservations", "vouchers", "voucher_redemption_limits", "alembic_version"} <= names
        assert engine.connect().scalar(text("SELECT version_num FROM alembic_version")) == "0011_email_verification"
        assert "result" in {column["name"] for column in inspect(engine).get_columns("integration_outbox")}
        assert "google_sub" in {column["name"] for column in inspect(engine).get_columns("users")}
    finally:
        engine.dispose()

    result, _ = _run_python(
        tmp_path, "-c",
        "from fastapi.testclient import TestClient; from backend.main import app; "
        "c=TestClient(app); r=c.get('/api/health'); assert r.status_code == 200, r.text",
    )
    assert "AssertionError" not in result.stderr


def test_workspace_revision_downgrade_removes_only_phase_one_tables(tmp_path):
    _run_python(tmp_path, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head")
    _run_python(tmp_path, "-m", "alembic", "-c", "alembic.ini", "downgrade", "0004_outbox_result")
    engine = create_engine(f"sqlite:///{(tmp_path / 'app.sqlite').as_posix()}")
    try:
        names = set(inspect(engine).get_table_names())
        assert not {"workspaces", "workspace_members", "access_grants", "subscriptions"} & names
        assert {"users", "coaching_relationships", "integration_outbox", "alembic_version"} <= names
        assert engine.connect().scalar(text("SELECT version_num FROM alembic_version")) == "0004_outbox_result"
    finally:
        engine.dispose()


def test_subscription_revision_downgrade_removes_only_subscription_table(tmp_path):
    _run_python(tmp_path, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head")
    _run_python(tmp_path, "-m", "alembic", "-c", "alembic.ini", "downgrade", "0005_workspace_entitlements")
    engine = create_engine(f"sqlite:///{(tmp_path / 'app.sqlite').as_posix()}")
    try:
        names = set(inspect(engine).get_table_names())
        assert "subscriptions" not in names
        assert {"workspaces", "workspace_members", "access_grants", "alembic_version"} <= names
        assert engine.connect().scalar(text("SELECT version_num FROM alembic_version")) == "0005_workspace_entitlements"
    finally:
        engine.dispose()


def test_billing_mapping_revision_downgrade_removes_only_new_structures(tmp_path):
    _run_python(tmp_path, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head")
    _run_python(tmp_path, "-m", "alembic", "-c", "alembic.ini", "downgrade", "0006_subscriptions")
    engine = create_engine(f"sqlite:///{(tmp_path / 'app.sqlite').as_posix()}")
    try:
        inspector = inspect(engine)
        names = set(inspector.get_table_names())
        assert "billing_customers" not in names
        assert "subscriptions" in names
        columns = {column["name"] for column in inspector.get_columns("subscriptions")}
        assert not {"provider_event_created_at", "provider_event_id"} & columns
        assert engine.connect().scalar(text("SELECT version_num FROM alembic_version")) == "0006_subscriptions"
    finally:
        engine.dispose()


def test_checkout_revision_downgrade_and_reupgrade(tmp_path):
    _run_python(tmp_path, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head")
    _run_python(tmp_path, "-m", "alembic", "-c", "alembic.ini", "downgrade", "0007_billing_customer_mapping")
    engine = create_engine(f"sqlite:///{(tmp_path / 'app.sqlite').as_posix()}")
    try:
        names = set(inspect(engine).get_table_names())
        assert "billing_checkout_reservations" not in names
        assert "billing_customers" in names
    finally:
        engine.dispose()
    _run_python(tmp_path, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head")
    engine = create_engine(f"sqlite:///{(tmp_path / 'app.sqlite').as_posix()}")
    try:
        assert "billing_checkout_reservations" in inspect(engine).get_table_names()
    finally:
        engine.dispose()


def test_voucher_revision_downgrade_and_reupgrade(tmp_path):
    _run_python(tmp_path, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head")
    _run_python(tmp_path, "-m", "alembic", "-c", "alembic.ini", "downgrade", "0008_checkout_reservation")
    engine = create_engine(f"sqlite:///{(tmp_path / 'app.sqlite').as_posix()}")
    try:
        names = set(inspect(engine).get_table_names())
        assert "vouchers" not in names
        assert "billing_checkout_reservations" in names
    finally:
        engine.dispose()
    _run_python(tmp_path, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head")
    engine = create_engine(f"sqlite:///{(tmp_path / 'app.sqlite').as_posix()}")
    try:
        assert "vouchers" in inspect(engine).get_table_names()
    finally:
        engine.dispose()


def test_voucher_limit_revision_downgrade_and_reupgrade(tmp_path):
    _run_python(tmp_path, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head")
    _run_python(tmp_path, "-m", "alembic", "-c", "alembic.ini", "downgrade", "0009_vouchers")
    engine = create_engine(f"sqlite:///{(tmp_path / 'app.sqlite').as_posix()}")
    try:
        names = set(inspect(engine).get_table_names())
        assert "voucher_redemption_limits" not in names and "vouchers" in names
    finally:
        engine.dispose()
    _run_python(tmp_path, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head")
    engine = create_engine(f"sqlite:///{(tmp_path / 'app.sqlite').as_posix()}")
    try:
        assert "voucher_redemption_limits" in inspect(engine).get_table_names()
    finally:
        engine.dispose()


def test_legacy_database_upgrade_preserves_data_and_is_repeatable(tmp_path):
    database_url = f"sqlite:///{(tmp_path / 'app.sqlite').as_posix()}"
    environment = os.environ.copy()
    environment["DATABASE_URL"] = database_url
    create_fixture = r"""
from sqlalchemy import create_engine
from alembic import command
from alembic.config import Config
command.upgrade(Config("alembic.ini"), "0004_outbox_result")
engine=create_engine(__import__('os').environ['DATABASE_URL'])
with engine.begin() as c:
 c.exec_driver_sql('DROP TABLE IF EXISTS alembic_version')
 c.exec_driver_sql('DROP TABLE IF EXISTS auth_security_events')
 c.exec_driver_sql('DROP TABLE IF EXISTS auth_security_subjects')
 c.exec_driver_sql('DROP TABLE IF EXISTS email_verification_tokens')
 c.exec_driver_sql('DROP TABLE IF EXISTS access_grants')
 c.exec_driver_sql('DROP TABLE IF EXISTS subscriptions')
 c.exec_driver_sql('DROP TABLE IF EXISTS vouchers')
 c.exec_driver_sql('DROP TABLE IF EXISTS voucher_redemption_limits')
 c.exec_driver_sql('DROP TABLE IF EXISTS billing_checkout_reservations')
 c.exec_driver_sql('DROP TABLE IF EXISTS billing_customers')
 c.exec_driver_sql('DROP TABLE IF EXISTS workspace_members')
 c.exec_driver_sql('DROP TABLE IF EXISTS workspaces')
 c.exec_driver_sql('DROP INDEX uq_coaching_relationships_active_athlete')
 c.exec_driver_sql('DROP INDEX uq_users_google_sub')
 c.exec_driver_sql('ALTER TABLE users DROP COLUMN google_sub')
 c.exec_driver_sql('''CREATE TABLE coaching_relationships_old (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coach_id VARCHAR NOT NULL REFERENCES users(id),
  athlete_id VARCHAR NOT NULL REFERENCES users(id),
  created_at DATETIME, ended_at DATETIME, updated_at DATETIME, deleted_at DATETIME,
  UNIQUE(athlete_id))''')
 c.exec_driver_sql('DROP TABLE IF EXISTS coaching_relationships')
 c.exec_driver_sql('ALTER TABLE coaching_relationships_old RENAME TO coaching_relationships')
 c.exec_driver_sql("INSERT INTO users (id,email,hashed_password,role) VALUES ('coach','coach@example.test','hash','COACH'),('athlete','athlete@example.test','hash','ATHLETE')")
 c.exec_driver_sql("INSERT INTO workouts (id,date,dayLabel,title,color,status) VALUES ('w1','2026-09-25','D1','Session','blue','PLANNED')")
 c.exec_driver_sql("INSERT INTO exercises (id,lexo_rank,title,variation,tier,lift_category,movement_pattern,lift_note,tags_raw,top,vol,workout_id) VALUES ('ex1','a0','Squat','Competition','Comp','Squat','Knee Dominant',NULL,'','—','—','w1')")
 c.exec_driver_sql("INSERT INTO exercise_sets (id,lexo_rank,label,scope,plannedWeight,plannedReps,plannedRpe,exercise_id) VALUES ('set1','a0','Top','both',100,5,8,'ex1')")
 c.exec_driver_sql("INSERT INTO coaching_relationships (coach_id,athlete_id,created_at) VALUES ('coach','athlete','2025-01-01')")
 c.exec_driver_sql("INSERT INTO accessories (id,lexo_rank,name,prescribedSets,targetReps,targetRpe,workout_id) VALUES ('acc1','a0','Leg Press','2','10','8','w1')")
 for table, columns in {'users':['display_name'], 'workouts':['athlete_bw','block_label','week_label'], 'exercises':['tier','lift_category','movement_pattern','lift_note'], 'exercise_sets':['velocity','readiness','hrv','intensity_type','scope'], 'integration_outbox':['result']}.items():
  for column in columns:
   c.exec_driver_sql(f'ALTER TABLE {table} DROP COLUMN {column}')
engine.dispose()
"""
    subprocess.run([sys.executable, "-c", create_fixture], cwd=ROOT, env=environment, check=True)
    _run_python(tmp_path, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head")
    _run_python(tmp_path, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head")
    _run_python(tmp_path, "-m", "backend.migrations.adopt", "validate")

    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT count(*) FROM users")) == 2
            assert connection.scalar(text("SELECT count(*) FROM coaching_relationships")) == 1
            assert connection.scalar(text("SELECT count(*) FROM exercises WHERE id='acc1'")) == 1
            assert connection.scalar(text("SELECT count(*) FROM exercise_sets WHERE exercise_id='acc1'")) == 2
            assert connection.scalar(text("SELECT plannedWeight FROM exercise_sets WHERE id='set1'")) == 100
            assert connection.scalar(text("SELECT scope FROM exercise_sets WHERE id='set1'")) == "both"
            assert "google_sub" in {column["name"] for column in inspect(connection).get_columns("users")}
            assert "result" in {column["name"] for column in inspect(connection).get_columns("integration_outbox")}
            assert connection.scalar(text("SELECT deleted_at FROM accessories WHERE id='acc1'")) is not None
            assert connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
    finally:
        engine.dispose()

    _run_python(
        tmp_path, "-c",
        "from fastapi.testclient import TestClient; from backend.main import app; "
        "c=TestClient(app); r=c.get('/api/health'); assert r.status_code == 200, r.text",
    )

    _run_python(
        tmp_path, "-c",
        "from fastapi.testclient import TestClient; from backend.main import app; "
        "c=TestClient(app); r=c.get('/api/health'); assert r.status_code == 200, r.text",
    )


def test_exact_legacy_schema_requires_validation_before_adoption(tmp_path):
    database_url = f"sqlite:///{(tmp_path / 'app.sqlite').as_posix()}"
    environment = os.environ.copy()
    environment["DATABASE_URL"] = database_url
    create_schema = r"""
from sqlalchemy import create_engine
from alembic import command
from alembic.config import Config
command.upgrade(Config("alembic.ini"), "0004_outbox_result")
engine=create_engine(__import__('os').environ['DATABASE_URL'])
with engine.begin() as connection:
    connection.exec_driver_sql('DROP TABLE IF EXISTS alembic_version')
    connection.exec_driver_sql('DROP TABLE IF EXISTS access_grants')
    connection.exec_driver_sql('DROP TABLE IF EXISTS subscriptions')
    connection.exec_driver_sql('DROP TABLE IF EXISTS vouchers')
    connection.exec_driver_sql('DROP TABLE IF EXISTS voucher_redemption_limits')
    connection.exec_driver_sql('DROP TABLE IF EXISTS billing_checkout_reservations')
    connection.exec_driver_sql('DROP TABLE IF EXISTS billing_customers')
    connection.exec_driver_sql('DROP TABLE IF EXISTS workspace_members')
    connection.exec_driver_sql('DROP TABLE IF EXISTS workspaces')
with engine.begin() as connection:
 connection.exec_driver_sql("INSERT INTO users(id,email,hashed_password,role) VALUES ('existing','existing@example.test','hash','ATHLETE')")
with engine.begin() as connection:
 connection.exec_driver_sql('DROP TABLE IF EXISTS oauth_states')
 connection.exec_driver_sql('DROP INDEX uq_users_google_sub')
 connection.exec_driver_sql('ALTER TABLE users DROP COLUMN google_sub')
 connection.exec_driver_sql('ALTER TABLE integration_outbox DROP COLUMN result')
engine.dispose()
"""
    subprocess.run([sys.executable, "-c", create_schema], cwd=ROOT, env=environment, check=True)
    _run_python(tmp_path, "-m", "backend.migrations.adopt", "validate")
    _run_python(tmp_path, "-m", "backend.migrations.adopt", "adopt")

    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT id FROM users WHERE id='existing'")) == "existing"
            assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "0011_email_verification"
            assert connection.scalar(text("SELECT google_sub FROM users WHERE id='existing'")) is None
    finally:
        engine.dispose()

    _run_python(
        tmp_path, "-c",
        "from fastapi.testclient import TestClient; from backend.main import app; "
        "c=TestClient(app); r=c.get('/api/health'); assert r.status_code == 200, r.text",
    )


def test_unknown_schema_is_rejected_without_being_stamped(tmp_path):
    database_url = f"sqlite:///{(tmp_path / 'app.sqlite').as_posix()}"
    environment = os.environ.copy()
    environment["DATABASE_URL"] = database_url
    engine = create_engine(database_url)
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE unrelated (id INTEGER PRIMARY KEY, payload TEXT)")
        connection.exec_driver_sql("INSERT INTO unrelated VALUES (1, 'keep')")
    engine.dispose()

    result = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
        cwd=ROOT, env=environment, capture_output=True, text=True,
    )
    assert result.returncode != 0
    assert "Unsupported unversioned database tables" in result.stderr
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT payload FROM unrelated WHERE id=1")) == "keep"
            assert connection.scalar(text("SELECT count(*) FROM alembic_version")) == 0
    finally:
        engine.dispose()


def test_startup_rejects_pending_migrations_without_mutating_schema(tmp_path):
    environment = os.environ.copy()
    environment["DATABASE_URL"] = f"sqlite:///{(tmp_path / 'app.sqlite').as_posix()}"
    startup_check = r"""
from fastapi.testclient import TestClient
from backend.main import app
try:
 with TestClient(app):
  raise AssertionError('unmigrated database unexpectedly started')
except RuntimeError as exc:
 assert 'Database migration required' in str(exc)
"""
    subprocess.run([sys.executable, "-c", startup_check], cwd=ROOT, env=environment, check=True)
    engine = create_engine(environment["DATABASE_URL"])
    try:
        assert inspect(engine).get_table_names() == []
    finally:
        engine.dispose()



def test_email_migration_preserves_unknown_verification_sessions_links_and_subscriptions(tmp_path):
    _run_python(tmp_path, "-m", "alembic", "upgrade", "0010_voucher_redemption_limits")
    url = f"sqlite:///{(tmp_path / 'app.sqlite').as_posix()}"
    engine = create_engine(url)
    with engine.begin() as db:
        db.execute(text("INSERT INTO users(id,email,hashed_password,role,subscription_status) VALUES ('coach','coach@example.com','hash','COACH','active'), ('athlete','athlete@example.com','hash','ATHLETE','active')"))
        db.execute(text("INSERT INTO users(id,email,hashed_password,role,google_sub) VALUES ('google','google@example.com','hash','ATHLETE','stable-sub')"))
        db.execute(text("INSERT INTO sessions(id,user_id,jwt_id,expires_at) VALUES ('session','coach','session','2030-01-01')"))
        db.execute(text("INSERT INTO coaching_relationships(coach_id,athlete_id,created_at) VALUES ('coach','athlete','2025-01-01')"))
        db.execute(text("INSERT INTO workspaces(id,name,owner_user_id,created_at,updated_at) VALUES ('workspace','Coach','coach','2025-01-01','2025-01-01')"))
        db.execute(text("INSERT INTO subscriptions(id,workspace_id,provider,provider_subscription_id,plan_key,status,cancel_at_period_end,created_at,updated_at) VALUES ('subscription','workspace','stripe','sub_preserved','coach_pro','ACTIVE',false,'2025-01-01','2025-01-01')"))
        db.execute(text("INSERT INTO access_grants(id,workspace_id,plan_key,source,starts_at,created_at) VALUES ('grant','workspace','coach_pro','beta','2025-01-01','2025-01-01')"))
        before = {table: db.execute(text(f"SELECT * FROM {table}")).fetchall() for table in ('sessions', 'coaching_relationships', 'subscriptions', 'access_grants', 'workspaces')}
    _run_python(tmp_path, "-m", "alembic", "upgrade", "head")
    _run_python(tmp_path, "-m", "alembic", "upgrade", "head")
    with engine.connect() as db:
        for table, rows in before.items():
            assert db.execute(text(f"SELECT * FROM {table}")).fetchall() == rows
        assert db.execute(text("SELECT email_verified_at, email_verification_legacy_exempt FROM users WHERE id='coach'")).one() == (None, 1)
        assert db.scalar(text("SELECT email_verified_at FROM users WHERE id='google'")) is not None
        assert db.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
    _run_python(tmp_path, "-m", "alembic", "downgrade", "0010_voucher_redemption_limits")
    with engine.connect() as db:
        for table, rows in before.items():
            assert db.execute(text(f"SELECT * FROM {table}")).fetchall() == rows
    _run_python(tmp_path, "-m", "alembic", "upgrade", "head")
    _run_python(tmp_path, "-m", "alembic", "check")
    engine.dispose()
