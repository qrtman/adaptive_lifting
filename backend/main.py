from fastapi import FastAPI, Depends, HTTPException, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import os

from sqlalchemy.orm import Session
from .database import (
    engine,
    get_db,
    init_db,
    Mesocycle,
    Microcycle,
    Workout,
    Exercise,
    ExerciseSet,
    User,
    CoachingRelationship,
    InviteCode,
)
from .runtime_config import (
    JWT_KID_CURRENT,
    JWT_KID_PREVIOUS,
    apply_dotenv,
    cookie_secure_flag,
    load_cors_allowed_origins,
    load_jwt_secrets,
)

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

from .math_utils import calculate_e1rm, calculate_inol, calculate_dots, calculate_attempt_jumps, calculate_acwr_series
from .accessory_migration import coerce_float, coerce_int

from sqlalchemy import text
# Make sure SQLite tables exist on launch
init_db()

def migrate_db():
    from .database import SessionLocal
    db = SessionLocal()
    try:
        db.execute(text("ALTER TABLE microcycles ADD COLUMN owner_id VARCHAR"))
        db.commit()
    except Exception:
        db.rollback()
    try:
        db.execute(text("ALTER TABLE exercise_sets ADD COLUMN velocity FLOAT"))
        db.commit()
    except Exception:
        db.rollback()
    try:
        db.execute(text("ALTER TABLE exercise_sets ADD COLUMN readiness INTEGER"))
        db.commit()
    except Exception:
        db.rollback()
    try:
        db.execute(text("ALTER TABLE exercise_sets ADD COLUMN hrv FLOAT"))
        db.commit()
    except Exception:
        db.rollback()
    try:
        db.execute(text("ALTER TABLE workouts ADD COLUMN athlete_bw FLOAT"))
        db.commit()
    except Exception:
        db.rollback()
    try:
        db.execute(text("ALTER TABLE exercises ADD COLUMN tier VARCHAR DEFAULT 'Comp'"))
        db.commit()
    except Exception:
        db.rollback()
    try:
        db.execute(text("ALTER TABLE exercises ADD COLUMN lift_category VARCHAR DEFAULT 'Squat'"))
        db.commit()
    except Exception:
        db.rollback()
    try:
        db.execute(text("ALTER TABLE workouts ADD COLUMN block_label VARCHAR"))
        db.commit()
    except Exception:
        db.rollback()
    try:
        db.execute(text("ALTER TABLE workouts ADD COLUMN week_label VARCHAR"))
        db.commit()
    except Exception:
        db.rollback()
    try:
        db.execute(text("ALTER TABLE workouts ADD COLUMN owner_id VARCHAR"))
        db.commit()
    except Exception:
        db.rollback()
    try:
        db.execute(text("ALTER TABLE workouts MODIFY microcycle_id VARCHAR NULL"))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()

    from .database import migrate_accessories_to_exercises, SessionLocal as MigrationSession
    migrate_session = MigrationSession()
    try:
        migrate_accessories_to_exercises(migrate_session)
    except Exception:
        migrate_session.rollback()
    finally:
        migrate_session.close()

migrate_db()

app = FastAPI(title="Adaptive Lifting Backend", version="1.0.0")

@app.on_event("startup")
def on_startup():
    from .integrations import start_background_worker
    start_background_worker()


app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

analytics_cache = {}

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
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception
        
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception
    return user

from .sse_broadcaster import router as sse_router
from .integrations import router as integrations_router
app.include_router(sse_router)
app.include_router(integrations_router)

# --- Pydantic Schemas for Requests ---

class RegisterRequest(BaseModel):
    email: str
    password: str
    role: str

class GoogleLoginRequest(BaseModel):
    token: str
    role: Optional[str] = "ATHLETE"

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
    
    return {"access_token": access_token, "token_type": "bearer", "user": {"id": user.id, "email": user.email, "role": user.role}}

@app.post("/api/auth/google")
def google_login(req: GoogleLoginRequest, response: Response, db: Session = Depends(get_db)):
    # Mocking Google Token Verification
    # In production, use google.oauth2.id_token.verify_oauth2_token
    if not req.token.startswith("mock_google_token_"):
        raise HTTPException(status_code=400, detail="Invalid Google token")
    
    email = req.token.replace("mock_google_token_", "") + "@gmail.com"
    user = db.query(User).filter(User.email == email).first()
    
    if not user:
        # Auto-register
        user = User(
            id=str(uuid.uuid4()),
            email=email,
            hashed_password=get_password_hash(str(uuid.uuid4())), # random password
            role=req.role
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        
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
    
    return {"access_token": access_token, "token_type": "bearer", "user": {"id": user.id, "email": user.email, "role": user.role}}

@app.post("/api/auth/logout")
def logout(response: Response, request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get("session_id")
    if token:
        try:
            payload = decode_access_token(token)
            session_id = payload.get("session_id")
            if session_id:
                from .database import Session as DBSession
                sess = db.query(DBSession).filter(DBSession.id == session_id).first()
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
        }
        planned_preview = getattr(s, "planned", None)
        if planned_preview is not None:
            set_dict["planned"] = planned_preview
        if s.dropPercent is not None:
            set_dict["dropPercent"] = s.dropPercent
        if s.note is not None:
            set_dict["note"] = s.note
        sets_list.append(set_dict)

    return {
        "id": e.id,
        "title": e.title,
        "variation": e.variation,
        "tier": e.tier or "Comp",
        "liftCategory": e.lift_category or "Other",
        "tags": e.tags,
        "top": e.top,
        "vol": e.vol,
        "sets": sets_list,
    }


def format_microcycle(mc: Microcycle) -> dict:
    workouts_list = []
    for w in sorted(mc.workouts, key=lambda x: x.id):
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
    
    return {"access_token": access_token, "token_type": "bearer", "role": user.role, "email": user.email}

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

    # Reactivate previous ended link to same coach if present
    prior = db.query(CoachingRelationship).filter(
        CoachingRelationship.athlete_id == current_user.id,
        CoachingRelationship.coach_id == coach.id,
    ).first()
    if prior:
        prior.ended_at = None
        link = prior
    else:
        link = CoachingRelationship(coach_id=coach.id, athlete_id=current_user.id)
        db.add(link)
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
    rel.ended_at = datetime.utcnow()
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
    rel.ended_at = datetime.utcnow()
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
                "activeMicrocycles": len(microcycles)
            })
    return athletes

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
    else:
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
    s = db.query(ExerciseSet).filter(ExerciseSet.id == req.setId).first()
    if not s:
        raise HTTPException(status_code=404, detail="Target set not found")

    s.actual = req.weight
    s.reps = req.reps
    s.executedRpe = req.rpe
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
    
    analytics_cache.pop(current_user.id, None)
    mcs = get_visible_microcycles(db, current_user)
    return [format_microcycle(mc) for mc in sorted(mcs, key=lambda x: x.id)]

@app.get("/api/analytics/trends")
def get_trends(athlete_id: Optional[str] = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    target_id = athlete_id if athlete_id else current_user.id
    
    if current_user.role == "COACH":
        rel = db.query(CoachingRelationship).filter(CoachingRelationship.coach_id == current_user.id, CoachingRelationship.athlete_id == target_id).first()
        if not rel:
            raise HTTPException(status_code=403, detail="Not authorized to view this athlete")
    elif current_user.role == "ATHLETE" and target_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to view other athletes")
        
    if target_id in analytics_cache:
        return analytics_cache[target_id]
        
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
    
    analytics_cache[target_id] = payload
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
        relationships = db.query(CoachingRelationship).filter(
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

@app.get("/api/analytics/ai-advisor")
def get_ai_advisor(
    athlete_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    import requests
    import json
    import re
    
    # 4.1 RBAC Enforcement
    target_id = athlete_id if athlete_id else current_user.id
    if current_user.role == "COACH":
        rel = db.query(CoachingRelationship).filter(
            CoachingRelationship.coach_id == current_user.id,
            CoachingRelationship.athlete_id == target_id
        ).first()
        if not rel:
            raise HTTPException(status_code=403, detail="Unauthorized coach request.")
    elif current_user.role == "ATHLETE" and target_id != current_user.id:
        raise HTTPException(status_code=403, detail="Unauthorized athlete request.")

    # 4.2 Secure Environment Key Validation
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="AI Autoregulation gateway temporarily unconfigured. Please define GEMINI_API_KEY on the server."
        )

    # 4.3 Pre-Aggregation Engine (Reducing Token Footprint)
    mcs = db.query(Microcycle).filter(Microcycle.owner_id == target_id).all()
    mc_ids = [mc.id for mc in mcs]
    workouts = db.query(Workout).filter(Workout.microcycle_id.in_(mc_ids)).all()
    
    # Compile performance peaks and stats
    squat_max = 0.0
    bench_max = 0.0
    deadlift_max = 0.0
    latest_bw = 100.0
    
    # Gather trailing workout trends
    scraped_trends = []
    for w in sorted(workouts, key=lambda x: x.date)[-5:]: # Limit to last 5 workouts to minimize token footprint
        workout_sets = []
        for e in w.exercises:
            for s in e.sets:
                wt = coerce_float(s.actual) or 0.0
                rp = coerce_int(s.reps) or 0
                rpe = coerce_float(s.executedRpe) or 0.0
                if wt > 0.0 and rp > 0:
                    e1rm = calculate_e1rm(wt, rp, rpe)
                    if e.lift_category == "Squat" and e1rm > squat_max: squat_max = e1rm
                    if e.lift_category == "Bench" and e1rm > bench_max: bench_max = e1rm
                    if e.lift_category == "Deadlift" and e1rm > deadlift_max: deadlift_max = e1rm
                    workout_sets.append({
                        "exercise": e.title,
                        "weight": wt,
                        "reps": rp,
                        "rpe": rpe,
                        "e1rm": round(e1rm, 1)
                    })
        scraped_trends.append({"date": w.date, "tonnage": w.tonnage, "logged": workout_sets})

    # Pull precalculated ACWR & INOL splits from standard trends endpoint logic
    trends_payload = get_trends(athlete_id=target_id, db=db, current_user=current_user)
    fatigue = trends_payload["fatigue_metrics"]
    
    scraped_payload = {
        "athlete": {
            "gender": "MALE",
            "bodyweight": trends_payload["current_bw"],
            "dots_score": trends_payload["dots_score"]
        },
        "fatigue_metrics": {
            "weekly_inol_squat": fatigue["weekly_inol_squat"],
            "weekly_inol_bench": fatigue["weekly_inol_bench"],
            "weekly_inol_deadlift": fatigue["weekly_inol_deadlift"],
            "acute_chronic_ratio": fatigue["acute_chronic_ratio"],
            "average_relative_intensity_pct": fatigue["average_relative_intensity_pct"]
        },
        "recent_history": scraped_trends
    }

    # 4.4 Target System Prompt Construction
    system_prompt = f"""
You are an Elite Powerlifting Coach acting strictly under Mike Tuchscherer's Reactive Training Systems (RTS) autoregulation principles.
Your task is to analyze the athlete's training metrics and rolling fatigue ratios, and output a highly personalized periodization diagnostic.

You MUST respond strictly in raw JSON matching the following schema. Do NOT include markdown tags, explanation headers, or raw text wraps. Only output valid, parseable JSON.

Athlete Profile:
{json.dumps(scraped_payload)}

Schema:
{{
  "cns_readiness": {{
    "status": "Functional Adaptation" | "Neural Fatigue Suppression" | "Detraining",
    "score": number (0-100),
    "analysis": "Exactly two sentences explaining the acute chronic workload ratio."
  }},
  "movement_diagnostics": {{
    "squat_fatigue": {{ "status": "Optimal" | "Caution" | "Danger", "inol": number, "warning": "string" }},
    "bench_fatigue": {{ "status": "Optimal" | "Caution" | "Danger", "inol": number, "warning": "string" }},
    "deadlift_fatigue": {{ "status": "Optimal" | "Caution" | "Danger", "inol": number, "warning": "string" }}
  }},
  "microcycle_prescription": {{
    "loading_strategy": "Maintain Baseline" | "Escalate Tonnage (+10%)" | "Load Drop Downsets (-5%)" | "Deload Decompression (-20%)",
    "tactical_guidance": "Actionable RTS periodization pacing adjustments",
    "suggested_rpe_cap": number
  }},
  "attempt_feedback": {{
    "opener_feasibility": "Conservative" | "Optimal" | "High-Risk",
    "coaching_notes": "Expert analysis of opener relative to peak strength curves"
  }}
}}
"""

    # 4.5 Execute Model Gateway Query
    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
        res = requests.post(url, json={
            "contents": [{"parts": [{"text": system_prompt}]}]
        }, timeout=12)

        if res.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to communicate with Google model gateway.")
            
        raw_result = res.json()
        raw_text = raw_result['candidates'][0]['content']['parts'][0]['text']
        
        # 4.6 Strict Sanitization
        cleaned_text = raw_text.strip()
        if cleaned_text.startswith("```"):
            cleaned_text = re.sub(r"^```(json)?\n", "", cleaned_text)
            cleaned_text = re.sub(r"\n```$", "", cleaned_text)
        cleaned_text = cleaned_text.strip()
        
        # Validate JSON structure
        parsed_data = json.loads(cleaned_text)
        if "cns_readiness" not in parsed_data or "microcycle_prescription" not in parsed_data:
            raise ValueError("Schema structure failed validation.")
            
        return parsed_data
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Neural processing exception: {str(e)}"
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
    import json
    from .database import AuditEvent, CoachingRelationship
    if current_user.role == "COACH":
        relationships = db.query(CoachingRelationship).filter(
            CoachingRelationship.coach_id == current_user.id,
            CoachingRelationship.ended_at.is_(None)
        ).all()
        athlete_ids = [r.athlete_id for r in relationships]
        allowed_ids = athlete_ids + [current_user.id]
        events = db.query(AuditEvent).filter(
            (AuditEvent.actor_user_id.in_(allowed_ids)) | (AuditEvent.actor_user_id.is_(None))
        ).order_by(AuditEvent.created_at.desc()).limit(100).all()
    else:
        events = db.query(AuditEvent).filter(
            AuditEvent.actor_user_id == current_user.id
        ).order_by(AuditEvent.created_at.desc()).limit(100).all()
        
    if not events:
        dummy_event = AuditEvent(
            id=str(uuid.uuid4()),
            actor_user_id=current_user.id,
            event_type="SYNC_INIT",
            resource_type="WorkoutTree",
            resource_id="root",
            created_at=datetime.utcnow() - timedelta(minutes=5),
            metadata_json=json.dumps({"info": "Secured client session initialized", "client_ip": "127.0.0.1"})
        )
        db.add(dummy_event)
        db.commit()
        events = [dummy_event]
        
    return [{
        "id": e.id,
        "actor_email": db.query(User).filter(User.id == e.actor_user_id).first().email if e.actor_user_id else "system",
        "event_type": e.event_type,
        "resource_type": e.resource_type,
        "resource_id": e.resource_id,
        "created_at": e.created_at.isoformat(),
        "metadata_json": e.metadata_json
    } for e in events]

@app.post("/api/reset")
def reset_database(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role == "ATHLETE":
        # Clear athlete plan to empty — do not re-seed demo data.
        mcs = db.query(Microcycle).filter(Microcycle.owner_id == current_user.id).all()
        for mc in mcs:
            db.delete(mc)
        # Also clear any owner-scoped sessions without microcycle
        orphans = db.query(Workout).filter(Workout.owner_id == current_user.id).all()
        for w in orphans:
            db.delete(w)
        db.commit()

    analytics_cache.pop(current_user.id, None)
    mcs = get_visible_microcycles(db, current_user)
    return [format_microcycle(mc) for mc in sorted(mcs, key=lambda x: x.id)]


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
    includeLogs: bool = False


ALLOWED_LIFT_CATEGORIES = {"Squat", "Bench", "Deadlift", "Other"}
ALLOWED_TIERS = {"Comp", "Variation", "Accessory"}


class AddExerciseRequest(BaseModel):
    title: str
    variation: Optional[str] = None
    tier: Optional[str] = "Comp"
    liftCategory: Optional[str] = "Other"
    plannedWeight: Optional[float] = None
    plannedReps: Optional[int] = 5
    plannedRpe: Optional[float] = 8.0


class UpdateExerciseRequest(BaseModel):
    variation: Optional[str] = None
    title: Optional[str] = None
    tier: Optional[str] = None
    move: Optional[str] = None


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
    if workout.status in ("COMPLETED", "MISSED"):
        raise HTTPException(status_code=409, detail="Session is locked")
    return workout


def session_owner_id(db: Session, workout: Workout) -> Optional[str]:
    if workout.owner_id:
        return workout.owner_id
    if workout.microcycle_id:
        mc = db.query(Microcycle).filter(Microcycle.id == workout.microcycle_id).first()
        return mc.owner_id if mc else None
    return None


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


def clone_session_prescription(
    db: Session,
    source: Workout,
    new_date: str,
    block_label: Optional[str],
    week_label: Optional[str],
    include_logs: bool = False,
) -> Workout:
    clone = Workout(
        id=f"w-{uuid.uuid4().hex[:10]}",
        date=new_date,
        dayLabel=new_date,
        title=source.title,
        tonnage=source.tonnage if include_logs else 0.0,
        delta=0.0,
        color="mac-blue",
        status="PLANNED",
        athlete_bw=None,
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
            tags_raw=exercise.tags_raw or "",
            top=exercise.top if include_logs else "—",
            vol=exercise.vol if include_logs else "—",
            workout_id=clone.id,
        )
        db.add(cloned_exercise)
        db.flush()
        for exercise_set in sorted(exercise.sets, key=lambda item: (item.lexo_rank or "", item.id)):
            if not is_live(exercise_set):
                continue
            db.add(ExerciseSet(
                id=f"s-{uuid.uuid4().hex[:10]}",
                lexo_rank=exercise_set.lexo_rank or "a0",
                label=exercise_set.label,
                plannedWeight=exercise_set.plannedWeight,
                plannedReps=exercise_set.plannedReps,
                plannedRpe=exercise_set.plannedRpe,
                dropPercent=exercise_set.dropPercent,
                isAuto=exercise_set.isAuto,
                actual=exercise_set.actual if include_logs else None,
                reps=exercise_set.reps if include_logs else None,
                executedRpe=exercise_set.executedRpe if include_logs else None,
                isTop=exercise_set.isTop,
                note=exercise_set.note,
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
        target_week = req.targetWeekLabel if req.targetWeekLabel is not None else next_week_label(source.week_label)
        clone = clone_session_prescription(
            db,
            source,
            shift_iso_date(source.date, req.dateOffsetDays),
            target_block,
            target_week,
            include_logs=req.includeLogs,
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

    microcycle_id = req.microcycleId
    if microcycle_id:
        mc = db.query(Microcycle).filter(Microcycle.id == microcycle_id, Microcycle.owner_id == athlete_id).first()
        if not mc:
            raise HTTPException(status_code=404, detail="Microcycle not found in athlete plan")
    else:
        mc = get_or_create_ungrouped_microcycle(db, athlete_id)
        microcycle_id = mc.id

    day_label = req.dayLabel or req.date
    workout = Workout(
        id=f"w-{uuid.uuid4().hex[:10]}",
        date=req.date,
        dayLabel=day_label,
        title=req.title or "Session",
        tonnage=0.0,
        delta=0.0,
        color="mac-blue",
        status="PLANNED",
        block_label=req.blockLabel,
        week_label=req.weekLabel,
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

    variation = (req.variation or "").strip() or (
        "Accessory" if tier == "Accessory" else "Competition"
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
        tags_raw=",".join(tags),
        top="—",
        vol="—",
        workout_id=workout.id,
    )
    db.add(exercise)
    db.flush()

    planned_reps = req.plannedReps if req.plannedReps is not None else 5
    planned_rpe = req.plannedRpe if req.plannedRpe is not None else 8.0
    db.add(ExerciseSet(
        id=f"s-{uuid.uuid4().hex[:10]}",
        lexo_rank="a0",
        label="Set 1",
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
        workout.block_label = req.blockLabel
    if req.weekLabel is not None:
        workout.week_label = req.weekLabel
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

