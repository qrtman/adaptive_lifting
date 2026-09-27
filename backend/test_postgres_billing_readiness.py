"""Run with PHASE4D_POSTGRES_URL pointing at a disposable migrated database."""

import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from backend.billing.checkout_reservations import ReservationConflict, claim_checkout
from backend.billing.stripe_adapter import process_stripe_event
from backend.billing_customers import link_billing_customer
from backend.database import (
    AuditEvent, BillingCheckoutReservation, BillingCustomer, Subscription, User,
    WebhookEvent, Workspace, WorkspaceMember,
)
from backend.test_stripe_adapter import _event, _subscription_payload


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
