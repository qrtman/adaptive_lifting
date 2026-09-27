"""Add account-bound prepaid access vouchers."""

from alembic import op
import sqlalchemy as sa

revision = "0009_vouchers"
down_revision = "0008_checkout_reservation"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "vouchers",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("code_hash", sa.String(), nullable=False, unique=True),
        sa.Column("code_prefix", sa.String(), nullable=True),
        sa.Column("plan_key", sa.String(), nullable=False),
        sa.Column("duration_days", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("assigned_user_id", sa.String(), nullable=True),
        sa.Column("payment_reference", sa.String(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("redeemed_at", sa.DateTime(), nullable=True),
        sa.Column("redeemed_by_user_id", sa.String(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("created_by_user_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("notes", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["assigned_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["redeemed_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.CheckConstraint("duration_days > 0", name="ck_vouchers_duration_positive"),
    )
    op.create_index("ix_vouchers_assigned_user_id", "vouchers", ["assigned_user_id"])
    op.create_index("ix_vouchers_code_prefix", "vouchers", ["code_prefix"])


def downgrade():
    op.drop_index("ix_vouchers_code_prefix", table_name="vouchers")
    op.drop_index("ix_vouchers_assigned_user_id", table_name="vouchers")
    op.drop_table("vouchers")
