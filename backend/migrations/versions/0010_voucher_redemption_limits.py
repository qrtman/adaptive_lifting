"""Add shared voucher redemption attempt counters."""

from alembic import op
import sqlalchemy as sa

revision = "0010_voucher_redemption_limits"
down_revision = "0009_vouchers"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "voucher_redemption_limits",
        sa.Column("subject_hash", sa.String(), primary_key=True),
        sa.Column("minute_started_at", sa.DateTime(), nullable=False),
        sa.Column("minute_count", sa.Integer(), nullable=False),
        sa.Column("hour_started_at", sa.DateTime(), nullable=False),
        sa.Column("hour_count", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("minute_count >= 0 AND hour_count >= 0", name="ck_voucher_limit_counts"),
    )


def downgrade():
    op.drop_table("voucher_redemption_limits")
