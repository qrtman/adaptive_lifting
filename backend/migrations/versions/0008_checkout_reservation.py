"""Add one persistent Checkout slot per workspace/provider."""

from alembic import op
import sqlalchemy as sa

revision = "0008_checkout_reservation"
down_revision = "0007_billing_customer_mapping"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "billing_checkout_reservations",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workspace_id", sa.String(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("request_id", sa.String(), nullable=False),
        sa.Column("plan_key", sa.String(), nullable=False),
        sa.Column("provider_checkout_session_id", sa.String(), nullable=True),
        sa.Column("provider_checkout_url", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.UniqueConstraint("workspace_id", "provider", name="uq_checkout_workspace_provider"),
        sa.UniqueConstraint("provider", "request_id", name="uq_checkout_provider_request"),
        sa.CheckConstraint(
            "status IN ('CREATING', 'OPEN', 'COMPLETED', 'EXPIRED', 'CANCELED', 'FAILED')",
            name="ck_checkout_status",
        ),
    )
    op.create_index("ix_checkout_workspace_id", "billing_checkout_reservations", ["workspace_id"])


def downgrade():
    op.drop_index("ix_checkout_workspace_id", table_name="billing_checkout_reservations")
    op.drop_table("billing_checkout_reservations")
