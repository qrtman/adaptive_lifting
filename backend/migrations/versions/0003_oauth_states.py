"""Persist short-lived, one-time OAuth correlation state."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0003_oauth_states"
down_revision = "0002_google_subject"
branch_labels = None
depends_on = None


def upgrade():
    if "oauth_states" not in inspect(op.get_bind()).get_table_names():
        op.create_table(
            "oauth_states",
            sa.Column("state_hash", sa.String(), primary_key=True),
            sa.Column("user_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("provider", sa.String(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("return_to", sa.String(), nullable=True),
        )
    indexes = {i["name"] for i in inspect(op.get_bind()).get_indexes("oauth_states")}
    for name, column in (("ix_oauth_states_user_id", "user_id"),
                         ("ix_oauth_states_provider", "provider"),
                         ("ix_oauth_states_expires_at", "expires_at")):
        if name not in indexes:
            op.create_index(name, "oauth_states", [column])


def downgrade():
    op.drop_index("ix_oauth_states_expires_at", table_name="oauth_states")
    op.drop_index("ix_oauth_states_provider", table_name="oauth_states")
    op.drop_index("ix_oauth_states_user_id", table_name="oauth_states")
    op.drop_table("oauth_states")
