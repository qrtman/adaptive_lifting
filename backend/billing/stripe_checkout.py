"""Owner-only Stripe Checkout and Portal operations. Webhooks remain the access authority."""

import logging
import os
import uuid
from urllib.parse import urlsplit

import stripe
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..billing_customers import link_billing_customer
from ..database import BillingCustomer, get_db
from ..entitlements import PLAN_CONFIG
from ..runtime_config import is_production_like, stripe_billing_enabled
from ..saas_access import require_workspace_billing_owner
from ..subscriptions import has_current_stripe_subscription
from .stripe_adapter import stripe_plan_price_map, StripeEventError

logger = logging.getLogger(__name__)


def billing_error(code: str, message: str, status: int = 400):
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


def billing_config():
    if not stripe_billing_enabled() or not os.environ.get("STRIPE_SECRET_KEY", "").strip():
        billing_error("BILLING_NOT_CONFIGURED", "Billing is currently unavailable.", 503)
    try:
        prices = stripe_plan_price_map()
    except StripeEventError:
        billing_error("BILLING_NOT_CONFIGURED", "Billing is currently unavailable.", 503)
    if len(prices) != 3:
        billing_error("BILLING_NOT_CONFIGURED", "Billing is currently unavailable.", 503)
    return os.environ["STRIPE_SECRET_KEY"].strip(), prices


def app_origin():
    value = os.environ.get("APP_URL", "").strip().rstrip("/")
    parsed = urlsplit(value)
    if (parsed.scheme not in {"http", "https"} or not parsed.netloc or
            parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password or
            (is_production_like() and parsed.scheme != "https")):
        billing_error("BILLING_NOT_CONFIGURED", "Billing return URL is unavailable.", 503)
    return value


def ensure_stripe_customer_for_workspace(db, workspace, owner, api_key):
    mapping = db.query(BillingCustomer).filter_by(workspace_id=workspace.id, provider="stripe").one_or_none()
    if mapping:
        return mapping.provider_customer_id
    try:
        customer = stripe.Customer.create(
            api_key=api_key,
            idempotency_key=f"stripe-customer:{workspace.id}:v1",
            email=owner.email,
            name=owner.display_name or workspace.name,
            # Diagnostic only. Webhook ownership uses BillingCustomer, never metadata.
            metadata={"workspace_id": workspace.id},
        )
    except stripe.error.StripeError as exc:
        logger.error("Stripe customer creation failed workspace_id=%s error_type=%s", workspace.id, type(exc).__name__)
        billing_error("BILLING_PROVIDER_ERROR", "Billing provider is temporarily unavailable.", 502)
    customer_id = customer.get("id")
    if not isinstance(customer_id, str) or not customer_id.startswith("cus_"):
        billing_error("BILLING_CUSTOMER_UNAVAILABLE", "Billing customer could not be created.", 502)
    try:
        mapping = link_billing_customer(
            db, workspace_id=workspace.id, provider="stripe",
            provider_customer_id=customer_id, actor_user_id=owner.id,
        )
        db.commit()
        return mapping.provider_customer_id
    except ValueError:
        db.rollback()
        winner = db.query(BillingCustomer).filter_by(workspace_id=workspace.id, provider="stripe").one_or_none()
        if winner:
            return winner.provider_customer_id
        logger.error("Stripe customer mapping conflict workspace_id=%s", workspace.id)
        billing_error("BILLING_CUSTOMER_UNAVAILABLE", "Billing customer could not be linked.", 409)


class CheckoutRequest(BaseModel):
    planKey: str
    requestId: uuid.UUID

    class Config:
        extra = "forbid"


def create_billing_router(get_current_user):
    router = APIRouter(tags=["billing"])

    @router.get("/api/billing/plans")
    def plans(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
        require_workspace_billing_owner(db, current_user)
        api_key, prices = billing_config()
        catalog = []
        for plan, price_id in prices.items():
            try:
                price = stripe.Price.retrieve(price_id, api_key=api_key)
            except stripe.error.StripeError as exc:
                logger.error("Stripe price lookup failed price_id=%s error_type=%s", price_id, type(exc).__name__)
                billing_error("BILLING_PROVIDER_ERROR", "Billing plans are temporarily unavailable.", 502)
            recurring = price.get("recurring") or {}
            interval_count = recurring.get("interval_count", 1)
            if (price.get("id") != price_id or price.get("active") is not True or
                    not recurring.get("interval") or not isinstance(price.get("unit_amount"), int) or
                    price["unit_amount"] <= 0 or
                    not isinstance(price.get("currency"), str) or not isinstance(interval_count, int) or
                    isinstance(interval_count, bool) or interval_count < 1):
                billing_error("BILLING_NOT_CONFIGURED", "Billing plan configuration is invalid.", 503)
            catalog.append({"planKey": plan, "name": plan.removeprefix("coach_").title(),
                            "unitAmount": price["unit_amount"], "currency": price["currency"],
                            "interval": recurring["interval"],
                            "intervalCount": interval_count,
                            "maxActiveAthletes": PLAN_CONFIG[plan]["max_active_athletes"]})
        return {"plans": catalog}

    @router.post("/api/billing/stripe/checkout-session")
    def checkout(req: CheckoutRequest, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
        workspace = require_workspace_billing_owner(db, current_user)
        api_key, prices = billing_config()
        if req.planKey not in prices:
            billing_error("BILLING_PLAN_NOT_PURCHASABLE", "The selected coaching plan is not available for purchase.")
        if has_current_stripe_subscription(db, workspace.id):
            billing_error("BILLING_SUBSCRIPTION_EXISTS", "This coaching account already has a Stripe subscription.", 409)
        origin = app_origin()
        customer_id = ensure_stripe_customer_for_workspace(db, workspace, current_user, api_key)
        try:
            session = stripe.checkout.Session.create(
                api_key=api_key,
                idempotency_key=f"checkout:{workspace.id}:{req.planKey}:{req.requestId}",
                mode="subscription", customer=customer_id,
                line_items=[{"price": prices[req.planKey], "quantity": 1}],
                success_url=f"{origin}/?billing=success&session_id={{CHECKOUT_SESSION_ID}}#/security",
                cancel_url=f"{origin}/?billing=cancelled#/security",
                # Diagnostic only; price and customer mapping control authorization.
                metadata={"workspace_id": workspace.id, "requested_plan_key": req.planKey},
            )
        except stripe.error.StripeError as exc:
            logger.error("Stripe Checkout creation failed workspace_id=%s error_type=%s", workspace.id, type(exc).__name__)
            billing_error("BILLING_PROVIDER_ERROR", "Checkout is temporarily unavailable.", 502)
        if not isinstance(session.get("url"), str) or not session["url"].startswith("https://checkout.stripe.com/"):
            billing_error("BILLING_PROVIDER_ERROR", "Checkout URL is unavailable.", 502)
        return {"url": session["url"]}

    @router.post("/api/billing/stripe/portal-session")
    def portal(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
        workspace = require_workspace_billing_owner(db, current_user)
        api_key, _ = billing_config()
        origin = app_origin()
        mapping = db.query(BillingCustomer).filter_by(workspace_id=workspace.id, provider="stripe").one_or_none()
        if mapping is None:
            billing_error("BILLING_CUSTOMER_UNAVAILABLE", "No billing customer is linked to this workspace.", 404)
        try:
            session = stripe.billing_portal.Session.create(
                api_key=api_key, customer=mapping.provider_customer_id,
                return_url=f"{origin}/?billing=portal-return#/security",
            )
        except stripe.error.StripeError as exc:
            logger.error("Stripe Portal creation failed workspace_id=%s error_type=%s", workspace.id, type(exc).__name__)
            billing_error("BILLING_PROVIDER_ERROR", "Billing management is temporarily unavailable.", 502)
        if not isinstance(session.get("url"), str) or not session["url"].startswith("https://billing.stripe.com/"):
            billing_error("BILLING_PROVIDER_ERROR", "Billing management URL is unavailable.", 502)
        return {"url": session["url"]}

    return router
