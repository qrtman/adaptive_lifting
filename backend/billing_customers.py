"""Trusted mapping between external billing customers and coach workspaces."""

import json
import uuid

from sqlalchemy.exc import IntegrityError

from .database import AuditEvent, BillingCustomer


def get_billing_customer(db, provider: str, provider_customer_id: str):
    provider_key = (provider or "").strip().lower()
    customer_key = (provider_customer_id or "").strip()
    if not provider_key or not customer_key:
        return None
    return db.query(BillingCustomer).filter(
        BillingCustomer.provider == provider_key,
        BillingCustomer.provider_customer_id == customer_key,
    ).one_or_none()


def link_billing_customer(db, *, workspace_id: str, provider: str,
                          provider_customer_id: str, actor_user_id: str | None = None):
    """Create or return an identical mapping; never move a customer/workspace."""
    provider_key = (provider or "").strip().lower()
    customer_key = (provider_customer_id or "").strip()
    if not provider_key or not customer_key:
        raise ValueError("Provider and provider customer ID are required")

    existing_customer = get_billing_customer(db, provider_key, customer_key)
    existing_workspace = db.query(BillingCustomer).filter(
        BillingCustomer.workspace_id == str(workspace_id),
        BillingCustomer.provider == provider_key,
    ).one_or_none()
    if existing_customer is not None:
        if existing_customer.workspace_id != str(workspace_id):
            raise ValueError("Billing customer is already linked to another workspace")
        return existing_customer
    if existing_workspace is not None:
        raise ValueError("Workspace already has a billing customer for this provider")

    mapping = BillingCustomer(
        id=str(uuid.uuid4()), workspace_id=str(workspace_id), provider=provider_key,
        provider_customer_id=customer_key,
    )
    try:
        with db.begin_nested():
            db.add(mapping)
            db.flush()
            db.add(AuditEvent(
                id=str(uuid.uuid4()), actor_user_id=actor_user_id,
                event_type="BILLING_CUSTOMER_LINKED", resource_type="BillingCustomer",
                resource_id=mapping.id, metadata_json=json.dumps({"provider": provider_key}),
            ))
            db.flush()
        return mapping
    except IntegrityError as exc:
        by_customer = get_billing_customer(db, provider_key, customer_key)
        if by_customer is not None and by_customer.workspace_id == str(workspace_id):
            return by_customer
        raise ValueError("Billing customer or workspace is already linked") from exc
