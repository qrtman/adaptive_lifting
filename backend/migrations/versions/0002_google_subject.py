"""Persist Google OpenID subjects for safe account linking."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0002_google_subject"
down_revision = "0001_current_schema"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("users")}
    if "google_sub" not in columns:
        op.add_column("users", sa.Column("google_sub", sa.String(), nullable=True))
    indexes = {index["name"] for index in inspect(bind).get_indexes("users")}
    if "uq_users_google_sub" not in indexes:
        op.create_index("uq_users_google_sub", "users", ["google_sub"], unique=True)


def downgrade():
    op.drop_index("uq_users_google_sub", table_name="users")
    op.drop_column("users", "google_sub")
