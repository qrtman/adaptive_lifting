import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend.billing.stripe_adapter import (
    STRIPE_STATUS_MAP,
    StripeEventError,
    map_subscription_price,
    normalize_stripe_status,
    process_stripe_event,
    stripe_price_plan_map,
)
from backend.billing_customers import link_billing_customer
from backend.database import AuditEvent, BillingCustomer, SessionLocal, Subscription, User, WebhookEvent
from backend.entitlements import resolve_workspace_entitlements
from backend.main import app
from backend.manage_user import main as manage_user_main
from backend.workspaces import ensure_default_workspace_for_coach


WEBHOOK_SECRET = "whsec_test_phase4b_signature_secret"


def _set_stripe_env(monkeypatch, **changes):
    values = {
        "STRIPE_BILLING_ENABLED": "true",
        "STRIPE_WEBHOOK_SECRET": WEBHOOK_SECRET,
        "STRIPE_EXPECT_LIVEMODE": "false",
        "STRIPE_PRICE_COACH_STARTER": "price_starter_test",
        "STRIPE_PRICE_COACH_PRO": "price_pro_test",
        "STRIPE_PRICE_COACH_UNLIMITED": "price_unlimited_test",
    }
    values.update(changes)
    for key, value in values.items():
        monkeypatch.setenv(key, value)


def _workspace(email=None):
    db = SessionLocal()
    email = email or f"stripe-{uuid.uuid4().hex}@example.com"
    user = User(
        id=str(uuid.uuid4()), email=email, hashed_password="test-only", role="COACH",
    )
    db.add(user)
    db.flush()
    workspace = ensure_default_workspace_for_coach(db, user)
    db.commit()
    workspace_id = workspace.id
    user_id = user.id
    db.close()
    return user_id, workspace_id, email


def _subscription_payload(*, customer_id="cus_phase4b", sub_id=None,
                          price_id="price_pro_test", status="active", cancel=False,
                          period_start=None, period_end=None, extra_items=()):
    sub_id = sub_id or f"sub_{customer_id[-8:]}"
    now = int(time.time())
    item = {
        "id": f"si_{sub_id}",
        "object": "subscription_item",
        "price": {"id": price_id, "object": "price", "recurring": {"interval": "month"}},
        "quantity": 1,
    }
    return {
        "id": sub_id,
        "object": "subscription",
        "customer": customer_id,
        "status": status,
        "cancel_at_period_end": cancel,
        "current_period_start": period_start if period_start is not None else now,
        "current_period_end": period_end if period_end is not None else now + 30 * 86400,
        "canceled_at": now if status == "canceled" else None,
        "ended_at": now if status in {"canceled", "unpaid", "incomplete_expired"} else None,
        "items": {"object": "list", "data": [item, *extra_items]},
        # Arbitrary plan metadata must never select the product plan.
        "metadata": {"plan_key": "coach_unlimited"},
    }


def _event(event_id, event_type, subscription=None, *, created=None, livemode=False, account=None):
    event = {
        "id": event_id,
        "object": "event",
        "created": int(time.time()) if created is None else created,
        "type": event_type,
        "livemode": livemode,
        "data": {"object": subscription or {}},
    }
    if account is not None:
        event["account"] = account
    return event


def _signed(payload: bytes, secret=WEBHOOK_SECRET, timestamp=None):
    timestamp = int(time.time()) if timestamp is None else timestamp
    message = str(timestamp).encode() + b"." + payload
    signature = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={signature}"


def _post_event(event, *, signature=None, raw=None):
    body = json.dumps(event, separators=(",", ":")).encode() if raw is None else raw
    return TestClient(app).post(
        "/api/billing/stripe/webhook",
        content=body,
        headers={"Stripe-Signature": signature or _signed(body), "Content-Type": "application/json"},
    )


def _link_customer(workspace_id, customer_id=None):
    customer_id = customer_id or f"cus_{workspace_id[:8]}"
    db = SessionLocal()
    try:
        link_billing_customer(
            db, workspace_id=workspace_id, provider="stripe", provider_customer_id=customer_id,
        )
        return customer_id
    finally:
        db.commit()
        db.close()


def test_server_price_mapping_and_subscription_items_fail_closed(monkeypatch):
    _set_stripe_env(monkeypatch)
    assert stripe_price_plan_map() == {
        "price_starter_test": "coach_starter",
        "price_pro_test": "coach_pro",
        "price_unlimited_test": "coach_unlimited",
    }
    with pytest.raises(StripeEventError, match="unrecognized price"):
        map_subscription_price(_subscription_payload(price_id="price_from_metadata"), stripe_price_plan_map())
    extra = {"price": {"id": "price_addon", "recurring": {"interval": "month"}}}
    with pytest.raises(StripeEventError, match="exactly one"):
        map_subscription_price(_subscription_payload(extra_items=(extra,)), stripe_price_plan_map())
    nonrecurring = _subscription_payload()
    nonrecurring["items"]["data"][0]["price"]["recurring"] = None
    with pytest.raises(StripeEventError, match="recurring"):
        map_subscription_price(nonrecurring, stripe_price_plan_map())
    with pytest.raises(StripeEventError, match="duplicate"):
        stripe_price_plan_map({
            "STRIPE_PRICE_COACH_STARTER": "same",
            "STRIPE_PRICE_COACH_PRO": "same",
            "STRIPE_PRICE_COACH_UNLIMITED": "unique",
        })


@pytest.mark.parametrize("provider,normalized", [
    ("trialing", "TRIALING"), ("active", "ACTIVE"), ("past_due", "PAST_DUE"),
    ("canceled", "CANCELED"), ("incomplete", "INCOMPLETE"),
    ("incomplete_expired", "EXPIRED"), ("unpaid", "EXPIRED"), ("paused", "EXPIRED"),
])
def test_stripe_status_mapping_is_central_and_unknown_status_fails(provider, normalized):
    assert STRIPE_STATUS_MAP[provider] == normalized
    assert normalize_stripe_status(provider) == normalized
    with pytest.raises(StripeEventError):
        normalize_stripe_status("future_unknown_status")


def test_signed_webhook_creates_subscription_and_replay_is_idempotent(monkeypatch):
    _set_stripe_env(monkeypatch)
    _, workspace_id, _ = _workspace()
    customer_id = _link_customer(workspace_id)
    event = _event("evt_phase4b_created", "customer.subscription.created", _subscription_payload(customer_id=customer_id))
    response = _post_event(event)
    assert response.status_code == 200, response.text
    assert response.json() == {"status": "processed"}

    db = SessionLocal()
    try:
        subscription = db.query(Subscription).filter_by(provider_customer_id=customer_id).one()
        assert subscription.workspace_id == workspace_id
        assert subscription.provider == "stripe"
        assert subscription.provider_customer_id == customer_id
        assert subscription.plan_key == "coach_pro"
        assert subscription.status == "ACTIVE"
        assert subscription.provider_event_id == "evt_phase4b_created"
        assert subscription.provider_event_created_at.tzinfo is None
        assert resolve_workspace_entitlements(db, workspace_id).plan_key == "coach_pro"
        assert db.query(WebhookEvent).filter_by(external_event_id="evt_phase4b_created").one().status == "PROCESSED"
        audit_count = db.query(AuditEvent).filter(AuditEvent.event_type == "SUBSCRIPTION_CREATED").count()
    finally:
        db.close()

    same_state = dict(event)
    same_state["id"] = "evt_phase4b_same_state"
    same_state["created"] = event["created"] + 1
    assert _post_event(same_state).json() == {"status": "processed"}
    db = SessionLocal()
    try:
        assert db.query(AuditEvent).filter(AuditEvent.event_type == "SUBSCRIPTION_CREATED").count() == audit_count
        assert db.query(AuditEvent).filter(AuditEvent.event_type == "SUBSCRIPTION_UPDATED").filter(
            AuditEvent.resource_id == subscription.id,
        ).count() == 0
    finally:
        db.close()

    duplicate = _post_event(event)
    assert duplicate.status_code == 200
    assert duplicate.json() == {"status": "duplicate"}
    db = SessionLocal()
    try:
        assert db.query(AuditEvent).filter(AuditEvent.event_type == "SUBSCRIPTION_CREATED").count() == audit_count
    finally:
        db.close()


def test_raw_body_signature_invalid_missing_wrong_secret_and_config(monkeypatch):
    _set_stripe_env(monkeypatch)
    event = _event("evt_bad_sig", "customer.subscription.created", _subscription_payload())
    body = json.dumps(event, separators=(",", ":")).encode()
    assert _post_event(event, signature="t=1,v1=invalid").status_code == 400
    assert _post_event(event, signature=_signed(body, secret="wrong-secret")).status_code == 400
    changed_body = body + b" "
    assert _post_event(event, signature=_signed(body), raw=changed_body).status_code == 400
    assert TestClient(app).post("/api/billing/stripe/webhook", content=body).status_code == 400

    monkeypatch.delenv("STRIPE_WEBHOOK_SECRET")
    assert _post_event(event).status_code == 503
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET)
    monkeypatch.setenv("STRIPE_BILLING_ENABLED", "false")
    assert _post_event(event).status_code == 503


def test_live_mode_mismatch_and_connect_events_fail_closed_or_ignore(monkeypatch):
    _set_stripe_env(monkeypatch, STRIPE_EXPECT_LIVEMODE="true")
    live_mismatch = _event("evt_mode", "customer.subscription.created", _subscription_payload(), livemode=False)
    assert _post_event(live_mismatch).status_code == 400
    missing_mode = _event("evt_missing_mode", "invoice.paid")
    missing_mode.pop("livemode")
    assert _post_event(missing_mode).status_code == 400

    _set_stripe_env(monkeypatch)
    connected = _event(
        "evt_connect", "customer.subscription.created", _subscription_payload(), account="acct_connected",
    )
    response = _post_event(connected)
    assert response.status_code == 200
    assert response.json() == {"status": "ignored_connect"}


def test_unrelated_signed_event_is_safely_ignored(monkeypatch):
    _set_stripe_env(monkeypatch)
    event = _event("evt_unrelated", "invoice.paid")
    response = _post_event(event)
    assert response.status_code == 200
    assert response.json() == {"status": "ignored"}


def test_customer_mapping_unknown_price_and_unknown_customer_fail_closed(monkeypatch):
    _set_stripe_env(monkeypatch)
    _, workspace_id, _ = _workspace()
    customer_id = _link_customer(workspace_id)
    unknown_price = _event(
        "evt_unknown_price", "customer.subscription.created",
        _subscription_payload(price_id="price_unsupported", customer_id=customer_id),
    )
    assert _post_event(unknown_price).status_code == 500
    unknown_customer = _event(
        "evt_unknown_customer", "customer.subscription.created",
        _subscription_payload(customer_id="cus_no_mapping", sub_id="sub_no_mapping"),
    )
    assert _post_event(unknown_customer).status_code == 500
    db = SessionLocal()
    try:
        assert db.query(Subscription).filter_by(provider_customer_id=customer_id).count() == 0
        failures = db.query(WebhookEvent).filter(
            WebhookEvent.external_event_id.in_(["evt_unknown_price", "evt_unknown_customer"]),
        ).all()
        assert {failure.status for failure in failures} == {"FAILED"}
    finally:
        db.close()


def test_failed_mapping_event_can_be_retried_after_operator_links_customer(monkeypatch):
    _set_stripe_env(monkeypatch)
    _, workspace_id, _ = _workspace()
    customer_id = f"cus_{workspace_id[:8]}"
    event = _event(
        "evt_retry_after_mapping", "customer.subscription.created",
        _subscription_payload(customer_id=customer_id),
    )
    assert _post_event(event).status_code == 500
    db = SessionLocal()
    try:
        assert db.query(WebhookEvent).filter_by(external_event_id="evt_retry_after_mapping").one().status == "FAILED"
    finally:
        db.close()

    _link_customer(workspace_id, customer_id)
    retry = _post_event(event)
    assert retry.status_code == 200, retry.text
    assert retry.json() == {"status": "processed"}
    db = SessionLocal()
    try:
        assert db.query(WebhookEvent).filter_by(external_event_id="evt_retry_after_mapping").one().status == "PROCESSED"
        assert db.query(Subscription).filter_by(provider_customer_id=customer_id).count() == 1
    finally:
        db.close()


def test_subscription_updated_changes_price_and_deleted_status_without_deleting_row(monkeypatch):
    _set_stripe_env(monkeypatch)
    _, workspace_id, _ = _workspace()
    customer_id = _link_customer(workspace_id)
    event_time = int(time.time())
    created = _event("evt_create_for_update", "customer.subscription.created", _subscription_payload(customer_id=customer_id), created=event_time)
    assert _post_event(created).status_code == 200

    updated_payload = _subscription_payload(price_id="price_unlimited_test", customer_id=customer_id)
    updated_payload["current_period_end"] += 60 * 86400
    updated = _event("evt_update_plan", "customer.subscription.updated", updated_payload, created=event_time + 1)
    assert _post_event(updated).status_code == 200
    deleted_payload = _subscription_payload(
        status="canceled", price_id="price_unlimited_test", customer_id=customer_id,
    )
    deleted_payload["current_period_end"] += 60 * 86400
    deleted = _event("evt_deleted", "customer.subscription.deleted", deleted_payload, created=event_time + 2)
    assert _post_event(deleted).status_code == 200

    db = SessionLocal()
    try:
        local = db.query(Subscription).filter_by(provider_customer_id=customer_id).one()
        assert local.plan_key == "coach_unlimited"
        assert local.status == "CANCELED"
        assert local.provider_event_id == "evt_deleted"
        assert db.query(AuditEvent).filter(AuditEvent.event_type == "SUBSCRIPTION_STATUS_CHANGED").count() >= 1
    finally:
        db.close()


def test_paused_and_resumed_subscription_events_use_normalized_policy(monkeypatch):
    _set_stripe_env(monkeypatch)
    _, workspace_id, _ = _workspace()
    customer_id = _link_customer(workspace_id)
    event_time = int(time.time())
    paused = _event(
        "evt_paused", "customer.subscription.paused",
        _subscription_payload(status="paused", customer_id=customer_id), created=event_time,
    )
    assert _post_event(paused).json() == {"status": "processed"}
    db = SessionLocal()
    try:
        sub = db.query(Subscription).filter_by(provider_customer_id=customer_id).one()
        assert sub.status == "EXPIRED"
        assert resolve_workspace_entitlements(db, workspace_id).active is False
    finally:
        db.close()

    resumed = _event(
        "evt_resumed", "customer.subscription.resumed",
        _subscription_payload(status="active", customer_id=customer_id), created=event_time + 1,
    )
    assert _post_event(resumed).json() == {"status": "processed"}
    db = SessionLocal()
    try:
        assert db.query(Subscription).filter_by(provider_customer_id=customer_id).one().status == "ACTIVE"
        assert resolve_workspace_entitlements(db, workspace_id).active is True
    finally:
        db.close()


def test_stale_and_equal_second_events_cannot_reverse_newer_snapshot(monkeypatch):
    _set_stripe_env(monkeypatch)
    _, workspace_id, _ = _workspace()
    customer_id = _link_customer(workspace_id)
    base_time = int(time.time()) - 10
    db = SessionLocal()
    try:
        first = _event(
            "evt_100", "customer.subscription.updated",
            _subscription_payload(status="canceled", customer_id=customer_id), created=base_time + 10,
        )
        assert process_stripe_event(db, first) == "processed"
        db.commit()
        older = _event(
            "evt_999", "customer.subscription.updated",
            _subscription_payload(status="active", customer_id=customer_id), created=base_time + 9,
        )
        assert process_stripe_event(db, older) == "stale"
        db.commit()
        same_second_lower_id = _event(
            "evt_099", "customer.subscription.updated",
            _subscription_payload(status="active", customer_id=customer_id), created=base_time + 10,
        )
        assert process_stripe_event(db, same_second_lower_id) == "stale"
        db.commit()
        same_second_higher_id = _event(
            "evt_101", "customer.subscription.updated",
            _subscription_payload(status="active", customer_id=customer_id), created=base_time + 10,
        )
        assert process_stripe_event(db, same_second_higher_id) == "processed"
        db.commit()
        sub = db.query(Subscription).filter_by(provider_customer_id=customer_id).one()
        assert sub.status == "ACTIVE"
        assert sub.provider_event_id == "evt_101"
        assert db.query(WebhookEvent).filter_by(external_event_id="evt_099").one().status == "STALE"
    finally:
        db.close()


def test_mapping_cli_is_idempotent_and_customer_cannot_be_moved(monkeypatch, capsys):
    email = f"billing-link-{uuid.uuid4().hex}@example.com"
    db = SessionLocal()
    try:
        db.add(User(id=str(uuid.uuid4()), email=email, hashed_password="test-only", role="COACH"))
        db.commit()
    finally:
        db.close()
    assert manage_user_main([
        "link-billing-customer", email, "--provider", "stripe", "--customer-id", "cus_operator_12345",
    ]) == 0
    output = capsys.readouterr().out
    assert "Linked billing customer" in output
    assert "cus_o…2345" in output
    assert manage_user_main(["show-access", email]) == 0
    assert "Billing customers:" in capsys.readouterr().out

    _, other_workspace, _ = _workspace()
    db = SessionLocal()
    try:
        with pytest.raises(ValueError, match="already linked"):
            link_billing_customer(
                db, workspace_id=other_workspace, provider="stripe",
                provider_customer_id="cus_operator_12345",
            )
        assert db.query(BillingCustomer).filter_by(provider_customer_id="cus_operator_12345").count() == 1
    finally:
        db.rollback()
        db.close()
