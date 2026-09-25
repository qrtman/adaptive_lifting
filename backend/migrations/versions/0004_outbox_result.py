"""Persist integration outbox job results and errors."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0004_outbox_result"
down_revision = "0003_oauth_states"
branch_labels = None
depends_on = None


def upgrade():
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("integration_outbox")}
    if "result" not in columns:
        op.add_column("integration_outbox", sa.Column("result", sa.String(), nullable=True))


def downgrade():
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("integration_outbox")}
    if "result" in columns:
        op.drop_column("integration_outbox", "result")
