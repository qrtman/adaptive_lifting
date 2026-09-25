from fastapi import FastAPI, Depends, HTTPException, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import os

from sqlalchemy.orm import Session
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from .database import (
    engine,
    get_db,
    Mesocycle,
    Microcycle,
    Workout,
    Exercise,
    ExerciseSet,
    User,
    CoachingRelationship,
    CoachingHistorySnapshot,
    AuditEvent,
    InviteCode,
    DayNote,
)
from .runtime_config import (
    JWT_KID_CURRENT,
    JWT_KID_PREVIOUS,
    apply_dotenv,
    cookie_secure_flag,
    development_login_enabled,
    load_cors_allowed_origins,
    load_jwt_secrets,
)
from .dev_seed import DEMO_ATHLETE_EMAIL, DEMO_COACH_EMAIL, ensure_demo_accounts

apply_dotenv()
SECRET_KEY, JWT_SECRET_PREVIOUS = load_jwt_secrets()
CORS_ALLOWED_ORIGINS = load_cors_allowed_origins()
COOKIE_SECURE = cookie_secure_flag()
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 # 1 week

from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from passlib.context import CryptContext
import jwt
from datetime import datetime, timedelta, date
import re
import uuid
import hashlib
import secrets

from .set_writes import replace_exercise_sets
from .math_utils import calculate_e1rm, calculate_inol, calculate_dots, calculate_attempt_jumps, calculate_acwr_series
from .exercise_patterns import PATTERNS, pattern_for
from .accessory_migration import coerce_float, coerce_int

from sqlalchemy import text

app = FastAPI(title="Adaptive Lifting Backend", version="1.0.0")


@app.get("/api/health", include_in_schema=False)
def health_check():
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    return {"status": "ok"}

@app.on_event("startup")
def on_startup():
    # Fail closed when an operator has not applied the checked-in revisions.
    # Startup verifies migration state only; it never applies schema changes.
    from alembic.config import Config
    from alembic.runtime.migration import MigrationContext
    from alembic.script import ScriptDirectory

    alembic_config = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    expected_revision = ScriptDirectory.from_config(alembic_config).get_current_head()
    with engine.connect() as connection:
        current_revision = MigrationContext.configure(connection).get_current_revision()
    if current_revision != expected_revision:
        raise RuntimeError(
            f"Database migration required (current={current_revision!r}, expected={expected_revision!r}); "
            "run `alembic -c alembic.ini upgrade head` before starting the application."
        )

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Security Setup ---
import bcrypt
from fastapi.security import OAuth2PasswordBearer

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

def verify_password(plain_password, hashed_password):
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

def get_password_hash(password):
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def create_access_token(data: dict, expires_delta: timedelta = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(
        to_encode,
        SECRET_KEY,
        algorithm=ALGORITHM,
        headers={"kid": JWT_KID_CURRENT},
    )
    return encoded_jwt


def start_session(response: Response, user: User) -> dict:
    """Create the same signed, HttpOnly session used by every authentication path."""
    from .database import Session as DBSession, SessionLocal

    session_id = str(uuid.uuid4())
    db = SessionLocal()
    try:
        db.add(DBSession(
            id=session_id,
            user_id=user.id,
            jwt_id=session_id,
            expires_at=datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        ))
        db.commit()
    finally:
        db.close()

    access_token = create_access_token(
        data={"sub": user.id, "role": user.role, "session_id": session_id},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    response.set_cookie(
        key="session_id",
        value=access_token,
        httponly=True,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        samesite="lax",
        secure=COOKIE_SECURE,
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {"id": user.id, "email": user.email, "role": user.role, "displayName": user.display_name},
    }


def decode_access_token(token: str):
    try:
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")
    except jwt.PyJWTError:
        kid = None

    candidates = []
    if kid == JWT_KID_PREVIOUS and JWT_SECRET_PREVIOUS:
        candidates.append(JWT_SECRET_PREVIOUS)
    candidates.append(SECRET_KEY)
    if JWT_SECRET_PREVIOUS and JWT_SECRET_PREVIOUS not in candidates:
        candidates.append(JWT_SECRET_PREVIOUS)

    last_error = None
    for key in candidates:
        try:
            return jwt.decode(token, key, algorithms=[ALGORITHM])
        except jwt.PyJWTError as exc:
            last_error = exc
    if last_error:
        raise last_error
    raise jwt.InvalidTokenError("Unable to decode JWT")

def get_current_user(request: Request, db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    token = request.cookies.get("session_id")
    if not token:
        auth = request.headers.get("Authorization")
        if auth and auth.startswith("Bearer "):
            token = auth.split(" ")[1]
            
    if not token:
        raise credentials_exception

    try:
        payload = decode_access_token(token)
        if not isinstance(payload, dict) or payload.get("exp") is None:
            raise credentials_exception
        user_id: str = payload.get("sub")
        session_id = payload.get("session_id")
        if not isinstance(user_id, str) or not user_id or not isinstance(session_id, str) or not session_id:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception

    from .database import Session as DBSession
    auth_session = db.query(DBSession).filter(DBSession.id == session_id).first()
    if (
        auth_session is None
        or auth_session.user_id != user_id
        or auth_session.jwt_id != session_id
        or auth_session.revoked_at is not None
        or auth_session.expires_at <= datetime.utcnow()
    ):
        raise credentials_exception

    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if user is None:
        raise credentials_exception
    request.state.auth_session_id = session_id
    return user

from .integrations import router as integrations_router
from .analytics_router import create_analytics_router
app.include_router(integrations_router)
app.include_router(create_analytics_router(get_current_user))

# --- Pydantic Schemas for Requests ---

class RegisterRequest(BaseModel):
    email: str
    password: str
    role: str


class UpdateProfileRequest(BaseModel):
    displayName: Optional[str] = None

class GoogleLoginRequest(BaseModel):
    token: str
    # The application role is not asserted by the Google identity token.


def verify_google_id_token(token: str, client_id: str) -> dict:
    """Verify a Google ID token's signature and standard OIDC claims."""
    from google.auth.transport.requests import Request as GoogleRequest
    from google.oauth2 import id_token

    return id_token.verify_oauth2_token(token, GoogleRequest(), audience=client_id)

@app.post("/api/auth/login")
def login(response: Response, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    session_id = str(uuid.uuid4())
    from .database import Session as DBSession
    db_session = DBSession(
        id=session_id,
        user_id=user.id,
        jwt_id=session_id,
        expires_at=datetime.utcnow() + access_token_expires
    )
    db.add(db_session)
    db.commit()
    
    access_token = create_access_token(
        data={"sub": user.id, "role": user.role, "session_id": session_id}, expires_delta=access_token_expires
    )
    
    response.set_cookie(
        key="session_id",
        value=access_token,
        httponly=True,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        samesite="lax",
        secure=COOKIE_SECURE
    )
    
    return {"access_token": access_token, "token_type": "bearer", "user": {"id": user.id, "email": user.email, "role": user.role, "displayName": user.display_name}}


@app.post("/api/dev/login/{role}")
def development_login(role: str, response: Response, db: Session = Depends(get_db)):
    """Sign into a stable, linked demo account in explicitly enabled local environments."""
    if not development_login_enabled():
        raise HTTPException(status_code=404, detail="Development login is unavailable")

    normalized_role = role.strip().upper()
    if normalized_role not in {"COACH", "ATHLETE"}:
        raise HTTPException(status_code=404, detail="Unknown development role")

    ensure_demo_accounts(db, get_password_hash)
    email = DEMO_COACH_EMAIL if normalized_role == "COACH" else DEMO_ATHLETE_EMAIL
    user = db.query(User).filter(User.email == email).one()
    return start_session(response, user)

@app.post("/api/auth/google")
def google_login(req: GoogleLoginRequest, response: Response, db: Session = Depends(get_db)):
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
    if not client_id:
        raise HTTPException(status_code=503, detail="Google login is not configured (GOOGLE_CLIENT_ID is required)")

    try:
        claims = verify_google_id_token(req.token, client_id)
    except Exception:
        # Invalid signature, issuer, audience, expiry, malformed token, or
        # provider certificate-fetch failure all fail closed as auth errors.
        raise HTTPException(status_code=401, detail="Invalid Google ID token")

    # verify_oauth2_token validates signature, issuer, audience, and expiry.
    subject = claims.get("sub") if isinstance(claims, dict) else None
    email = claims.get("email") if isinstance(claims, dict) else None
    if (
        not isinstance(subject, str) or not subject.strip()
        or not isinstance(email, str) or not email.strip()
        or claims.get("email_verified") is not True
    ):
        raise HTTPException(status_code=401, detail="Google account must have a verified email and subject")

    subject = subject.strip()
    email = email.strip().lower()
    subject_user = db.query(User).filter(User.google_sub == subject).one_or_none()
    if subject_user is not None:
        if subject_user.deleted_at is not None:
            raise HTTPException(status_code=403, detail="This account is unavailable")
        user = subject_user
    else:
        # Link only to a non-deleted account matching Google's verified email.
        matching_users = db.query(User).filter(func.lower(User.email) == email).all()
        if len(matching_users) > 1:
            raise HTTPException(status_code=409, detail="Multiple local accounts match this Google email")
        user = matching_users[0] if matching_users else None
        if user is not None:
            if user.deleted_at is not None:
                raise HTTPException(status_code=403, detail="This account is unavailable")
            if user.google_sub is not None and user.google_sub != subject:
                raise HTTPException(status_code=409, detail="Google identity is already linked to another account")
            user.google_sub = subject
        else:
            # App authorization roles are not taken from browser input.
            user = User(
                id=str(uuid.uuid4()),
                email=email,
                hashed_password=get_password_hash(str(uuid.uuid4())),
                role="COACH",
                google_sub=subject,
            )
            db.add(user)

        try:
            db.commit()
            db.refresh(user)
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=409, detail="Google identity or email is already linked")

    return start_session(response, user)

@app.post("/api/auth/logout")
def logout(response: Response, request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get("session_id")
    if not token:
        authorization = request.headers.get("Authorization", "")
        if authorization.startswith("Bearer "):
            token = authorization[len("Bearer "):].strip()
    if token:
        try:
            payload = decode_access_token(token)
            session_id = payload.get("session_id")
            user_id = payload.get("sub")
            if session_id and user_id:
                from .database import Session as DBSession
                sess = db.query(DBSession).filter(
                    DBSession.id == session_id,
                    DBSession.user_id == user_id,
                    DBSession.jwt_id == session_id,
                ).first()
                if sess:
                    sess.revoked_at = datetime.utcnow()
                    db.commit()
        except Exception:
            pass
    response.delete_cookie(key="session_id")
    return {"status": "success"}


class LinkCodeRequest(BaseModel):
    code: str

class LogSetRequest(BaseModel):
    workoutId: str
    exerciseId: str
    setId: str
    weight: float
    reps: int
    rpe: float
    note: Optional[str] = None
    velocity: Optional[float] = None
    readiness: Optional[int] = None
    hrv: Optional[float] = None

class PushProgramRequest(BaseModel):
    athleteId: str
    template: str

# --- Powerlifting Math Helpers ---
# Canonical formulas live in math_utils.py (calculate_e1rm / calculate_e1rm_linear_decay).

def recalculate_metrics(db: Session, workout_id: str, day_label: str):
    workout = db.query(Workout).filter(Workout.id == workout_id).first()
    if not workout:
        return

    # Calculate Tonnage
    total_tonnage = 0.0

    for exercise in workout.exercises:
        exercise_volume = 0.0
        max_weight = 0.0
        max_weight_reps = 0
        top_single_e1rm = 0.0
        top_single_weight = 0.0
        top_single_reps = 0

        for s in exercise.sets:
            wt = coerce_float(s.actual if s.actual is not None else s.plannedWeight) or 0.0
            rp = coerce_int(s.reps if s.reps is not None else s.plannedReps) or 0
            rp_val = coerce_float(s.executedRpe if s.executedRpe is not None else s.plannedRpe) or 0.0

            if wt > 0.0 and rp > 0:
                set_volume = wt * rp
                exercise_volume += set_volume

                if wt > max_weight:
                    max_weight = wt
                    max_weight_reps = rp

                set_e1rm = calculate_e1rm(wt, rp, rp_val)
                if s.isTop or set_e1rm > top_single_e1rm:
                    top_single_e1rm = set_e1rm
                    top_single_weight = wt
                    top_single_reps = rp

        total_tonnage += exercise_volume

        # Update exercise labels
        if top_single_weight > 0.0:
            exercise.top = f"{top_single_weight}kg x {top_single_reps}"
        if exercise_volume > 0.0:
            exercise.vol = f"{exercise_volume:,.0f}kg"

    workout.tonnage = total_tonnage

    # Recalculate Delta: Find same day label in previous microcycle
    current_micro = workout.microcycle
    # Try to extract the number from weekName e.g., "Microcycle 03" -> 3
    try:
        micro_num = int(current_micro.weekName.split()[-1])
        prev_micro_name = f"Microcycle {micro_num - 1:02d}"
        prev_micro = db.query(Microcycle).filter(Microcycle.weekName == prev_micro_name).first()
        if prev_micro:
            prev_workout = db.query(Workout).filter(
                Workout.microcycle_id == prev_micro.id,
                Workout.dayLabel == day_label
            ).first()
            if prev_workout:
                workout.delta = total_tonnage - prev_workout.tonnage
    except Exception:
        pass

    db.commit()

# --- Response Formatting Helpers ---

def is_live(entity) -> bool:
    return getattr(entity, "deleted_at", None) is None


def format_exercise(e: Exercise) -> dict:
    sets_list = []
    for s in sorted(e.sets, key=lambda x: (x.lexo_rank or "", x.id)):
        if not is_live(s):
            continue
        set_dict = {
            "id": s.id,
            "label": s.label,
            "scope": getattr(s, "scope", None) or "both",
            "plannedWeight": coerce_float(s.plannedWeight),
            "plannedReps": coerce_int(s.plannedReps),
            "plannedRpe": coerce_float(s.plannedRpe),
            "actual": coerce_float(s.actual),
            "reps": coerce_int(s.reps),
            "executedRpe": coerce_float(s.executedRpe),
            "velocity": coerce_float(s.velocity),
            "readiness": coerce_int(s.readiness),
            "hrv": coerce_float(s.hrv),
            "isAuto": s.isAuto,
            "isTop": s.isTop,
            "intensityType": getattr(s, "intensity_type", None) or "RPE",
            "dropPercent": coerce_float(s.dropPercent) if s.dropPercent is not None else 0,
        }
        planned_preview = getattr(s, "planned", None)
        if planned_preview is not None:
            set_dict["planned"] = planned_preview
        if s.note is not None:
            set_dict["note"] = s.note
        sets_list.append(set_dict)

    return {
        "id": e.id,
        "title": e.title,
        "variation": e.variation,
        "tier": e.tier or "Comp",
        "liftCategory": e.lift_category or "Other",
        "movementPattern": e.movement_pattern or pattern_for(e.title, e.lift_category),
        "liftNote": e.lift_note,
        "tags": e.tags,
        "top": e.top,
        "vol": e.vol,
        "sets": sets_list,
    }


def format_microcycle(mc: Microcycle) -> dict:
    workouts_list = []
    for w in sorted(mc.workouts, key=lambda x: x.id):
        if not is_live(w):
            continue
        exercises_list = [
            format_exercise(e)
            for e in sorted(w.exercises, key=lambda x: (x.lexo_rank or "", x.id))
            if is_live(e)
        ]

        workouts_list.append({
            "id": w.id,
            "date": w.date,
            "dayLabel": w.dayLabel,
            "title": w.title,
            "tonnage": w.tonnage,
            "delta": w.delta,
            "color": w.color,
            "status": w.status,
            "blockLabel": getattr(w, "block_label", None),
            "weekLabel": getattr(w, "week_label", None),
            "exercises": exercises_list,
        })

    return {
        "id": mc.id,
        "weekName": mc.weekName,
        "focus": mc.focus,
        "status": mc.status,
        "active": mc.active,
        "workouts": workouts_list
    }


def hash_coach_code(code: str) -> str:
    return hashlib.sha256(code.strip().upper().encode("utf-8")).hexdigest()


def active_coaching_query(db: Session):
    return db.query(CoachingRelationship).filter(CoachingRelationship.ended_at.is_(None))


def relationship_audit_event(actor: User, rel: CoachingRelationship, event_type: str) -> AuditEvent:
    import json
    return AuditEvent(
        id=str(uuid.uuid4()),
        actor_user_id=actor.id,
        event_type=event_type,
        resource_type="CoachingRelationship",
        resource_id=str(rel.id),
        created_at=datetime.utcnow(),
        metadata_json=json.dumps({"relationship_id": rel.id, "coach_id": rel.coach_id, "athlete_id": rel.athlete_id}),
    )


def create_coaching_history_snapshot(db: Session, rel: CoachingRelationship, ended_at: datetime) -> CoachingHistorySnapshot:
    import json
    athlete = db.query(User).filter(User.id == rel.athlete_id).first()
    start_date = (rel.created_at or ended_at).date().isoformat()
    end_date = ended_at.date().isoformat()
    microcycles = db.query(Microcycle).filter(
        Microcycle.owner_id == rel.athlete_id,
        Microcycle.deleted_at.is_(None),
    ).order_by(Microcycle.id).all()
    archived_microcycles = []
    for microcycle in microcycles:
        formatted = format_microcycle(microcycle)
        formatted["workouts"] = [
            workout for workout in formatted["workouts"]
            if start_date <= workout["date"] <= end_date
        ]
        if formatted["workouts"]:
            archived_microcycles.append(formatted)
    snapshot_payload = {
        "relationshipId": rel.id,
        "fromDate": start_date,
        "throughDate": end_date,
        "athlete": {
            "id": rel.athlete_id,
            "email": athlete.email if athlete else "",
            "displayName": athlete.display_name if athlete else None,
        },
        "microcycles": archived_microcycles,
    }
    return CoachingHistorySnapshot(
        relationship_id=rel.id,
        snapshot_at=ended_at,
        snapshot_json=json.dumps(snapshot_payload),
    )


def assert_plan_access(db: Session, current_user: User, athlete_id: str) -> str:
    """Return athlete_id if current_user may read/write that athlete plan space."""
    if current_user.role == "ATHLETE":
        if athlete_id != current_user.id:
            raise HTTPException(status_code=403, detail="Athletes can only access their own plan")
        return athlete_id
    if current_user.role == "COACH":
        rel = active_coaching_query(db).filter(
            CoachingRelationship.coach_id == current_user.id,
            CoachingRelationship.athlete_id == athlete_id,
        ).first()
        if not rel:
            raise HTTPException(status_code=403, detail="Not linked to this athlete")
        return athlete_id
    raise HTTPException(status_code=403, detail="Not authorized")


def resolve_athlete_id(current_user: User, athlete_id: Optional[str]) -> str:
    if current_user.role == "ATHLETE":
        return current_user.id
    if not athlete_id:
        raise HTTPException(status_code=400, detail="athlete_id is required for coaches")
    return athlete_id


def resolve_plan_owner(db: Session, current_user: User, athlete_id: Optional[str]) -> str:
    """RBAC like microcycles: athletes 403 on another athlete_id; coaches need a linked athlete."""
    if current_user.role == "ATHLETE":
        target = athlete_id or current_user.id
        assert_plan_access(db, current_user, target)
        return current_user.id
    target = resolve_athlete_id(current_user, athlete_id)
    assert_plan_access(db, current_user, target)
    return target


def require_iso_date(value: str) -> str:
    raw = (value or "").strip()
    try:
        datetime.strptime(raw, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    return raw


def optional_label(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def get_or_create_ungrouped_microcycle(db: Session, owner_id: str) -> Microcycle:
    mc = db.query(Microcycle).filter(
        Microcycle.owner_id == owner_id,
        Microcycle.weekName == "Ungrouped",
    ).first()
    if mc:
        return mc
    mc = Microcycle(
        id=f"ungrouped-{uuid.uuid4().hex[:8]}",
        weekName="Ungrouped",
        focus="Unlabeled sessions",
        status="DRAFT",
        active=True,
        owner_id=owner_id,
    )
    db.add(mc)
    db.commit()
    db.refresh(mc)
    return mc

# --- REST Endpoints ---
from .sync_service import SyncPayload, resolve_sync_payload

@app.post("/api/auth/register")
def register_user(req: RegisterRequest, response: Response, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == req.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
        
    user = User(
        id=str(uuid.uuid4()),
        email=req.email,
        hashed_password=get_password_hash(req.password),
        role=req.role
    )
    db.add(user)
    db.commit()
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    session_id = str(uuid.uuid4())
    from .database import Session as DBSession
    db_session = DBSession(
        id=session_id,
        user_id=user.id,
        jwt_id=session_id,
        expires_at=datetime.utcnow() + access_token_expires
    )
    db.add(db_session)
    db.commit()
    
    access_token = create_access_token(
        data={"sub": user.id, "role": user.role, "session_id": session_id}, expires_delta=access_token_expires
    )
    
    response.set_cookie(
        key="session_id",
        value=access_token,
        httponly=True,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        samesite="lax",
        secure=COOKIE_SECURE
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": user.role,
        "email": user.email,
        "id": user.id,
        "displayName": user.display_name,
        "user": {"id": user.id, "email": user.email, "role": user.role, "displayName": user.display_name},
    }


@app.patch("/api/auth/profile")
def update_auth_profile(req: UpdateProfileRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    display_name = (req.displayName or "").strip()
    if len(display_name) > 80:
        raise HTTPException(status_code=422, detail="Display name must be 80 characters or fewer")
    current_user.display_name = display_name or None
    db.commit()
    db.refresh(current_user)
    return {"id": current_user.id, "email": current_user.email, "role": current_user.role, "displayName": current_user.display_name}

@app.post("/api/auth/coach-code")
def create_coach_code(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "COACH":
        raise HTTPException(status_code=403, detail="Only coaches can create coach codes")
    # Rotate: expire previous unused codes for this coach
    for old in db.query(InviteCode).filter(InviteCode.coach_id == current_user.id, InviteCode.used_at.is_(None)).all():
        old.used_at = datetime.utcnow()
    raw = secrets.token_hex(3).upper()  # 6 hex chars
    invite = InviteCode(
        id=str(uuid.uuid4()),
        coach_id=current_user.id,
        code_hash=hash_coach_code(raw),
        expires_at=datetime.utcnow() + timedelta(days=365),
        used_at=None,
    )
    db.add(invite)
    db.commit()
    return {"code": raw, "expires_at": invite.expires_at.isoformat()}


@app.get("/api/auth/coach-code")
def get_coach_code_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "COACH":
        raise HTTPException(status_code=403, detail="Only coaches can view coach codes")
    active = db.query(InviteCode).filter(
        InviteCode.coach_id == current_user.id,
        InviteCode.used_at.is_(None),
        InviteCode.expires_at > datetime.utcnow(),
    ).order_by(InviteCode.expires_at.desc()).first()
    if not active:
        return {"active": False, "code": None}
    return {"active": True, "expires_at": active.expires_at.isoformat(), "hint": "Rotate to reveal a new code"}


@app.post("/api/auth/link")
@app.post("/api/auth/link-athlete")
def link_athlete(req: LinkCodeRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "ATHLETE":
        raise HTTPException(status_code=403, detail="Only athletes can link to a coach")

    code_hash = hash_coach_code(req.code)
    invite = db.query(InviteCode).filter(
        InviteCode.code_hash == code_hash,
        InviteCode.used_at.is_(None),
        InviteCode.expires_at > datetime.utcnow(),
    ).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invalid or expired coach code")

    coach = db.query(User).filter(User.id == invite.coach_id, User.role == "COACH").first()
    if not coach:
        raise HTTPException(status_code=404, detail="Coach not found for this code")

    existing_link = active_coaching_query(db).filter(CoachingRelationship.athlete_id == current_user.id).first()
    if existing_link:
        raise HTTPException(status_code=400, detail="Athlete is already linked to a coach")

    consumed_at = datetime.utcnow()
    consumed = db.query(InviteCode).filter(
        InviteCode.id == invite.id,
        InviteCode.used_at.is_(None),
        InviteCode.expires_at > consumed_at,
    ).update({InviteCode.used_at: consumed_at}, synchronize_session=False)
    if consumed != 1:
        raise HTTPException(status_code=404, detail="Invalid or expired coach code")

    link = CoachingRelationship(coach_id=coach.id, athlete_id=current_user.id, created_at=datetime.utcnow())
    db.add(link)
    db.flush()
    db.add(relationship_audit_event(current_user, link, "ATHLETE_LINKED"))
    db.commit()
    return {"status": "success", "message": f"Successfully linked to coach {coach.email}"}


@app.delete("/api/auth/link")
def unlink_coach(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Unlink coach from athlete. Plan data stays in athlete space."""
    if current_user.role == "ATHLETE":
        rel = active_coaching_query(db).filter(CoachingRelationship.athlete_id == current_user.id).first()
    elif current_user.role == "COACH":
        raise HTTPException(status_code=400, detail="Coaches must unlink a specific athlete via DELETE /api/auth/link/{athlete_id}")
    else:
        raise HTTPException(status_code=403, detail="Not authorized")
    if not rel:
        raise HTTPException(status_code=404, detail="No active coaching link")
    ended_at = datetime.utcnow()
    rel.ended_at = ended_at
    db.add(create_coaching_history_snapshot(db, rel, ended_at))
    db.add(relationship_audit_event(current_user, rel, "ATHLETE_UNLINKED"))
    db.commit()
    return {"status": "success", "message": "Unlinked. Athlete plan remains in athlete space."}


@app.delete("/api/auth/link/{athlete_id}")
def unlink_athlete(athlete_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "COACH":
        raise HTTPException(status_code=403, detail="Only coaches can unlink athletes by id")
    rel = active_coaching_query(db).filter(
        CoachingRelationship.coach_id == current_user.id,
        CoachingRelationship.athlete_id == athlete_id,
    ).first()
    if not rel:
        raise HTTPException(status_code=404, detail="No active coaching link")
    ended_at = datetime.utcnow()
    rel.ended_at = ended_at
    db.add(create_coaching_history_snapshot(db, rel, ended_at))
    db.add(relationship_audit_event(current_user, rel, "COACH_UNLINKED_ATHLETE"))
    db.commit()
    return {"status": "success", "message": "Unlinked. Athlete plan remains in athlete space."}

@app.get("/api/coach/roster")
def get_roster(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "COACH":
        raise HTTPException(status_code=403, detail="Not authorized")
        
    relationships = active_coaching_query(db).filter(CoachingRelationship.coach_id == current_user.id).all()
    athletes = []
    for rel in relationships:
        athlete = db.query(User).filter(User.id == rel.athlete_id).first()
        if athlete:
            # Fetch some quick stats
            microcycles = db.query(Microcycle).filter(Microcycle.owner_id == athlete.id, Microcycle.active == True).all()
            athletes.append({
                "id": athlete.id, 
                "email": athlete.email,
                "displayName": athlete.display_name,
                "activeMicrocycles": len(microcycles)
            })
    return athletes


@app.get("/api/coach/roster/history")
def get_roster_history(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    import json
    if current_user.role != "COACH":
        raise HTTPException(status_code=403, detail="Not authorized")
    relationships = db.query(CoachingRelationship).filter(
        CoachingRelationship.coach_id == current_user.id,
        CoachingRelationship.ended_at.is_not(None),
    ).order_by(CoachingRelationship.ended_at.desc()).all()
    history = []
    for rel in relationships:
        snapshot = db.query(CoachingHistorySnapshot).filter(
            CoachingHistorySnapshot.relationship_id == rel.id
        ).first()
        payload = json.loads(snapshot.snapshot_json) if snapshot else None
        athlete = payload.get("athlete", {}) if payload else {}
        if not payload:
            current_athlete = db.query(User).filter(User.id == rel.athlete_id).first()
            athlete = {
                "id": rel.athlete_id,
                "email": current_athlete.email if current_athlete else "",
                "displayName": current_athlete.display_name if current_athlete else None,
            }
        history.append({
            "relationshipId": rel.id,
            "athleteId": rel.athlete_id,
            "email": athlete.get("email", ""),
            "displayName": athlete.get("displayName"),
            "linkedAt": rel.created_at.isoformat() if rel.created_at else None,
            "endedAt": rel.ended_at.isoformat() if rel.ended_at else None,
            "archiveAvailable": payload is not None,
        })
    return history


@app.get("/api/coach/roster/history/{relationship_id}")
def get_roster_history_snapshot(relationship_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    import json
    if current_user.role != "COACH":
        raise HTTPException(status_code=403, detail="Not authorized")
    rel = db.query(CoachingRelationship).filter(
        CoachingRelationship.id == relationship_id,
        CoachingRelationship.coach_id == current_user.id,
        CoachingRelationship.ended_at.is_not(None),
    ).first()
    if not rel:
        raise HTTPException(status_code=404, detail="Past athlete history not found")
    snapshot = db.query(CoachingHistorySnapshot).filter(
        CoachingHistorySnapshot.relationship_id == rel.id
    ).first()
    if not snapshot:
        raise HTTPException(status_code=404, detail="History snapshot is unavailable for this past link")
    return json.loads(snapshot.snapshot_json)

@app.post("/api/coach/push-program")
def push_program(req: PushProgramRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "COACH":
        raise HTTPException(status_code=403, detail="Not authorized")
        
    rel = db.query(CoachingRelationship).filter(
        CoachingRelationship.coach_id == current_user.id,
        CoachingRelationship.athlete_id == req.athleteId
    ).first()
    
    if not rel or rel.ended_at is not None:
        raise HTTPException(status_code=403, detail="Not authorized to push to this athlete")

    # Plans stay athlete-owned and empty unless sessions are created explicitly.
    # Demo seed injection is intentionally removed.
    return {
        "status": "success",
        "message": "Push acknowledged. Create sessions on the athlete plan — demo programs are not auto-injected.",
        "athleteId": req.athleteId,
        "template": req.template,
    }

def get_visible_microcycles(db: Session, current_user: User, athlete_id: Optional[str] = None):
    if current_user.role == "COACH":
        if athlete_id:
            assert_plan_access(db, current_user, athlete_id)
            return db.query(Microcycle).filter(Microcycle.owner_id == athlete_id).all()
        relationships = active_coaching_query(db).filter(CoachingRelationship.coach_id == current_user.id).all()
        athlete_ids = [rel.athlete_id for rel in relationships]
        if not athlete_ids:
            return []
        return db.query(Microcycle).filter(Microcycle.owner_id.in_(athlete_ids)).all()
    target = athlete_id or current_user.id
    assert_plan_access(db, current_user, target)
    return db.query(Microcycle).filter(Microcycle.owner_id == current_user.id).all()

@app.get("/api/microcycles")
def get_microcycles(
    athlete_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Empty athlete plans stay empty — never auto-seed demo microcycles.
    mcs = get_visible_microcycles(db, current_user, athlete_id=athlete_id)
    return [format_microcycle(mc) for mc in sorted(mcs, key=lambda x: x.id)]

@app.post("/api/sets/log")
def log_set(req: LogSetRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_session_for_write(db, current_user, req.workoutId)
    s = db.query(ExerciseSet).filter(ExerciseSet.id == req.setId).first()
    if not s or not is_live(s):
        raise HTTPException(status_code=404, detail="Target set not found")
    exercise = db.query(Exercise).filter(Exercise.id == s.exercise_id).first()
    if not exercise or not is_live(exercise) or exercise.workout_id != req.workoutId:
        raise HTTPException(status_code=404, detail="Target set not found")
    if req.exerciseId and exercise.id != req.exerciseId:
        raise HTTPException(status_code=404, detail="Target set not found")

    s.actual = req.weight
    s.reps = req.reps
    s.executedRpe = req.rpe
    if (getattr(s, "scope", None) or "both") == "plan":
        s.scope = "both"
    if req.note is not None:
        s.note = req.note
    if req.velocity is not None:
        s.velocity = req.velocity
    if req.readiness is not None:
        s.readiness = req.readiness
    if req.hrv is not None:
        s.hrv = req.hrv

    db.commit()
    recalculate_metrics(db, req.workoutId, db.query(Workout).filter(Workout.id == req.workoutId).first().dayLabel)
    
    mcs = get_visible_microcycles(db, current_user)
    return [format_microcycle(mc) for mc in sorted(mcs, key=lambda x: x.id)]

def athlete_fatigue_summary(db: Session, current_user: User, athlete_id: Optional[str] = None) -> dict:
    target_id = athlete_id if athlete_id else current_user.id
    
    if current_user.role == "COACH":
        rel = active_coaching_query(db).filter(CoachingRelationship.coach_id == current_user.id, CoachingRelationship.athlete_id == target_id).first()
        if not rel:
            raise HTTPException(status_code=403, detail="Not authorized to view this athlete")
    elif current_user.role == "ATHLETE" and target_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to view other athletes")
        
    mcs = db.query(Microcycle).filter(Microcycle.owner_id == target_id).all()
    mc_ids = [mc.id for mc in mcs]
    
    comp_nl = 0
    var_nl = 0
    acc_nl = 0
    
    squat_inol = 0.0
    bench_inol = 0.0
    deadlift_inol = 0.0
    
    total_intensity = 0.0
    total_qualifying_sets = 0
    
    squat_max = 0.0
    bench_max = 0.0
    deadlift_max = 0.0
    latest_bw = 100.0
    
    fatigue_series = []
    
    workouts = db.query(Workout).filter(Workout.microcycle_id.in_(mc_ids)).order_by(Workout.date).all()
    
    for w in workouts:
        if w.athlete_bw:
            latest_bw = w.athlete_bw
            
        for e in w.exercises:
            for s in e.sets:
                wt = coerce_float(s.actual) or 0.0
                rp = coerce_int(s.reps) or 0
                rpe = coerce_float(s.executedRpe) or 0.0
                    
                if wt > 0.0 and rp > 0:
                    if e.tier == "Comp": comp_nl += rp
                    elif e.tier == "Variation": var_nl += rp
                    elif e.tier == "Accessory": acc_nl += rp
                    
                    if e.tier != "Accessory":
                        e1rm = calculate_e1rm(wt, rp, rpe)
                        if e1rm > 0:
                            if e.lift_category == "Squat" and e1rm > squat_max: squat_max = e1rm
                            if e.lift_category == "Bench" and e1rm > bench_max: bench_max = e1rm
                            if e.lift_category == "Deadlift" and e1rm > deadlift_max: deadlift_max = e1rm
                            
                            intensity_pct = (wt / e1rm) * 100.0
                            inol = calculate_inol(rp, intensity_pct)
                            if e.lift_category == "Squat": squat_inol += inol
                            if e.lift_category == "Bench": bench_inol += inol
                            if e.lift_category == "Deadlift": deadlift_inol += inol
                            
                            if intensity_pct >= 60.0:
                                total_intensity += intensity_pct
                                total_qualifying_sets += 1
                                
                            fatigue_series.append({
                                "date": w.date,
                                "e1rm": e1rm,
                                "cumulative_inol": squat_inol + bench_inol + deadlift_inol
                            })
                            
    ari = round(total_intensity / total_qualifying_sets, 2) if total_qualifying_sets > 0 else 0.0
    dots = calculate_dots("MALE", latest_bw, squat_max + bench_max + deadlift_max)
    
    # Calculate true rolling daily ACWR series with gap filling
    acwr_series = calculate_acwr_series(workouts)
    if acwr_series:
        acwr = acwr_series[-1]["acwr"]
    else:
        total_nl = comp_nl + var_nl + acc_nl
        acute = total_nl
        chronic = total_nl / 4.0 if total_nl > 0 else 1.0
        acwr = round(acute / chronic, 2)
    
    payload = {
        "athlete_id": target_id,
        "current_bw": latest_bw,
        "dots_score": dots,
        "volume_splitting_weekly": {
            "comp_nl": comp_nl,
            "variation_nl": var_nl,
            "accessory_nl": acc_nl
        },
        "fatigue_metrics": {
            "weekly_inol_squat": round(squat_inol, 2),
            "weekly_inol_bench": round(bench_inol, 2),
            "weekly_inol_deadlift": round(deadlift_inol, 2),
            "acute_chronic_ratio": acwr,
            "average_relative_intensity_pct": ari,
            "series": fatigue_series,
            "acwr_series": acwr_series
        },
        "attempt_planner_defaults": calculate_attempt_jumps(squat_max, "squat_dl", "MALE")
    }
    return payload

@app.get("/api/export/csv")
def export_csv(
    lift_category: Optional[str] = None,
    tier: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    import csv
    import io
    
    if current_user.role == "COACH":
        relationships = active_coaching_query(db).filter(
            CoachingRelationship.coach_id == current_user.id
        ).all()
        athlete_ids = [rel.athlete_id for rel in relationships]
        allowed_ids = athlete_ids + [current_user.id]
    else:
        allowed_ids = [current_user.id]

    query = db.query(ExerciseSet).join(Exercise).join(Workout).join(Microcycle).filter(
        Microcycle.owner_id.in_(allowed_ids)
    )

    if lift_category and lift_category != "All":
        query = query.filter(Exercise.lift_category == lift_category)
    if tier:
        query = query.filter(Exercise.tier == tier)

    sets = query.order_by(Workout.date, Exercise.id, ExerciseSet.id).all()

    output = io.StringIO()
    writer = csv.writer(output)
    
    writer.writerow([
        "Date", "Lift Category", "Tier", "Exercise Title", 
        "Planned Weight (kg)", "Actual Weight (kg)", "Reps", "RPE", 
        "e1RM (kg)", "INOL", "Tonnage (kg)"
    ])

    for s in sets:
        ex = s.exercise
        w = ex.workout
        
        planned_wt = coerce_float(s.plannedWeight) or 0.0
        actual_wt = coerce_float(s.actual) or 0.0
        reps_val = coerce_int(s.reps if s.reps is not None else s.plannedReps) or 0
        rpe_val = coerce_float(s.executedRpe if s.executedRpe is not None else s.plannedRpe) or 0.0

        e1rm = calculate_e1rm(actual_wt, reps_val, rpe_val)
        intensity_pct = (actual_wt / e1rm) * 100.0 if e1rm > 0 else 0.0
        inol = calculate_inol(reps_val, intensity_pct)
        tonnage = actual_wt * reps_val

        writer.writerow([
            w.date,
            ex.lift_category or "Squat",
            ex.tier or "Comp",
            ex.title,
            planned_wt if planned_wt > 0 else s.plannedWeight or "—",
            actual_wt if actual_wt > 0 else s.actual or "—",
            reps_val if reps_val > 0 else "—",
            rpe_val if rpe_val > 0 else "—",
            round(e1rm, 1) if e1rm > 0 else "—",
            round(inol, 2) if inol > 0 else "—",
            round(tonnage, 1) if tonnage > 0 else "—"
        ])

    csv_data = output.getvalue()
    output.close()

    from .database import AuditEvent
    import json
    db.add(AuditEvent(
        id=str(uuid.uuid4()),
        actor_user_id=current_user.id,
        event_type="EXPORT_CSV",
        resource_type="WorkoutTree",
        resource_id="all",
        created_at=datetime.utcnow(),
        metadata_json=json.dumps({
            "row_count": len(sets),
            "lift_category": lift_category,
            "tier": tier
        })
    ))
    db.commit()

    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=adaptive_lifting_export.csv"}
    )

@app.get("/api/export/json")
def export_json(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    import json
    mcs = get_visible_microcycles(db, current_user)
    formatted = [format_microcycle(mc) for mc in sorted(mcs, key=lambda x: x.id)]
    
    from .database import AuditEvent
    db.add(AuditEvent(
        id=str(uuid.uuid4()),
        actor_user_id=current_user.id,
        event_type="EXPORT_JSON",
        resource_type="WorkoutTree",
        resource_id="all",
        created_at=datetime.utcnow(),
        metadata_json=json.dumps({"microcycle_count": len(formatted)})
    ))
    db.commit()

    return Response(
        content=json.dumps(formatted, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=adaptive_lifting_export.json"}
    )

@app.post("/api/workouts/{id}/sync")
def sync_workout(id: str, payload: SyncPayload, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return resolve_sync_payload(db, payload, current_user.id)

@app.get("/api/security/devices")
def get_devices(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from .database import ClientDevice
    devices = db.query(ClientDevice).filter(ClientDevice.user_id == current_user.id).all()
    if not devices:
        default_device = ClientDevice(
            id="dev-default-" + str(uuid.uuid4())[:8],
            user_id=current_user.id,
            device_label="Primary Mobile PWA Terminal",
            last_seen_at=datetime.utcnow()
        )
        db.add(default_device)
        db.commit()
        devices = [default_device]
    return [{
        "id": d.id,
        "device_label": d.device_label or "PWA Web App",
        "last_seen_at": d.last_seen_at.isoformat() if d.last_seen_at else None,
        "revoked_at": d.revoked_at.isoformat() if d.revoked_at else None
    } for d in devices]

@app.delete("/api/security/devices/{id}")
def revoke_device(id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from .database import ClientDevice
    d = db.query(ClientDevice).filter(ClientDevice.id == id, ClientDevice.user_id == current_user.id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Device not found")
    d.revoked_at = datetime.utcnow()
    db.commit()
    return {"status": "success"}

@app.get("/api/security/sessions")
def get_sessions(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from .database import Session as DBSession
    sessions = db.query(DBSession).filter(DBSession.user_id == current_user.id).order_by(DBSession.expires_at.desc()).all()
    return [{
        "id": s.id,
        "expires_at": s.expires_at.isoformat(),
        "revoked_at": s.revoked_at.isoformat() if s.revoked_at else None
    } for s in sessions]

@app.delete("/api/security/sessions/{id}")
def revoke_session(id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from .database import Session as DBSession
    s = db.query(DBSession).filter(DBSession.id == id, DBSession.user_id == current_user.id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    s.revoked_at = datetime.utcnow()
    db.commit()
    return {"status": "success"}

@app.get("/api/security/audit-events")
def get_audit_events(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from .database import AuditEvent
    if current_user.role == "COACH":
        relationships = db.query(CoachingRelationship).filter(
            CoachingRelationship.coach_id == current_user.id
        ).all()
        relationship_ids = [str(r.id) for r in relationships]
        own_events = db.query(AuditEvent).filter(
            AuditEvent.actor_user_id == current_user.id
        ).all()
        relationship_events = []
        if relationship_ids:
            relationship_events = db.query(AuditEvent).filter(
                AuditEvent.resource_type == "CoachingRelationship",
                AuditEvent.resource_id.in_(relationship_ids),
                AuditEvent.event_type.in_(("ATHLETE_LINKED", "ATHLETE_UNLINKED", "COACH_UNLINKED_ATHLETE")),
            ).all()
        events_by_id = {event.id: event for event in (*own_events, *relationship_events)}
        events = sorted(events_by_id.values(), key=lambda event: event.created_at or datetime.min, reverse=True)[:100]
    else:
        events = db.query(AuditEvent).filter(
            AuditEvent.actor_user_id == current_user.id
        ).order_by(AuditEvent.created_at.desc()).limit(100).all()
        
    return [{
        "id": e.id,
        "actor_email": db.query(User).filter(User.id == e.actor_user_id).first().email if e.actor_user_id else "system",
        "event_type": e.event_type,
        "resource_type": e.resource_type,
        "resource_id": e.resource_id,
        "created_at": e.created_at.isoformat(),
        "metadata_json": e.metadata_json
    } for e in events]


class CreateSessionRequest(BaseModel):
    date: str
    title: Optional[str] = "Session"
    dayLabel: Optional[str] = None
    blockLabel: Optional[str] = None
    weekLabel: Optional[str] = None
    athleteId: Optional[str] = None
    microcycleId: Optional[str] = None


class UpdateSessionRequest(BaseModel):
    date: Optional[str] = None
    title: Optional[str] = None
    dayLabel: Optional[str] = None
    blockLabel: Optional[str] = None
    weekLabel: Optional[str] = None
    status: Optional[str] = None


class BulkLabelsRequest(BaseModel):
    sessionIds: List[str]
    blockLabel: Optional[str] = None
    weekLabel: Optional[str] = None
    clearBlock: bool = False
    clearWeek: bool = False
    athleteId: Optional[str] = None


class CopyWeekRequest(BaseModel):
    sessionIds: List[str]
    athleteId: Optional[str] = None
    dateOffsetDays: int = 7
    targetBlockLabel: Optional[str] = None
    targetWeekLabel: Optional[str] = None
    copyMode: Optional[str] = None
    includeLogs: Optional[bool] = None
    preserveWeekLabel: bool = False


ALLOWED_LIFT_CATEGORIES = {"Squat", "Bench", "Deadlift", "Other"}
ALLOWED_TIERS = {"Comp", "Variation", "Accessory"}
ALLOWED_MOVEMENT_PATTERNS = set(PATTERNS)


def resolve_movement_pattern(title: str, lift_category: Optional[str], requested: Optional[str]) -> str:
    if requested:
        if requested not in ALLOWED_MOVEMENT_PATTERNS:
            raise HTTPException(status_code=400, detail="Invalid movementPattern")
        return requested
    return pattern_for(title, lift_category)


class AddExerciseRequest(BaseModel):
    title: str
    variation: Optional[str] = None
    tier: Optional[str] = "Comp"
    liftCategory: Optional[str] = "Other"
    movementPattern: Optional[str] = None
    liftNote: Optional[str] = None
    plannedWeight: Optional[float] = None
    plannedReps: Optional[int] = None
    plannedRpe: Optional[float] = None


class UpdateExerciseRequest(BaseModel):
    variation: Optional[str] = None
    title: Optional[str] = None
    tier: Optional[str] = None
    liftCategory: Optional[str] = None
    movementPattern: Optional[str] = None
    liftNote: Optional[str] = None
    move: Optional[str] = None
    order: Optional[List[str]] = None


class PlannedSetWrite(BaseModel):
    id: Optional[str] = None
    label: Optional[str] = None
    scope: Optional[str] = "both"
    plannedWeight: Optional[float] = None
    plannedReps: Optional[int] = None
    plannedRpe: Optional[float] = None
    intensityType: Optional[str] = None
    isAuto: bool = False
    isTop: Optional[bool] = None
    actual: Optional[float] = None
    reps: Optional[int] = None
    executedRpe: Optional[float] = None
    dropPercent: Optional[float] = None


class ReplaceExerciseSetsRequest(BaseModel):
    sets: List[PlannedSetWrite]


def live_exercises(workout: Workout):
    return sorted(
        [e for e in (workout.exercises or []) if is_live(e)],
        key=lambda item: (item.lexo_rank or "", item.id),
    )


def reindex_exercises(ordered) -> None:
    for index, exercise in enumerate(ordered):
        exercise.lexo_rank = f"a{index}"


def require_session_for_write(db: Session, current_user: User, session_id: str) -> Workout:
    workout = db.query(Workout).filter(Workout.id == session_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Session not found")
    owner_id = session_owner_id(db, workout)
    if not owner_id:
        raise HTTPException(status_code=400, detail="Session has no owner")
    assert_plan_access(db, current_user, owner_id)
    return workout


def session_owner_id(db: Session, workout: Workout) -> Optional[str]:
    if workout.owner_id:
        return workout.owner_id
    if workout.microcycle_id:
        mc = db.query(Microcycle).filter(Microcycle.id == workout.microcycle_id).first()
        return mc.owner_id if mc else None
    return None


# This router needs the plan authorization helpers above at import time.
from .sse_broadcaster import router as sse_router
app.include_router(sse_router)


def shift_iso_date(iso: str, days: int) -> str:
    return (date.fromisoformat(iso) + timedelta(days=days)).isoformat()


def next_week_label(week: Optional[str]) -> Optional[str]:
    if not week or not week.strip():
        return None
    match = re.match(r"^(.*?)(\d+)$", week.strip())
    if not match:
        return f"{week.strip()}-next"
    prefix, digits = match.group(1), match.group(2)
    return f"{prefix}{int(digits) + 1}"


_ISO_DAY_LABEL = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def clone_day_label(source_label: Optional[str], new_date: str) -> str:
    raw = (source_label or "").strip()
    if not raw or _ISO_DAY_LABEL.fullmatch(raw):
        return new_date
    return raw


def clone_session_prescription(
    db: Session,
    source: Workout,
    new_date: str,
    block_label: Optional[str],
    week_label: Optional[str],
    copy_mode: str = "logs",
) -> Workout:
    include_logs = copy_mode == "logs"
    include_plan = copy_mode in ("plan", "logs")
    clone = Workout(
        id=f"w-{uuid.uuid4().hex[:10]}",
        date=new_date,
        dayLabel=clone_day_label(source.dayLabel, new_date),
        title=source.title,
        tonnage=source.tonnage if include_logs else 0.0,
        delta=0.0,
        color=source.color,
        status="PLANNED",
        athlete_bw=source.athlete_bw,
        block_label=block_label,
        week_label=week_label,
        owner_id=source.owner_id,
        microcycle_id=source.microcycle_id,
    )
    db.add(clone)
    db.flush()
    for exercise in sorted(source.exercises, key=lambda item: (item.lexo_rank or "", item.id)):
        if not is_live(exercise):
            continue
        cloned_exercise = Exercise(
            id=f"e-{uuid.uuid4().hex[:10]}",
            lexo_rank=exercise.lexo_rank or "a0",
            title=exercise.title,
            variation=exercise.variation,
            tier=exercise.tier or "Comp",
            lift_category=exercise.lift_category or "Other",
            movement_pattern=exercise.movement_pattern or pattern_for(exercise.title, exercise.lift_category),
            tags_raw=exercise.tags_raw or "",
            lift_note=exercise.lift_note,
            top=exercise.top if include_plan else "—",
            vol=exercise.vol if include_plan else "—",
            workout_id=clone.id,
        )
        db.add(cloned_exercise)
        db.flush()
        if copy_mode == "lifts":
            continue
        for exercise_set in sorted(exercise.sets, key=lambda item: (item.lexo_rank or "", item.id)):
            if not is_live(exercise_set):
                continue
            db.add(ExerciseSet(
                id=f"s-{uuid.uuid4().hex[:10]}",
                lexo_rank=exercise_set.lexo_rank or "a0",
                label=exercise_set.label,
                scope=((getattr(exercise_set, "scope", None) or "both") if include_logs else "plan"),
                plannedWeight=exercise_set.plannedWeight,
                plannedReps=exercise_set.plannedReps,
                plannedRpe=exercise_set.plannedRpe,
                intensity_type=getattr(exercise_set, "intensity_type", None) or "RPE",
                dropPercent=exercise_set.dropPercent,
                isAuto=exercise_set.isAuto,
                actual=exercise_set.actual if include_logs else None,
                reps=exercise_set.reps if include_logs else None,
                executedRpe=exercise_set.executedRpe if include_logs else None,
                isTop=exercise_set.isTop,
                note=exercise_set.note if include_logs else None,
                velocity=exercise_set.velocity if include_logs else None,
                readiness=exercise_set.readiness if include_logs else None,
                hrv=exercise_set.hrv if include_logs else None,
                exercise_id=cloned_exercise.id,
            ))
    return clone


@app.post("/api/sessions/copy-week")
def copy_week(req: CopyWeekRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not req.sessionIds:
        raise HTTPException(status_code=400, detail="sessionIds required")
    # Offset may be negative or zero so a copy can land on a chosen calendar date.

    copy_mode = req.copyMode
    if copy_mode is None:
        copy_mode = "logs" if req.includeLogs is True else "plan" if req.includeLogs is False else "logs"
    if copy_mode not in {"lifts", "plan", "logs"}:
        raise HTTPException(status_code=400, detail="copyMode must be lifts, plan, or logs")

    sources = []
    owner_id = None
    for session_id in req.sessionIds:
        workout = db.query(Workout).filter(Workout.id == session_id).first()
        if not workout:
            raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")
        found_owner = session_owner_id(db, workout)
        if not found_owner:
            raise HTTPException(status_code=400, detail="Session has no owner")
        if owner_id is None:
            owner_id = found_owner
        elif found_owner != owner_id:
            raise HTTPException(status_code=400, detail="All sessions must belong to one athlete plan")
        sources.append(workout)

    assert_plan_access(db, current_user, owner_id)

    created = []
    for source in sources:
        target_block = req.targetBlockLabel if req.targetBlockLabel is not None else source.block_label
        if req.targetWeekLabel is not None:
            target_week = req.targetWeekLabel
        elif req.preserveWeekLabel:
            target_week = source.week_label
        else:
            target_week = next_week_label(source.week_label)
        clone = clone_session_prescription(
            db,
            source,
            shift_iso_date(source.date, req.dateOffsetDays),
            target_block,
            target_week,
            copy_mode=copy_mode,
        )
        created.append({
            "id": clone.id,
            "date": clone.date,
            "title": clone.title,
            "blockLabel": clone.block_label,
            "weekLabel": clone.week_label,
            "sourceId": source.id,
        })
    db.commit()
    return {"status": "success", "copied": created}


@app.post("/api/sessions")
def create_session(req: CreateSessionRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    athlete_id = resolve_athlete_id(current_user, req.athleteId)
    assert_plan_access(db, current_user, athlete_id)
    session_date = require_iso_date(req.date)
    block_label = optional_label(req.blockLabel)
    week_label = optional_label(req.weekLabel)

    microcycle_id = req.microcycleId
    if microcycle_id:
        mc = db.query(Microcycle).filter(Microcycle.id == microcycle_id, Microcycle.owner_id == athlete_id).first()
        if not mc:
            raise HTTPException(status_code=404, detail="Microcycle not found in athlete plan")
    else:
        mc = get_or_create_ungrouped_microcycle(db, athlete_id)
        microcycle_id = mc.id

    day_label = req.dayLabel or session_date
    workout = Workout(
        id=f"w-{uuid.uuid4().hex[:10]}",
        date=session_date,
        dayLabel=day_label,
        title=(req.title or "").strip() or "Session",
        tonnage=0.0,
        delta=0.0,
        color="mac-blue",
        status="PLANNED",
        block_label=block_label,
        week_label=week_label,
        owner_id=athlete_id,
        microcycle_id=microcycle_id,
    )
    db.add(workout)
    db.commit()
    db.refresh(workout)
    return {
        "id": workout.id,
        "date": workout.date,
        "dayLabel": workout.dayLabel,
        "title": workout.title,
        "status": workout.status,
        "blockLabel": workout.block_label,
        "weekLabel": workout.week_label,
        "microcycleId": workout.microcycle_id,
        "ownerId": workout.owner_id,
        "exercises": [],
    }


DAY_NOTE_MAX_LEN = 2000


class UpsertDayNoteRequest(BaseModel):
    date: str
    body: Optional[str] = ""
    athleteId: Optional[str] = None


def format_day_note(note: DayNote) -> dict:
    return {
        "id": note.id,
        "date": note.date,
        "body": note.body,
        "ownerId": note.owner_id,
    }


@app.get("/api/day-notes")
def list_day_notes(
    athlete_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target_id = resolve_plan_owner(db, current_user, athlete_id)
    rows = db.query(DayNote).filter(
        DayNote.owner_id == target_id,
        DayNote.deleted_at.is_(None),
    ).order_by(DayNote.date.asc()).all()
    return {"notes": [format_day_note(row) for row in rows if (row.body or "").strip()]}


@app.put("/api/day-notes")
def upsert_day_note(
    req: UpsertDayNoteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    athlete_id = resolve_plan_owner(db, current_user, req.athleteId)
    note_date = require_iso_date(req.date)
    body = (req.body or "").strip()
    if len(body) > DAY_NOTE_MAX_LEN:
        raise HTTPException(status_code=400, detail=f"Note must be {DAY_NOTE_MAX_LEN} characters or fewer")

    row = db.query(DayNote).filter(
        DayNote.owner_id == athlete_id,
        DayNote.date == note_date,
    ).first()
    now = datetime.utcnow()
    if not body:
        if row and row.deleted_at is None:
            row.deleted_at = now
            row.body = ""
            db.commit()
        return {"id": row.id if row else None, "date": note_date, "body": None, "ownerId": athlete_id}

    if row:
        row.body = body
        row.deleted_at = None
        row.updated_at = now
    else:
        row = DayNote(
            id=f"dn-{uuid.uuid4().hex[:10]}",
            owner_id=athlete_id,
            date=note_date,
            body=body,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return format_day_note(row)


@app.post("/api/sessions/{session_id}/exercises")
def add_session_exercise(
    session_id: str,
    req: AddExerciseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    workout = require_session_for_write(db, current_user, session_id)

    title = (req.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title required")

    tier = req.tier or "Comp"
    lift_category = req.liftCategory or "Other"
    if tier not in ALLOWED_TIERS:
        raise HTTPException(status_code=400, detail="Invalid tier")
    if lift_category not in ALLOWED_LIFT_CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid liftCategory")
    movement_pattern = resolve_movement_pattern(title, lift_category, req.movementPattern)

    variation = (req.variation or "").strip() or (
        "Accessory" if tier == "Accessory" else title
    )
    tags = [lift_category] if lift_category != "Other" else ([tier] if tier == "Accessory" else [])

    existing_count = len([e for e in (workout.exercises or []) if is_live(e)])
    exercise = Exercise(
        id=f"e-{uuid.uuid4().hex[:10]}",
        lexo_rank=f"a{existing_count}",
        title=title,
        variation=variation,
        tier=tier,
        lift_category=lift_category,
        movement_pattern=movement_pattern,
        lift_note=(req.liftNote or "").strip() or None,
        tags_raw=",".join(tags),
        top="—",
        vol="—",
        workout_id=workout.id,
    )
    db.add(exercise)
    db.flush()

    planned_reps = req.plannedReps
    planned_rpe = req.plannedRpe
    db.add(ExerciseSet(
        id=f"s-{uuid.uuid4().hex[:10]}",
        lexo_rank="a0",
        label="Set 1",
        scope="both",
        plannedWeight=req.plannedWeight,
        plannedReps=planned_reps,
        plannedRpe=planned_rpe,
        isAuto=False,
        isTop=True,
        actual=None,
        reps=None,
        executedRpe=None,
        exercise_id=exercise.id,
    ))
    db.commit()
    persisted = db.query(Exercise).filter(Exercise.id == exercise.id).first()
    return format_exercise(persisted)


@app.put("/api/sessions/{session_id}/exercises/{exercise_id}/sets")
def replace_session_exercise_sets(
    session_id: str,
    exercise_id: str,
    req: ReplaceExerciseSetsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    workout = require_session_for_write(db, current_user, session_id)
    exercise = next((e for e in (workout.exercises or []) if e.id == exercise_id and is_live(e)), None)
    if not exercise:
        raise HTTPException(status_code=404, detail="Lift not found")
    rows = [row.model_dump() if hasattr(row, "model_dump") else row.dict() for row in req.sets]
    replace_exercise_sets(exercise, rows)
    db.commit()
    db.refresh(exercise)
    recalculate_metrics(db, workout.id, workout.dayLabel)
    return format_exercise(exercise)


@app.delete("/api/sessions/{session_id}/exercises/{exercise_id}")
def remove_session_exercise(
    session_id: str,
    exercise_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    workout = require_session_for_write(db, current_user, session_id)
    exercise = next((e for e in (workout.exercises or []) if e.id == exercise_id and is_live(e)), None)
    if not exercise:
        raise HTTPException(status_code=404, detail="Lift not found")
    now = datetime.utcnow()
    exercise.deleted_at = now
    for exercise_set in exercise.sets or []:
        if is_live(exercise_set):
            exercise_set.deleted_at = now
    reindex_exercises(live_exercises(workout))
    db.commit()
    return {"status": "success", "id": exercise_id}


@app.patch("/api/sessions/{session_id}/exercises/{exercise_id}")
def update_session_exercise(
    session_id: str,
    exercise_id: str,
    req: UpdateExerciseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    workout = require_session_for_write(db, current_user, session_id)
    exercise = next((e for e in (workout.exercises or []) if e.id == exercise_id and is_live(e)), None)
    if not exercise:
        raise HTTPException(status_code=404, detail="Lift not found")
    if req.title is not None:
        title = req.title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="title required")
        exercise.title = title
    if req.variation is not None:
        variation = req.variation.strip()
        if not variation:
            raise HTTPException(status_code=400, detail="variation required")
        exercise.variation = variation
    if req.tier is not None:
        if req.tier not in ALLOWED_TIERS:
            raise HTTPException(status_code=400, detail="Invalid tier")
        exercise.tier = req.tier
    if req.liftCategory is not None:
        if req.liftCategory not in ALLOWED_LIFT_CATEGORIES:
            raise HTTPException(status_code=400, detail="Invalid liftCategory")
        exercise.lift_category = req.liftCategory
    if req.movementPattern is not None:
        exercise.movement_pattern = resolve_movement_pattern(
            exercise.title, exercise.lift_category, req.movementPattern
        )
    if req.liftNote is not None:
        exercise.lift_note = req.liftNote.strip() or None
    if req.move is not None:
        direction = req.move.strip().lower()
        if direction not in ("up", "down"):
            raise HTTPException(status_code=400, detail="move must be up or down")
        ordered = live_exercises(workout)
        index = next((i for i, item in enumerate(ordered) if item.id == exercise.id), None)
        if index is None:
            raise HTTPException(status_code=404, detail="Lift not found")
        swap_with = index - 1 if direction == "up" else index + 1
        if 0 <= swap_with < len(ordered):
            ordered[index], ordered[swap_with] = ordered[swap_with], ordered[index]
            reindex_exercises(ordered)
    if req.order is not None:
        ordered = live_exercises(workout)
        current_ids = {item.id for item in ordered}
        requested_ids = req.order
        if len(requested_ids) != len(set(requested_ids)) or set(requested_ids) != current_ids:
            raise HTTPException(status_code=400, detail="order must contain each live lift exactly once")
        by_id = {item.id: item for item in ordered}
        reindex_exercises([by_id[item_id] for item_id in requested_ids])
    db.commit()
    persisted = db.query(Exercise).filter(Exercise.id == exercise.id).first()
    return format_exercise(persisted)


@app.patch("/api/sessions/{session_id}")
def update_session(session_id: str, req: UpdateSessionRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    workout = db.query(Workout).filter(Workout.id == session_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Session not found")
    owner_id = workout.owner_id
    if not owner_id and workout.microcycle_id:
        mc = db.query(Microcycle).filter(Microcycle.id == workout.microcycle_id).first()
        owner_id = mc.owner_id if mc else None
    if not owner_id:
        raise HTTPException(status_code=400, detail="Session has no owner")
    assert_plan_access(db, current_user, owner_id)

    if req.date is not None:
        workout.date = req.date
    if req.title is not None:
        workout.title = req.title
    if req.dayLabel is not None:
        workout.dayLabel = req.dayLabel
    if req.blockLabel is not None:
        workout.block_label = req.blockLabel.strip() or None
    if req.weekLabel is not None:
        workout.week_label = req.weekLabel.strip() or None
    if req.status is not None:
        if req.status not in ("PLANNED", "IN_PROGRESS", "COMPLETED", "MISSED"):
            raise HTTPException(status_code=400, detail="Invalid status")
        workout.status = req.status
        if req.status == "COMPLETED":
            workout.color = "mac-green"
        elif req.status == "MISSED":
            workout.color = "gray"
        else:
            workout.color = "mac-blue"
    db.commit()
    db.refresh(workout)
    return {
        "id": workout.id,
        "date": workout.date,
        "dayLabel": workout.dayLabel,
        "title": workout.title,
        "status": workout.status,
        "blockLabel": workout.block_label,
        "weekLabel": workout.week_label,
        "microcycleId": workout.microcycle_id,
        "ownerId": workout.owner_id,
    }


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    workout = db.query(Workout).filter(Workout.id == session_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Session not found")
    owner_id = workout.owner_id
    if not owner_id and workout.microcycle_id:
        mc = db.query(Microcycle).filter(Microcycle.id == workout.microcycle_id).first()
        owner_id = mc.owner_id if mc else None
    if not owner_id:
        raise HTTPException(status_code=400, detail="Session has no owner")
    assert_plan_access(db, current_user, owner_id)
    db.delete(workout)
    db.commit()
    return {"status": "success"}


@app.patch("/api/sessions/labels")
def bulk_update_session_labels(req: BulkLabelsRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not req.sessionIds:
        raise HTTPException(status_code=400, detail="sessionIds required")
    updated = []
    for sid in req.sessionIds:
        workout = db.query(Workout).filter(Workout.id == sid).first()
        if not workout:
            continue
        owner_id = workout.owner_id
        if not owner_id and workout.microcycle_id:
            mc = db.query(Microcycle).filter(Microcycle.id == workout.microcycle_id).first()
            owner_id = mc.owner_id if mc else None
        if not owner_id:
            continue
        assert_plan_access(db, current_user, owner_id)
        if req.clearBlock:
            workout.block_label = None
        elif req.blockLabel is not None:
            workout.block_label = req.blockLabel
        if req.clearWeek:
            workout.week_label = None
        elif req.weekLabel is not None:
            workout.week_label = req.weekLabel
        updated.append(sid)
    db.commit()
    return {"status": "success", "updated": updated}


