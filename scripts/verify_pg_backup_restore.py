"""Disposable PostgreSQL 16 backup/restore and voucher-secret dependency check.

Requires PHASE4D_POSTGRES_URL and LAUNCH_PG_CONTAINER. The source database must
be a disposable localhost database named launch_*. Never point this at prod.
"""

import os
import subprocess
import sys
import uuid

import bcrypt
from sqlalchemy import create_engine, inspect
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from backend.database import (
    AccessGrant, AuditEvent, BillingCheckoutReservation, BillingCustomer,
    CoachingRelationship, Subscription, User, WebhookEvent, Workout,
    Workspace, WorkspaceMember,
)
from backend.vouchers import create_voucher, inspect_voucher, redeem_voucher


def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL)


def main():
    source_url = make_url(os.environ["PHASE4D_POSTGRES_URL"])
    container = os.environ["LAUNCH_PG_CONTAINER"]
    if (source_url.get_backend_name() != "postgresql" or
            source_url.host not in {"127.0.0.1", "localhost"} or
            not source_url.database.startswith("launch_") or
            not container.startswith("launch-")):
        raise RuntimeError("Restore verification accepts only disposable localhost launch_* databases")
    restore_name = "launch_restore_" + uuid.uuid4().hex[:12]
    dump_path = "/tmp/" + restore_name + ".dump"
    user = source_url.username
    source_engine = create_engine(source_url)
    restored_engine = None
    previous_secret = os.environ.get("VOUCHER_CODE_SECRET")
    stable_secret = "disposable-restore-voucher-secret-ABCD-5678-XYZ"
    os.environ["VOUCHER_CODE_SECRET"] = stable_secret
    os.environ.pop("VOUCHER_BILLING_ENABLED", None)
    suffix = uuid.uuid4().hex
    coach_id, athlete_id, workspace_id = ("coach-" + suffix, "athlete-" + suffix, "workspace-" + suffix)
    email = f"restore-{suffix}@example.test"
    password = "disposable-restore-password"
    try:
        with Session(source_engine) as db:
            coach = User(id=coach_id, email=email, hashed_password=bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode(), role="COACH")
            athlete = User(id=athlete_id, email=f"athlete-{suffix}@example.test", hashed_password="unused", role="ATHLETE")
            db.add_all([coach, athlete])
            db.flush()
            db.add(Workspace(id=workspace_id, name="Restore rehearsal", owner_user_id=coach_id))
            db.add(WorkspaceMember(id=str(uuid.uuid4()), workspace_id=workspace_id, user_id=coach_id, role="OWNER"))
            db.add(CoachingRelationship(coach_id=coach_id, athlete_id=athlete_id))
            db.add(Workout(id="workout-" + suffix, date="2026-09-28", dayLabel="D1", title="Restore plan", color="blue", status="PLANNED", owner_id=athlete_id))
            db.flush()
            db.add(BillingCustomer(id=str(uuid.uuid4()), workspace_id=workspace_id, provider="stripe", provider_customer_id="cus_restore_" + suffix))
            db.add(Subscription(id=str(uuid.uuid4()), workspace_id=workspace_id, provider="stripe", provider_subscription_id="sub_restore_" + suffix, plan_key="coach_starter", status="ACTIVE"))
            db.add(BillingCheckoutReservation(id=str(uuid.uuid4()), workspace_id=workspace_id, provider="stripe", request_id=str(uuid.uuid4()), plan_key="coach_starter", status="COMPLETED"))
            db.add(WebhookEvent(id=str(uuid.uuid4()), provider="stripe", external_event_id="evt_restore_" + suffix, status="PROCESSED"))
            issued, issued_code = create_voucher(db, assigned_user=coach, plan_key="coach_pro", duration_days=30)
            pending, pending_code = create_voucher(db, assigned_user=coach, plan_key="coach_pro", duration_days=30)
            redeem_voucher(db, code=issued_code, user=coach)
            db.commit()
            pending_id = pending.id
        run("docker", "exec", container, "pg_dump", "-U", user, "-Fc", "-f", dump_path, source_url.database)
        run("docker", "exec", container, "createdb", "-U", user, restore_name)
        run("docker", "exec", container, "pg_restore", "-U", user, "-d", restore_name, dump_path)
        restore_url = source_url.set(database=restore_name)
        restored_engine = create_engine(restore_url)
        expected_tables = {"users", "workspaces", "workspace_members", "access_grants", "subscriptions",
                           "billing_customers", "billing_checkout_reservations", "vouchers",
                           "voucher_redemption_limits", "webhook_events", "audit_events", "workouts"}
        assert expected_tables <= set(inspect(restored_engine).get_table_names())
        with Session(restored_engine) as db:
            assert db.get(User, coach_id).email == email
            assert db.get(Workspace, workspace_id).owner_user_id == coach_id
            assert db.get(Workout, "workout-" + suffix).owner_id == athlete_id
            assert db.query(CoachingRelationship).filter_by(coach_id=coach_id, athlete_id=athlete_id).count() == 1
            assert db.query(Subscription).filter_by(workspace_id=workspace_id).count() == 1
            assert db.query(BillingCustomer).filter_by(workspace_id=workspace_id).count() == 1
            assert db.query(BillingCheckoutReservation).filter_by(workspace_id=workspace_id).count() == 1
            assert db.query(WebhookEvent).filter_by(external_event_id="evt_restore_" + suffix).count() == 1
            assert db.query(AccessGrant).filter_by(workspace_id=workspace_id).count() == 1
            assert db.query(AuditEvent).filter_by(event_type="VOUCHER_REDEEMED").count() >= 1
            assert inspect_voucher(db, pending_code).id == pending_id
            os.environ["VOUCHER_CODE_SECRET"] = "different-disposable-voucher-secret-WXYZ-1234"
            assert inspect_voucher(db, pending_code) is None
            os.environ["VOUCHER_CODE_SECRET"] = stable_secret
            assert inspect_voucher(db, pending_code).id == pending_id
            redeem_voucher(db, code=pending_code, user=db.get(User, coach_id))
            db.commit()
            assert db.query(AccessGrant).filter_by(reason=f"voucher:{pending_id}").count() == 1
        child_env = dict(os.environ, DATABASE_URL=restore_url.render_as_string(hide_password=False), JWT_SECRET_CURRENT="disposable-restore-jwt-secret-ABCD-5678",
                         CORS_ALLOWED_ORIGINS="http://testserver", COOKIE_SECURE="false", APP_ENV="development")
        startup = (
            "from fastapi.testclient import TestClient\nfrom backend.main import app\n"
            "with TestClient(app) as c:\n"
            f" r=c.post('/api/auth/login', data={{'username':'{email}','password':'{password}'}})\n"
            " assert r.status_code==200, r.text\n"
            " assert c.get('/api/account/access').status_code==200\n"
        )
        subprocess.run([sys.executable, "-c", startup], env=child_env, check=True, stdout=subprocess.DEVNULL)
        migration = subprocess.run(
            [sys.executable, "-m", "alembic", "-c", "alembic.ini", "current"],
            env=child_env, check=True, capture_output=True, text=True,
        )
        assert "0010_voucher_redemption_limits" in migration.stdout
        print("PostgreSQL backup, restore, login, data, and voucher-secret verification: passed")
    finally:
        if restored_engine is not None:
            restored_engine.dispose()
        source_engine.dispose()
        if previous_secret is None:
            os.environ.pop("VOUCHER_CODE_SECRET", None)
        else:
            os.environ["VOUCHER_CODE_SECRET"] = previous_secret
        subprocess.run(["docker", "exec", container, "dropdb", "-U", user, "--if-exists", restore_name], check=False, stdout=subprocess.DEVNULL)
        subprocess.run(["docker", "exec", container, "rm", "-f", dump_path], check=False, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
