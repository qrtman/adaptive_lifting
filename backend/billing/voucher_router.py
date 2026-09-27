"""Authenticated voucher redemption; operator issuance is CLI-only."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import SessionLocal, get_db
from ..voucher_rate_limit import enabled as rate_limit_enabled, record_voucher_attempt
from ..vouchers import VoucherConfigurationError, VoucherInvalid, redeem_voucher

logger = logging.getLogger(__name__)


class RedeemVoucherRequest(BaseModel):
    code: str = Field(min_length=1, max_length=64)

    class Config:
        extra = "forbid"


def create_voucher_router(get_current_user):
    router = APIRouter(tags=["billing"])

    @router.post("/api/billing/vouchers/redeem")
    def redeem(req: RedeemVoucherRequest, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
        if current_user.role != "COACH":
            raise HTTPException(status_code=403, detail={
                "code": "VOUCHER_COACH_ACCOUNT_REQUIRED", "message": "A coach account is required to redeem this voucher.",
            })
        if rate_limit_enabled():
            try:
                with SessionLocal.begin() as limit_db:
                    allowed = record_voucher_attempt(
                        limit_db, user_id=current_user.id,
                        client_ip=request.client.host if request.client else "unknown",
                    )
            except Exception:
                logger.exception("voucher_rate_limit_unavailable user_id=%s", current_user.id)
                raise HTTPException(status_code=503, detail={
                    "code": "VOUCHER_UNAVAILABLE", "message": "Voucher redemption is currently unavailable.",
                })
            if not allowed:
                logger.warning("voucher_rate_limited user_id=%s", current_user.id)
                raise HTTPException(status_code=429, detail={
                    "code": "VOUCHER_RATE_LIMITED", "message": "Too many voucher attempts. Try again later.",
                }, headers={"Retry-After": "60"})
            # Authentication read through this Session. End that snapshot so
            # SQLite can later promote it to a writer after the counter commit.
            db.rollback()
        try:
            voucher, _grant = redeem_voucher(db, code=req.code, user=current_user)
            db.commit()
            logger.info("voucher_redeemed voucher_id=%s user_id=%s plan_key=%s", voucher.id, current_user.id, voucher.plan_key)
        except VoucherInvalid:
            db.rollback()
            logger.info("voucher_redemption_rejected user_id=%s", current_user.id)
            raise HTTPException(status_code=400, detail={
                "code": "VOUCHER_INVALID", "message": "Voucher is invalid or no longer available.",
            })
        except VoucherConfigurationError:
            db.rollback()
            raise HTTPException(status_code=503, detail={
                "code": "VOUCHER_UNAVAILABLE", "message": "Voucher redemption is currently unavailable.",
            })
        except Exception:
            db.rollback()
            raise
        return {"status": "redeemed", "planKey": voucher.plan_key, "durationDays": voucher.duration_days}

    return router
