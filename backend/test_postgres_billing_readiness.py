"""Run with PHASE4D_POSTGRES_URL pointing at a disposable migrated database."""

import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from backend.billing.checkout_reservations import ReservationConflict, claim_checkout
from backend.billing.stripe_adapter import process_stripe_event
from backend.billing_customers import link_billing_customer
from backend.database import (
    AccessGrant, AuditEvent, BillingCheckoutReservation, BillingCustomer, Subscription, User, Voucher,
    WebhookEvent, Workspace, WorkspaceMember,
)
from backend.test_stripe_adapter import _event, _subscription_payload
from backend.vouchers import VoucherInvalid, create_voucher, redeem_voucher
from backend.voucher_rate_limit import record_voucher_attempt


@pytest.fixture
def pg(monkeypatch):
    url = os.environ.get("PHASE4D_POSTGRES_URL")
    if not url:
        pytest.skip("PHASE4D_POSTGRES_URL is not configured")
    engine = create_engine(url, pool_pre_ping=True)
    if engine.dialect.name != "postgresql":
        pytest.fail("PHASE4D_POSTGRES_URL must point to PostgreSQL")
    for key, value in {
        "STRIPE_PRICE_COACH_STARTER": "price_starter_test",
        "STRIPE_PRICE_COACH_PRO": "price_pro_test",
        "STRIPE_PRICE_COACH_UNLIMITED": "price_unlimited_test",
    }.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("VOUCHER_CODE_SECRET", "test-only-stable-voucher-hmac-key-32-bytes")
    yield sessionmaker(bind=engine, autoflush=False)
    engine.dispose()


def _workspace(db):
    suffix = uuid.uuid4().hex
    user = User(id=suffix, email=f"pg-{suffix}@example.com", hashed_password="test", role="COACH")
    workspace = Workspace(id=suffix, name="PostgreSQL readiness", owner_user_id=suffix)
    db.add(user)
    db.flush()
    db.add(workspace)
    db.flush()
    return suffix


def test_postgres_uniqueness_and_foreign_keys(pg):
    with pg.begin() as db:
        workspace_id = _workspace(db)
        other_workspace_id = _workspace(db)
        db.add(WorkspaceMember(id=str(uuid.uuid4()), workspace_id=workspace_id, user_id=workspace_id, role="OWNER"))
        db.add(BillingCustomer(id=str(uuid.uuid4()), workspace_id=workspace_id, provider="stripe", provider_customer_id=f"cus_{workspace_id}"))
        db.add(BillingCheckoutReservation(id=str(uuid.uuid4()), workspace_id=workspace_id, provider="stripe",
                                          request_id=str(uuid.uuid4()), plan_key="coach_pro", status="OPEN"))
        db.add(Subscription(id=str(uuid.uuid4()), workspace_id=workspace_id, provider="stripe",
                            provider_subscription_id=f"sub_{workspace_id}", plan_key="coach_pro", status="ACTIVE"))
        db.add(WebhookEvent(id=str(uuid.uuid4()), provider="stripe", external_event_id=f"evt_{workspace_id}", status="PROCESSED"))
        db.flush()
        duplicates = [
            Workspace(id=str(uuid.uuid4()), name="duplicate owner", owner_user_id=workspace_id),
            WorkspaceMember(id=str(uuid.uuid4()), workspace_id=workspace_id, user_id=workspace_id, role="OWNER"),
            BillingCustomer(id=str(uuid.uuid4()), workspace_id=workspace_id, provider="stripe", provider_customer_id=f"cus_other_{workspace_id}"),
            BillingCustomer(id=str(uuid.uuid4()), workspace_id=other_workspace_id, provider="stripe", provider_customer_id=f"cus_{workspace_id}"),
            BillingCheckoutReservation(id=str(uuid.uuid4()), workspace_id=workspace_id, provider="stripe", request_id=str(uuid.uuid4()), plan_key="coach_pro", status="OPEN"),
            BillingCheckoutReservation(id=str(uuid.uuid4()), workspace_id=other_workspace_id, provider="stripe", request_id=db.query(BillingCheckoutReservation).filter_by(workspace_id=workspace_id).one().request_id, plan_key="coach_pro", status="OPEN"),
            Subscription(id=str(uuid.uuid4()), workspace_id=workspace_id, provider="stripe", provider_subscription_id=f"sub_{workspace_id}", plan_key="coach_pro", status="ACTIVE"),
            WebhookEvent(id=str(uuid.uuid4()), provider="stripe", external_event_id=f"evt_{workspace_id}", status="PROCESSED"),
            WorkspaceMember(id=str(uuid.uuid4()), workspace_id="missing-workspace", user_id=workspace_id, role="OWNER"),
        ]
        for duplicate in duplicates:
            with pytest.raises(IntegrityError):
                with db.begin_nested():
                    db.add(duplicate)
                    db.flush()


def test_postgres_two_workers_claim_one_checkout(pg):
    with pg.begin() as db:
        workspace_id = _workspace(db)

    def claim(request_id):
        with pg() as db:
            try:
                row, action = claim_checkout(db, workspace_id=workspace_id, provider="stripe",
                                             request_id=request_id, plan_key="coach_pro", api_key="unused")
                time.sleep(0.15)
                db.commit()
                return action
            except ReservationConflict as exc:
                db.rollback()
                return exc.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(claim, [str(uuid.uuid4()), str(uuid.uuid4())]))
    assert sorted(results) == ["BILLING_CHECKOUT_IN_PROGRESS", "create"]
    with pg() as db:
        assert db.query(BillingCheckoutReservation).filter_by(workspace_id=workspace_id, status="CREATING").count() == 1


def test_postgres_two_workers_link_one_billing_customer(pg):
    with pg.begin() as db:
        workspace_id = _workspace(db)

    def link(_):
        with pg() as db:
            mapping = link_billing_customer(db, workspace_id=workspace_id, provider="stripe",
                                            provider_customer_id=f"cus_{workspace_id}")
            db.commit()
            return mapping.provider_customer_id

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(link, range(2))) == [f"cus_{workspace_id}"] * 2
    with pg() as db:
        assert db.query(BillingCustomer).filter_by(workspace_id=workspace_id).count() == 1
        assert db.query(AuditEvent).filter_by(event_type="BILLING_CUSTOMER_LINKED").filter_by(resource_type="BillingCustomer").count() >= 1


def test_postgres_webhook_duplicate_and_stale_order(pg):
    with pg.begin() as db:
        workspace_id = _workspace(db)
        customer_id = f"cus_{workspace_id}"
        db.add(BillingCustomer(id=str(uuid.uuid4()), workspace_id=workspace_id,
                               provider="stripe", provider_customer_id=customer_id))
    event = _event(f"evt_{uuid.uuid4().hex}", "customer.subscription.created",
                   _subscription_payload(customer_id=customer_id, sub_id=f"sub_{workspace_id}"))

    def deliver(_):
        with pg() as db:
            result = process_stripe_event(db, event)
            db.commit()
            return result

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(deliver, range(2))) == ["duplicate", "processed"]
    with pg() as db:
        assert db.query(WebhookEvent).filter_by(external_event_id=event["id"]).count() == 1
        assert db.query(Subscription).filter_by(provider_customer_id=customer_id).count() == 1
        subscription_id = db.query(Subscription).filter_by(provider_customer_id=customer_id).one().id
        assert db.query(AuditEvent).filter_by(event_type="SUBSCRIPTION_CREATED", resource_id=subscription_id).count() == 1

    created = event["created"] + 10
    canceled = _event(f"evt_z_{uuid.uuid4().hex}", "customer.subscription.deleted",
                      _subscription_payload(customer_id=customer_id, sub_id=f"sub_{workspace_id}", status="canceled"), created=created)
    older = _event(f"evt_a_{uuid.uuid4().hex}", "customer.subscription.updated",
                   _subscription_payload(customer_id=customer_id, sub_id=f"sub_{workspace_id}", status="active"), created=created - 1)
    with pg.begin() as db:
        assert process_stripe_event(db, canceled) == "processed"
    with pg.begin() as db:
        assert process_stripe_event(db, older) == "stale"
    with pg() as db:
        assert db.query(Subscription).filter_by(provider_customer_id=customer_id).one().status == "CANCELED"
    # The higher lexical event ID wins when timestamps are equal.
    lower_tie = _event(f"evt_a_{uuid.uuid4().hex}", "customer.subscription.updated",
                       _subscription_payload(customer_id=customer_id, sub_id=f"sub_{workspace_id}", status="active"), created=created)
    higher_tie = _event(f"evt_zz_{uuid.uuid4().hex}", "customer.subscription.updated",
                        _subscription_payload(customer_id=customer_id, sub_id=f"sub_{workspace_id}", status="active"), created=created)
    with pg.begin() as db:
        assert process_stripe_event(db, lower_tie) == "stale"
    with pg.begin() as db:
        assert process_stripe_event(db, higher_tie) == "processed"
    with pg() as db:
        assert db.query(Subscription).filter_by(provider_customer_id=customer_id).one().status == "ACTIVE"


def test_postgres_voucher_constraints_and_concurrent_redemption(pg):
    with pg.begin() as db:
        user_id = _workspace(db)
        voucher, code = create_voucher(db, assigned_user=db.query(User).filter_by(id=user_id).one(),
                                       plan_key="coach_pro", duration_days=90)
        voucher_id, code_hash = voucher.id, voucher.code_hash
    with pg.begin() as db:
        with pytest.raises(IntegrityError):
            with db.begin_nested():
                db.add(Voucher(id=str(uuid.uuid4()), code_hash=code_hash, plan_key="coach_pro",
                               duration_days=30, source="offline_payment", assigned_user_id=user_id))
                db.flush()
        with pytest.raises(IntegrityError):
            with db.begin_nested():
                db.add(Voucher(id=str(uuid.uuid4()), code_hash=str(uuid.uuid4()), plan_key="coach_pro",
                               duration_days=30, source="offline_payment", assigned_user_id="missing-user"))
                db.flush()

    def redeem(_):
        with pg() as db:
            try:
                redeem_voucher(db, code=code, user=db.query(User).filter_by(id=user_id).one())
                time.sleep(0.1)
                db.commit()
                return "redeemed"
            except VoucherInvalid:
                db.rollback()
                return "invalid"

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(redeem, range(2))) == ["invalid", "redeemed"]
    with pg() as db:
        row = db.query(Voucher).filter_by(id=voucher_id).one()
        assert row.redeemed_by_user_id == user_id
        assert db.query(AccessGrant).filter_by(reason=f"voucher:{voucher_id}").count() == 1
        assert db.query(AuditEvent).filter_by(event_type="VOUCHER_REDEEMED", resource_id=voucher_id).count() == 1


def test_postgres_parallel_distinct_vouchers_preserve_stacked_days(pg):
    with pg.begin() as db:
        user_id = _workspace(db)
        user = db.query(User).filter_by(id=user_id).one()
        codes = [create_voucher(db, assigned_user=user, plan_key="coach_pro", duration_days=30)[1]
                 for _ in range(2)]

    def redeem(code):
        with pg() as db:
            _row, grant = redeem_voucher(db, code=code, user=db.query(User).filter_by(id=user_id).one())
            db.commit()
            return grant.id

    with ThreadPoolExecutor(max_workers=2) as pool:
        grant_ids = list(pool.map(redeem, codes))
    with pg() as db:
        grants = sorted([db.query(AccessGrant).filter_by(id=grant_id).one() for grant_id in grant_ids],
                        key=lambda grant: grant.starts_at)
        assert grants[1].starts_at == grants[0].expires_at
        assert grants[1].expires_at - grants[0].starts_at == timedelta(days=60)


def test_postgres_voucher_attempts_share_limit_across_connections(pg):
    subject = uuid.uuid4().hex

    def attempt(_):
        with pg.begin() as db:
            return record_voucher_attempt(db, user_id=subject, client_ip=f"ip-{subject}")

    with ThreadPoolExecutor(max_workers=8) as pool:
        outcomes = list(pool.map(attempt, range(10)))
    assert outcomes.count(True) == 5
    assert outcomes.count(False) == 5
