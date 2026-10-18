"""Email verification, protected email outbox and shared authentication limits."""
from alembic import op
import sqlalchemy as sa

revision = "0011_email_verification"
down_revision = "0010_voucher_redemption_limits"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("email_verified_at", sa.DateTime(), nullable=True))
    op.add_column("users", sa.Column("email_verification_required", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("users", sa.Column("email_verification_legacy_exempt", sa.Boolean(), nullable=False, server_default=sa.false()))
    # Unknown historical password verification is never represented as verified.
    op.execute(sa.text("UPDATE users SET email_verification_legacy_exempt = true"))
    op.execute(sa.text("UPDATE users SET email_verified_at = CURRENT_TIMESTAMP WHERE google_sub IS NOT NULL"))
    op.create_table(
        "email_verification_tokens",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(), nullable=True),
        sa.Column("invalidated_at", sa.DateTime(), nullable=True),
        sa.Column("is_resend", sa.Boolean(), nullable=False),
        sa.CheckConstraint("length(token_hash) = 64", name="ck_email_token_hash_length"),
        sa.CheckConstraint("expires_at > created_at", name="ck_email_token_expiry"),
    )
    op.create_index("ix_email_verification_tokens_user_id", "email_verification_tokens", ["user_id"])
    op.create_index("ix_email_verification_tokens_expires_at", "email_verification_tokens", ["expires_at"])
    op.create_index("uq_email_token_active_user", "email_verification_tokens", ["user_id"], unique=True,
                    sqlite_where=sa.text("consumed_at IS NULL AND invalidated_at IS NULL"),
                    postgresql_where=sa.text("consumed_at IS NULL AND invalidated_at IS NULL"))
    with op.batch_alter_table("integration_outbox") as batch:
        batch.alter_column("connection_id", existing_type=sa.String(), nullable=True)
        batch.add_column(sa.Column("encrypted_payload", sa.String(), nullable=True))
        batch.add_column(sa.Column("verification_token_id", sa.String(), nullable=True))
        batch.create_foreign_key("fk_outbox_verification_token", "email_verification_tokens", ["verification_token_id"], ["id"])
        batch.create_index("ix_integration_outbox_verification_token_id", ["verification_token_id"])
    op.create_table("auth_security_subjects",
                    sa.Column("subject_hash", sa.String(64), primary_key=True),
                    sa.Column("updated_at", sa.DateTime(), nullable=False))
    op.create_table("auth_security_events",
                    sa.Column("id", sa.String(), primary_key=True),
                    sa.Column("subject_hash", sa.String(64), sa.ForeignKey("auth_security_subjects.subject_hash"), nullable=False),
                    sa.Column("created_at", sa.DateTime(), nullable=False))
    op.create_index("ix_auth_security_event_subject_time", "auth_security_events", ["subject_hash", "created_at"])


def downgrade():
    op.drop_table("auth_security_events")
    op.drop_table("auth_security_subjects")
    # Email jobs have no integration connection and cannot exist in the old schema.
    op.execute(sa.text("DELETE FROM integration_outbox WHERE provider = 'email-verification'"))
    with op.batch_alter_table("integration_outbox") as batch:
        batch.drop_index("ix_integration_outbox_verification_token_id")
        batch.drop_constraint("fk_outbox_verification_token", type_="foreignkey")
        batch.drop_column("verification_token_id")
        batch.drop_column("encrypted_payload")
        batch.alter_column("connection_id", existing_type=sa.String(), nullable=False)
    op.drop_table("email_verification_tokens")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("email_verification_legacy_exempt")
        batch.drop_column("email_verification_required")
        batch.drop_column("email_verified_at")
