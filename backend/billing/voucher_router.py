"""Authenticated voucher redemption; operator issuance is CLI-only."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..vouchers import VoucherConfigurationError, VoucherInvalid, redeem_voucher


class RedeemVoucherRequest(BaseModel):
    code: str = Field(min_length=1, max_length=64)

    class Config:
        extra = "forbid"


def create_voucher_router(get_current_user):
    router = APIRouter(tags=["billing"])

    @router.post("/api/billing/vouchers/redeem")
    def redeem(req: RedeemVoucherRequest, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
        if current_user.role != "COACH":
            raise HTTPException(status_code=403, detail={
                "code": "VOUCHER_COACH_ACCOUNT_REQUIRED", "message": "A coach account is required to redeem this voucher.",
            })
        try:
            voucher, _grant = redeem_voucher(db, code=req.code, user=current_user)
            db.commit()
        except VoucherInvalid:
            db.rollback()
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
