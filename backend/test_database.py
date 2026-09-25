from sqlalchemy import text

from backend.database import create_database_engine, engine as application_engine


def _settings(connection):
    return {
        "foreign_keys": connection.scalar(text("PRAGMA foreign_keys")),
        "busy_timeout": connection.scalar(text("PRAGMA busy_timeout")),
        "journal_mode": connection.scalar(text("PRAGMA journal_mode")),
    }


def test_application_sqlite_engine_enforces_pragmas_on_each_pooled_connection():
    # Hold two connections at once so QueuePool must provide separate DBAPI
    # connections; checking a single checkout could miss a one-shot setup bug.
    first = application_engine.connect()
    second = application_engine.connect()
    try:
        for connection in (first, second):
            settings = _settings(connection)
            assert settings["foreign_keys"] == 1
            assert settings["busy_timeout"] == 5000
            assert settings["journal_mode"].lower() == "wal"

        first.execute(text("CREATE TABLE IF NOT EXISTS pragma_fk_parent (id INTEGER PRIMARY KEY)"))
        first.execute(text("CREATE TABLE IF NOT EXISTS pragma_fk_child (parent_id INTEGER REFERENCES pragma_fk_parent(id))"))
        first.commit()
        for connection in (first, second):
            try:
                connection.execute(text("INSERT INTO pragma_fk_child(parent_id) VALUES (999999)"))
                assert False, "foreign key constraint should reject an unknown parent"
            except Exception as exc:
                assert "FOREIGN KEY" in str(exc).upper()
                connection.rollback()
    finally:
        first.close()
        second.close()


def test_in_memory_sqlite_keeps_connection_pragmas_without_wal():
    test_engine = create_database_engine("sqlite:///:memory:")
    try:
        with test_engine.connect() as connection:
            settings = _settings(connection)
            assert settings["foreign_keys"] == 1
            assert settings["busy_timeout"] == 5000
            assert settings["journal_mode"].lower() == "memory"
    finally:
        test_engine.dispose()


def test_non_sqlite_engine_does_not_receive_sqlite_pragmas(monkeypatch):
    import backend.database as database

    calls = []

    def fake_create_engine(url, **kwargs):
        calls.append((url, kwargs))
        return object()

    monkeypatch.setattr(database, "create_engine", fake_create_engine)
    result = create_database_engine("postgresql://user:pass@localhost/example")

    assert result is not None
    assert calls == [("postgresql://user:pass@localhost/example", {})]
