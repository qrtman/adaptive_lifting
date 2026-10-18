"""Add trusted billing customer mapping and provider event watermarks."""

from alembic import op
import sqlalchemy as sa


revision = "0007_billing_customer_mapping"
down_revision = "0006_subscriptions"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("subscriptions", sa.Column("provider_event_created_at", sa.DateTime(), nullable=True))
    op.add_column("subscriptions", sa.Column("provider_event_id", sa.String(), nullable=True))
    op.create_index(
        "ix_subscriptions_provider_event_created_at", "subscriptions",
        ["provider_event_created_at"], unique=False,
    )
    op.create_table(
        "billing_customers",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("workspace_id", sa.String(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("provider_customer_id", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "provider_customer_id", name="uq_billing_customers_provider_customer"),
        sa.UniqueConstraint("workspace_id", "provider", name="uq_billing_customers_workspace_provider"),
    )
    op.create_index("ix_billing_customers_workspace_id", "billing_customers", ["workspace_id"], unique=False)
    op.create_index("ix_billing_customers_provider_customer_id", "billing_customers", ["provider_customer_id"], unique=False)


def downgrade():
    op.drop_index("ix_billing_customers_provider_customer_id", table_name="billing_customers")
    op.drop_index("ix_billing_customers_workspace_id", table_name="billing_customers")
    op.drop_table("billing_customers")
    op.drop_index("ix_subscriptions_provider_event_created_at", table_name="subscriptions")
    op.drop_column("subscriptions", "provider_event_id")
    op.drop_column("subscriptions", "provider_event_created_at")
