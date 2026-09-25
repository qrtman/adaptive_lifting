import json
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .analytics_registry import PRESET_CARDS, catalog_metrics, validate_config
from .analytics_schemas import (
    AnalyticsQueryRequest,
    CatalogPayload,
    SavedCard,
    SavedCardWrite,
)
from .analytics_service import run_query
from .database import InsightCard, User, get_db
from .exercise_patterns import PATTERNS
from .math_utils import MATH_VERSION
from .sync_service import SyncPayload, assert_math_version, ensure_client_device

router = APIRouter(tags=["analytics"])


def create_analytics_router(get_current_user):
    def _card_to_schema(row: InsightCard) -> SavedCard:
        return SavedCard(
            id=row.id,
            name=row.name,
            config=json.loads(row.config_json),
            layout=json.loads(row.layout_json or '{"order":0,"col_span":1}'),
            updated_at=row.updated_at,
        )

    def _ensure_presets(db: Session, user_id: str) -> None:
        existing = db.query(InsightCard).filter(
            InsightCard.owner_user_id == user_id,
            InsightCard.deleted_at.is_(None),
        ).count()
        if existing:
            return
        from datetime import datetime
        for preset in PRESET_CARDS:
            db.add(InsightCard(
                id=f"{user_id}:{preset.id}" if preset.id else str(uuid.uuid4()),
                owner_user_id=user_id,
                name=preset.name,
                config_json=preset.config.model_dump_json(),
                layout_json=preset.layout.model_dump_json(),
                updated_at=datetime.utcnow(),
            ))
        db.commit()

    @router.get("/api/analytics/catalog", response_model=CatalogPayload)
    def analytics_catalog(current_user: User = Depends(get_current_user)):
        return CatalogPayload(
            metrics=catalog_metrics(),
            patterns=list(PATTERNS),
            visualizations=["line", "bar", "heatmap", "weekday_matrix", "table"],
            grains=["day", "week", "block"],
            aggregations=["sum", "mean", "max", "last"],
            presets=PRESET_CARDS,
        )

    @router.post("/api/analytics/query")
    def analytics_query(
        req: AnalyticsQueryRequest,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ):
        return run_query(db, current_user, req)

    @router.get("/api/insight-cards", response_model=List[SavedCard])
    def list_cards(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
        _ensure_presets(db, current_user.id)
        rows = db.query(InsightCard).filter(
            InsightCard.owner_user_id == current_user.id,
            InsightCard.deleted_at.is_(None),
        ).order_by(InsightCard.updated_at.desc()).all()
        return [_card_to_schema(row) for row in rows]

    @router.post("/api/insight-cards", response_model=SavedCard)
    def create_card(
        req: SavedCardWrite,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ):
        reasons = validate_config(req.config)
        if reasons:
            raise HTTPException(status_code=422, detail={"code": "INCOMPATIBLE_CARD", "reasons": reasons})
        from datetime import datetime
        row = InsightCard(
            id=req.id or str(uuid.uuid4()),
            owner_user_id=current_user.id,
            name=req.name,
            config_json=req.config.model_dump_json(),
            layout_json=req.layout.model_dump_json(),
            updated_at=datetime.utcnow(),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return _card_to_schema(row)

    @router.put("/api/insight-cards/{card_id}", response_model=SavedCard)
    def update_card(
        card_id: str,
        req: SavedCardWrite,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ):
        row = db.query(InsightCard).filter(
            InsightCard.id == card_id,
            InsightCard.owner_user_id == current_user.id,
            InsightCard.deleted_at.is_(None),
        ).first()
        if not row:
            raise HTTPException(status_code=404, detail="Card not found")
        reasons = validate_config(req.config)
        if reasons:
            raise HTTPException(status_code=422, detail={"code": "INCOMPATIBLE_CARD", "reasons": reasons})
        from datetime import datetime
        row.name = req.name
        row.config_json = req.config.model_dump_json()
        row.layout_json = req.layout.model_dump_json()
        row.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(row)
        return _card_to_schema(row)

    @router.delete("/api/insight-cards/{card_id}")
    def delete_card(
        card_id: str,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ):
        from datetime import datetime
        row = db.query(InsightCard).filter(
            InsightCard.id == card_id,
            InsightCard.owner_user_id == current_user.id,
        ).first()
        if not row:
            raise HTTPException(status_code=404, detail="Card not found")
        row.deleted_at = datetime.utcnow()
        db.commit()
        return {"status": "tombstoned"}

    @router.post("/api/insight-cards/sync")
    def sync_cards(
        payload: SyncPayload,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ):
        from datetime import datetime
        import dateutil.parser
        from .database import SyncMutation

        assert_math_version(payload)
        device_id = ensure_client_device(db, payload.client_device_id, current_user.id)
        accepted = []
        rejected = []
        for change in payload.changes:
            if change.entity != "InsightCard":
                rejected.append(change.mutation_id)
                continue
            existing = db.query(SyncMutation).filter(
                SyncMutation.client_device_id == device_id,
                SyncMutation.mutation_id == change.mutation_id,
            ).first()
            if existing:
                if existing.result == "ACCEPTED":
                    accepted.append(change.mutation_id)
                else:
                    rejected.append(change.mutation_id)
                continue
            fields = change.fields or {}
            row = db.query(InsightCard).filter(
                InsightCard.id == change.id,
                InsightCard.owner_user_id == current_user.id,
            ).first()
            if fields.get("deleted"):
                if row:
                    row.deleted_at = datetime.utcnow()
            else:
                config = fields.get("config")
                if config:
                    from .analytics_schemas import CardConfig
                    parsed = CardConfig.model_validate(config)
                    reasons = validate_config(parsed)
                    if reasons:
                        rejected.append(change.mutation_id)
                        continue
                if row is None:
                    row = InsightCard(
                        id=change.id,
                        owner_user_id=current_user.id,
                        name=fields.get("name") or "Card",
                        config_json=json.dumps(fields.get("config") or {}),
                        layout_json=json.dumps(fields.get("layout") or {"order": 0, "col_span": 1}),
                    )
                    db.add(row)
                else:
                    if "name" in fields:
                        row.name = fields["name"]
                    if "config" in fields:
                        row.config_json = json.dumps(fields["config"])
                    if "layout" in fields:
                        row.layout_json = json.dumps(fields["layout"])
                    row.deleted_at = None
                row.updated_at = datetime.utcnow()
            db.add(SyncMutation(
                mutation_id=change.mutation_id,
                client_device_id=device_id,
                entity_type="InsightCard",
                entity_id=change.id,
                field_path="ALL",
                updated_at=dateutil.parser.isoparse(change.updated_at).replace(tzinfo=None)
                if change.updated_at else datetime.utcnow(),
                applied_at=datetime.utcnow(),
                result="ACCEPTED",
            ))
            accepted.append(change.mutation_id)
        db.commit()
        rows = db.query(InsightCard).filter(
            InsightCard.owner_user_id == current_user.id,
            InsightCard.deleted_at.is_(None),
        ).all()
        return {
            "accepted_mutation_ids": accepted,
            "rejected_mutation_ids": rejected,
            "canonical": [_card_to_schema(row).model_dump(mode="json") for row in rows],
            "math_version": MATH_VERSION,
        }

    return router
