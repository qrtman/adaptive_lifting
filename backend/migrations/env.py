from logging.config import fileConfig
import os
from alembic import context
from backend.database import Base, DATABASE_URL
import backend.database  # import all mapped tables

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)
config.set_main_option("sqlalchemy.url", os.environ.get("DATABASE_URL", DATABASE_URL).replace("%", "%%"))
target_metadata = Base.metadata

def run_migrations_offline():
    context.configure(url=config.get_main_option("sqlalchemy.url"), target_metadata=target_metadata,
                      literal_binds=True, dialect_opts={"paramstyle": "named"}, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online():
    connectable = backend.database.engine
    with connectable.connect() as connection:
        sqlite = connection.dialect.name == "sqlite"
        # SQLite only honors this pragma outside a transaction. Legacy
        # coaching_relationships may need a data-preserving table rebuild.
        if sqlite:
            connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
            connection.commit()
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True,
                          render_as_batch=connection.dialect.name == "sqlite")
        try:
            with context.begin_transaction():
                context.run_migrations()
            if sqlite:
                violations = connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
                connection.commit()
                if violations:
                    raise RuntimeError(f"SQLite foreign key check failed after migration: {violations[:10]}")
        finally:
            if sqlite:
                connection.commit()
                connection.exec_driver_sql("PRAGMA foreign_keys=ON")
                connection.commit()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
