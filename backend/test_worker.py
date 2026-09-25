import json
import threading
from contextlib import contextmanager

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from .database import Base, IntegrationConnection, IntegrationOutbox, User
from . import integrations, worker


@pytest.fixture
def worker_sessions():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False)
    db = factory()
    db.add(User(id="worker-user", email="worker@example.com", hashed_password="x", role="COACH"))
    db.add(IntegrationConnection(
        id="worker-connection", user_id="worker-user", provider="google-sheets", status="active"
    ))
    db.add(IntegrationOutbox(
        id="worker-job", provider="google-sheets", connection_id="worker-connection",
        payload_json=json.dumps({"mesocycle_id": "m", "athlete_id": "a"}), status="queued",
        attempt_count=0,
    ))
    db.commit()
    db.close()
    yield factory
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_outbox_claim_is_atomic_and_job_is_processed_once(worker_sessions, monkeypatch):
    called = []

    def fake_process(job, db):
        called.append(job.id)
        job.status = "success"
        return True

    monkeypatch.setattr(integrations, "process_sheets_publish_job", fake_process)
    assert integrations.process_next_outbox_job(worker_sessions) is True
    assert integrations.process_next_outbox_job(worker_sessions) is False
    assert called == ["worker-job"]
    db = worker_sessions()
    job = db.query(IntegrationOutbox).one()
    assert job.status == "success"
    assert job.attempt_count == 1
    db.close()


def test_worker_initializes_and_recovers_from_processing_error(monkeypatch):
    initialized = []
    attempts = []
    stopping = threading.Event()

    # run_worker imports this symbol lazily so patch the owning module.
    import backend.main as main
    monkeypatch.setattr(main, "on_startup", lambda: initialized.append(True))

    def transient(_factory):
        attempts.append(True)
        if len(attempts) == 1:
            raise RuntimeError("temporary database issue")
        stopping.set()
        return False

    monkeypatch.setattr(integrations, "process_next_outbox_job", transient)
    worker.run_worker(stop_event=stopping, poll_interval=0)
    assert initialized == [True]
    assert len(attempts) == 2


def test_api_startup_has_no_embedded_worker(monkeypatch):
    import backend.main as main
    from alembic.runtime.migration import MigrationContext
    from alembic.script import ScriptDirectory

    class FakeConfig:
        def __init__(self, *_args, **_kwargs):
            pass

    class FakeConnection:
        pass

    @contextmanager
    def fake_connect():
        yield FakeConnection()

    class FakeContext:
        def get_current_revision(self):
            return "head"

    monkeypatch.setattr("alembic.config.Config", FakeConfig)
    monkeypatch.setattr(ScriptDirectory, "from_config", lambda _config: type("Scripts", (), {"get_current_head": lambda self: "head"})())
    monkeypatch.setattr(MigrationContext, "configure", lambda _connection: FakeContext())
    monkeypatch.setattr(main.engine, "connect", fake_connect)
    called = []
    monkeypatch.setattr(integrations, "process_next_outbox_job", lambda *_args: called.append(True))
    main.on_startup()
    assert called == []
    assert main.on_startup in main.app.router.on_startup
