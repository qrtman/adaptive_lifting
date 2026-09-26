import uuid
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from backend.billing.stripe_checkout import ensure_stripe_customer_for_workspace
from backend.database import BillingCustomer, SessionLocal, User, Workspace
from backend.main import app
from backend.saas_access import build_account_access_state
from backend.subscriptions import has_current_stripe_subscription, upsert_subscription
from backend.test_support import register_coach


@pytest.fixture
def billing(monkeypatch):
    for key, value in {
        "STRIPE_BILLING_ENABLED": "true", "STRIPE_SECRET_KEY": "sk_test_fake",
        "STRIPE_PRICE_COACH_STARTER": "price_starter", "STRIPE_PRICE_COACH_PRO": "price_pro",
        "STRIPE_PRICE_COACH_UNLIMITED": "price_unlimited", "APP_URL": "http://localhost:3000",
    }.items():
        monkeypatch.setenv(key, value)
    calls = {"customers": [], "checkouts": [], "portals": [], "prices": []}
    def customer_create(**kwargs):
        calls["customers"].append(kwargs)
        return {"id": "cus_" + kwargs["idempotency_key"].split(":")[1].replace("-", "")}
    def checkout_create(**kwargs):
        calls["checkouts"].append(kwargs)
        return {"url": "https://checkout.stripe.com/c/pay/test"}
    def portal_create(**kwargs):
        calls["portals"].append(kwargs)
        return {"url": "https://billing.stripe.com/p/session/test"}
    def price_retrieve(price_id, **kwargs):
        calls["prices"].append((price_id, kwargs))
        return {"id": price_id, "active": True, "unit_amount": 2900,
                "currency": "usd", "recurring": {"interval": "month"}}
    monkeypatch.setattr("stripe.Customer.create", customer_create)
    monkeypatch.setattr("stripe.checkout.Session.create", checkout_create)
    monkeypatch.setattr("stripe.billing_portal.Session.create", portal_create)
    monkeypatch.setattr("stripe.Price.retrieve", price_retrieve)
    return calls


def coach_client():
    client = TestClient(app)
    email = f"billing-{uuid.uuid4().hex}@example.com"
    register_coach(client, email)
    return client, email


def add_subscription(email, status, *, days=30):
    with SessionLocal() as db:
        owner = db.query(User).filter_by(email=email).one()
        workspace = db.query(Workspace).filter_by(owner_user_id=owner.id).one()
        now = datetime.utcnow()
        upsert_subscription(db, workspace_id=workspace.id, provider="stripe",
            provider_subscription_id=f"sub_{uuid.uuid4().hex}", provider_customer_id="cus_checkout_test",
            plan_key="coach_pro", status=status,
            current_period_start=now - timedelta(days=30), current_period_end=now + timedelta(days=days),
            cancel_at_period_end=status == "CANCELED")
        db.commit()


def test_checkout_owner_server_price_customer_urls_and_idempotency(billing):
    client, email = coach_client()
    request_id = str(uuid.uuid4())
    for plan, price in (("coach_starter", "price_starter"), ("coach_pro", "price_pro"),
                        ("coach_unlimited", "price_unlimited")):
        response = client.post("/api/billing/stripe/checkout-session", json={"planKey": plan, "requestId": request_id})
        assert response.status_code == 200, response.text
        assert response.json() == {"url": "https://checkout.stripe.com/c/pay/test"}
        sent = billing["checkouts"][-1]
        assert sent["mode"] == "subscription"
        assert sent["customer"].startswith("cus_")
        assert sent["line_items"] == [{"price": price, "quantity": 1}]
        assert sent["success_url"] == "http://localhost:3000/?billing=success&session_id={CHECKOUT_SESSION_ID}#/security"
        assert sent["cancel_url"] == "http://localhost:3000/?billing=cancelled#/security"
        assert email not in sent["idempotency_key"]
    repeated = client.post("/api/billing/stripe/checkout-session", json={"planKey": "coach_pro", "requestId": request_id})
    assert repeated.status_code == 200
    assert billing["checkouts"][-1]["idempotency_key"] == billing["checkouts"][1]["idempotency_key"]
    changed = client.post("/api/billing/stripe/checkout-session", json={"planKey": "coach_pro", "requestId": str(uuid.uuid4())})
    assert changed.status_code == 200
    assert billing["checkouts"][-1]["idempotency_key"] != billing["checkouts"][1]["idempotency_key"]
    assert len(billing["customers"]) == 1
    assert billing["customers"][0]["email"] == email
    assert "email" not in billing["customers"][0]["idempotency_key"]
    with SessionLocal() as db:
        assert db.query(BillingCustomer).filter_by(workspace_id=client.get("/api/account/access").json()["workspace"]["id"]).count() == 1
        assert db.query(User).filter_by(email=email).one().role == "COACH"


def test_checkout_rejects_unpurchasable_input_and_non_owner(billing):
    client, email = coach_client()
    for plan in ("coach_beta", "wrong", "price_pro"):
        response = client.post("/api/billing/stripe/checkout-session", json={"planKey": plan, "requestId": str(uuid.uuid4())})
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "BILLING_PLAN_NOT_PURCHASABLE"
    for body in ({"planKey": "coach_pro", "requestId": "bad"},
                 {"planKey": "coach_pro", "requestId": str(uuid.uuid4()), "priceId": "price_unlimited"}):
        assert client.post("/api/billing/stripe/checkout-session", json=body).status_code == 422
    assert billing["customers"] == []
    with SessionLocal() as db:
        owner = db.query(User).filter_by(email=email).one()
        workspace = db.query(Workspace).filter_by(owner_user_id=owner.id).one()
        db.query(BillingCustomer).filter_by(workspace_id=workspace.id).delete()
        from backend.database import WorkspaceMember
        db.query(WorkspaceMember).filter_by(workspace_id=workspace.id, user_id=owner.id).one().role = "STAFF"
        db.commit()
    denied = client.post("/api/billing/stripe/checkout-session", json={"planKey": "coach_pro", "requestId": str(uuid.uuid4())})
    assert denied.status_code == 403
    assert denied.json()["detail"]["code"] == "BILLING_OWNER_REQUIRED"
    athlete = TestClient(app)
    athlete.post("/api/auth/register", json={"email": f"athlete-{uuid.uuid4().hex}@example.com", "password": "password123"})
    assert athlete.post("/api/billing/stripe/portal-session").status_code == 403


@pytest.mark.parametrize("status,days,blocked", [
    ("ACTIVE", 30, True), ("TRIALING", 30, True), ("PAST_DUE", -10, True),
    ("INCOMPLETE", -10, True), ("CANCELED", 10, True),
    ("CANCELED", -1, False), ("EXPIRED", -1, False),
])
def test_existing_subscription_policy(billing, status, days, blocked):
    client, email = coach_client()
    add_subscription(email, status, days=days)
    with SessionLocal() as db:
        owner = db.query(User).filter_by(email=email).one()
        workspace = db.query(Workspace).filter_by(owner_user_id=owner.id).one()
        assert has_current_stripe_subscription(db, workspace.id) is blocked
    response = client.post("/api/billing/stripe/checkout-session", json={"planKey": "coach_pro", "requestId": str(uuid.uuid4())})
    assert response.status_code == (409 if blocked else 200)
    if blocked:
        assert response.json()["detail"]["code"] == "BILLING_SUBSCRIPTION_EXISTS"


def test_plans_portal_and_access_are_read_only_for_entitlements(billing):
    client, email = coach_client()
    catalog = client.get("/api/billing/plans")
    assert catalog.status_code == 200
    assert [item["planKey"] for item in catalog.json()["plans"]] == ["coach_starter", "coach_pro", "coach_unlimited"]
    assert all(item["unitAmount"] == 2900 and item["interval"] == "month" for item in catalog.json()["plans"])
    assert all(item["intervalCount"] == 1 for item in catalog.json()["plans"])
    assert [item["maxActiveAthletes"] for item in catalog.json()["plans"]] == [5, 25, None]
    assert client.post("/api/billing/stripe/portal-session").json()["detail"]["code"] == "BILLING_CUSTOMER_UNAVAILABLE"
    checkout = client.post("/api/billing/stripe/checkout-session", json={"planKey": "coach_pro", "requestId": str(uuid.uuid4())})
    assert checkout.status_code == 200
    portal = client.post("/api/billing/stripe/portal-session")
    assert portal.status_code == 200
    assert billing["portals"][-1]["customer"].startswith("cus_")
    assert billing["portals"][-1]["return_url"] == "http://localhost:3000/?billing=portal-return#/security"
    access = client.get("/api/account/access").json()
    assert access["billingSubscription"] is None
    assert access["canStartCheckout"] is True
    assert access["entitlements"]["planKey"] == "coach_beta"


def test_subscription_and_manual_access_are_separate_in_public_state(billing):
    client, email = coach_client()
    add_subscription(email, "ACTIVE")
    access = client.get("/api/account/access").json()
    assert access["billingSubscription"]["planKey"] == "coach_pro"
    assert access["canStartCheckout"] is False
    assert access["entitlements"]["planKey"] == "coach_pro"
    with SessionLocal() as db:
        owner = db.query(User).filter_by(email=email).one()
        assert build_account_access_state(db, owner)["billingSubscription"]["status"] == "ACTIVE"


def test_billing_disabled_and_provider_errors_are_safe(billing, monkeypatch):
    import stripe
    client, _ = coach_client()
    monkeypatch.setenv("STRIPE_BILLING_ENABLED", "false")
    disabled = client.get("/api/billing/plans")
    assert disabled.status_code == 503
    assert disabled.json()["detail"]["code"] == "BILLING_NOT_CONFIGURED"
    monkeypatch.setenv("STRIPE_BILLING_ENABLED", "true")
    def provider_failure(*args, **kwargs):
        raise stripe.error.APIConnectionError(message="provider private details")
    monkeypatch.setattr("stripe.Price.retrieve", provider_failure)
    failed = client.get("/api/billing/plans")
    assert failed.status_code == 502
    assert failed.json()["detail"]["code"] == "BILLING_PROVIDER_ERROR"
    assert "private details" not in failed.text


def test_checkout_cookie_write_uses_existing_origin_guard(billing, monkeypatch):
    client, _ = coach_client()
    monkeypatch.setenv("APP_ENV", "production")
    blocked = client.post("/api/billing/stripe/checkout-session", json={
        "planKey": "coach_pro", "requestId": str(uuid.uuid4()),
    })
    assert blocked.status_code == 403
    assert blocked.json()["detail"] == "Untrusted request origin"
    assert billing["customers"] == []
