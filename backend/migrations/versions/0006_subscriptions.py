"""Add provider-neutral workspace subscriptions."""

from alembic import op
import sqlalchemy as sa


revision = "0006_subscriptions"
down_revision = "0005_workspace_entitlements"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "subscriptions",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("workspace_id", sa.String(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("provider_customer_id", sa.String(), nullable=True),
        sa.Column("provider_subscription_id", sa.String(), nullable=False),
        sa.Column("plan_key", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("current_period_start", sa.DateTime(), nullable=True),
        sa.Column("current_period_end", sa.DateTime(), nullable=True),
        sa.Column("cancel_at_period_end", sa.Boolean(), nullable=False),
        sa.Column("canceled_at", sa.DateTime(), nullable=True),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "provider_subscription_id", name="uq_subscriptions_provider_subscription"),
        sa.CheckConstraint(
            "status IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED', 'INCOMPLETE')",
            name="ck_subscriptions_status",
        ),
    )
    op.create_index("ix_subscriptions_workspace_id", "subscriptions", ["workspace_id"], unique=False)
    op.create_index("ix_subscriptions_provider_customer_id", "subscriptions", ["provider_customer_id"], unique=False)
    op.create_index("ix_subscriptions_status", "subscriptions", ["status"], unique=False)


def downgrade():
    op.drop_index("ix_subscriptions_status", table_name="subscriptions")
    op.drop_index("ix_subscriptions_provider_customer_id", table_name="subscriptions")
    op.drop_index("ix_subscriptions_workspace_id", table_name="subscriptions")
    op.drop_table("subscriptions")
