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
        assert {"users", "workouts", "exercises", "exercise_sets", "alembic_version"} <= names
        assert engine.connect().scalar(text("SELECT version_num FROM alembic_version")) == "0002_google_subject"
        assert "google_sub" in {column["name"] for column in inspect(engine).get_columns("users")}
    finally:
        engine.dispose()

    result, _ = _run_python(
        tmp_path, "-c",
        "from fastapi.testclient import TestClient; from backend.main import app; "
        "c=TestClient(app); r=c.get('/api/health'); assert r.status_code == 200, r.text",
    )
    assert "AssertionError" not in result.stderr


def test_legacy_database_upgrade_preserves_data_and_is_repeatable(tmp_path):
    database_url = f"sqlite:///{(tmp_path / 'app.sqlite').as_posix()}"
    environment = os.environ.copy()
    environment["DATABASE_URL"] = database_url
    create_fixture = r"""
from sqlalchemy import create_engine
from backend.database import Base
engine=create_engine(__import__('os').environ['DATABASE_URL'])
Base.metadata.create_all(engine)
with engine.begin() as c:
 c.exec_driver_sql('DROP INDEX uq_coaching_relationships_active_athlete')
 c.exec_driver_sql('DROP INDEX uq_users_google_sub')
 c.exec_driver_sql('ALTER TABLE users DROP COLUMN google_sub')
 c.exec_driver_sql('''CREATE TABLE coaching_relationships_old (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coach_id VARCHAR NOT NULL REFERENCES users(id),
  athlete_id VARCHAR NOT NULL REFERENCES users(id),
  created_at DATETIME, ended_at DATETIME, updated_at DATETIME, deleted_at DATETIME,
  UNIQUE(athlete_id))''')
 c.exec_driver_sql('DROP TABLE coaching_relationships')
 c.exec_driver_sql('ALTER TABLE coaching_relationships_old RENAME TO coaching_relationships')
 c.exec_driver_sql("INSERT INTO users (id,email,hashed_password,role) VALUES ('coach','coach@example.test','hash','COACH'),('athlete','athlete@example.test','hash','ATHLETE')")
 c.exec_driver_sql("INSERT INTO workouts (id,date,dayLabel,title,color,status) VALUES ('w1','2026-09-25','D1','Session','blue','PLANNED')")
 c.exec_driver_sql("INSERT INTO exercises (id,lexo_rank,title,variation,tier,lift_category,movement_pattern,lift_note,tags_raw,top,vol,workout_id) VALUES ('ex1','a0','Squat','Competition','Comp','Squat','Knee Dominant',NULL,'','—','—','w1')")
 c.exec_driver_sql("INSERT INTO exercise_sets (id,lexo_rank,label,scope,plannedWeight,plannedReps,plannedRpe,exercise_id) VALUES ('set1','a0','Top','both',100,5,8,'ex1')")
 c.exec_driver_sql("INSERT INTO coaching_relationships (coach_id,athlete_id,created_at) VALUES ('coach','athlete','2025-01-01')")
 c.exec_driver_sql("INSERT INTO accessories (id,lexo_rank,name,prescribedSets,targetReps,targetRpe,workout_id) VALUES ('acc1','a0','Leg Press','2','10','8','w1')")
 for table, columns in {'users':['display_name'], 'workouts':['athlete_bw','block_label','week_label'], 'exercises':['tier','lift_category','movement_pattern','lift_note'], 'exercise_sets':['velocity','readiness','hrv','intensity_type','scope']}.items():
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
from backend.database import Base, User
engine=create_engine(__import__('os').environ['DATABASE_URL'])
Base.metadata.create_all(engine)
from sqlalchemy.orm import Session
with Session(engine) as db:
 db.add(User(id='existing',email='existing@example.test',hashed_password='hash',role='ATHLETE'))
 db.commit()
with engine.begin() as connection:
 connection.exec_driver_sql('DROP INDEX uq_users_google_sub')
 connection.exec_driver_sql('ALTER TABLE users DROP COLUMN google_sub')
engine.dispose()
"""
    subprocess.run([sys.executable, "-c", create_schema], cwd=ROOT, env=environment, check=True)
    _run_python(tmp_path, "-m", "backend.migrations.adopt", "validate")
    _run_python(tmp_path, "-m", "backend.migrations.adopt", "adopt")

    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT id FROM users WHERE id='existing'")) == "existing"
            assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "0002_google_subject"
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
