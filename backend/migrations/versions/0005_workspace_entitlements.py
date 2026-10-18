"""Add workspaces, memberships, and access grants."""

from alembic import op
import sqlalchemy as sa


revision = "0005_workspace_entitlements"
down_revision = "0004_outbox_result"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "workspaces",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("owner_user_id", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_user_id", name="uq_workspaces_owner_user_id"),
    )
    op.create_index("ix_workspaces_owner_user_id", "workspaces", ["owner_user_id"], unique=False)

    op.create_table(
        "workspace_members",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("workspace_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.CheckConstraint("role IN ('OWNER', 'COACH', 'STAFF')", name="ck_workspace_members_role"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "user_id", name="uq_workspace_members_workspace_user"),
    )
    op.create_index("ix_workspace_members_workspace_id", "workspace_members", ["workspace_id"], unique=False)
    op.create_index("ix_workspace_members_user_id", "workspace_members", ["user_id"], unique=False)

    op.create_table(
        "access_grants",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("workspace_id", sa.String(), nullable=False),
        sa.Column("plan_key", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("starts_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("created_by_user_id", sa.String(), nullable=True),
        sa.Column("reason", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_access_grants_workspace_id", "access_grants", ["workspace_id"], unique=False)
    op.create_index("ix_access_grants_created_by_user_id", "access_grants", ["created_by_user_id"], unique=False)


def downgrade():
    op.drop_index("ix_access_grants_created_by_user_id", table_name="access_grants")
    op.drop_index("ix_access_grants_workspace_id", table_name="access_grants")
    op.drop_table("access_grants")
    op.drop_index("ix_workspace_members_user_id", table_name="workspace_members")
    op.drop_index("ix_workspace_members_workspace_id", table_name="workspace_members")
    op.drop_table("workspace_members")
    op.drop_index("ix_workspaces_owner_user_id", table_name="workspaces")
    op.drop_table("workspaces")
