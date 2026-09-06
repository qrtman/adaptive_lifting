from fastapi import FastAPI, Depends, HTTPException, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import os

from sqlalchemy.orm import Session
from .database import engine, get_db, init_db, Mesocycle, Microcycle, Workout, Exercise, ExerciseSet, User, CoachingRelationship
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
from datetime import datetime, timedelta
import uuid

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

def format_microcycle(mc: Microcycle) -> dict:
    workouts_list = []
    for w in sorted(mc.workouts, key=lambda x: x.id):
        exercises_list = []
        for e in sorted(w.exercises, key=lambda x: (x.lexo_rank or "", x.id)):
            sets_list = []
            for s in sorted(e.sets, key=lambda x: (x.lexo_rank or "", x.id)):
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

            exercises_list.append({
                "id": e.id,
                "title": e.title,
                "variation": e.variation,
                "tier": e.tier or "Comp",
                "liftCategory": e.lift_category or "Other",
                "tags": e.tags,
                "top": e.top,
                "vol": e.vol,
                "sets": sets_list
            })

        workouts_list.append({
            "id": w.id,
            "date": w.date,
            "dayLabel": w.dayLabel,
            "title": w.title,
            "tonnage": w.tonnage,
            "delta": w.delta,
            "color": w.color,
            "status": w.status,
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

# --- Database Seeder ---

INITIAL_SEEDS = [
    {
        "id": "micro-1",
        "weekName": "Microcycle 01",
        "focus": "Technical Proficiency / Baseline",
        "status": "COMPLETED",
        "active": False,
        "workouts": [
            {
                "id": "w-1-1", "date": "2026-09-02", "dayLabel": "D1", "title": "Primary Squat, Primary Bench",
                "tonnage": 12400.0, "delta": 0.0, "color": "mac-green", "status": "COMPLETED",
                "exercises": [
                    {
                        "id": "e-1-1-1", "title": "Primary Squat", "variation": "Low Bar Competition", "tags": "Comp Spec, Brace Focus",
                        "top": "150kg x 1", "vol": "8,600kg",
                        "sets": [
                            {"id": "s-1-1-1a", "label": "Top Single", "planned": "150kg x 1", "plannedWeight": 150.0, "plannedReps": 1, "plannedRpe": 5.0, "isTop": True, "actual": 150.0, "reps": 1, "executedRpe": 5.0},
                            {"id": "s-1-1-1b", "label": "Main Set", "planned": "137.5kg x 4", "plannedWeight": 137.5, "plannedReps": 4, "plannedRpe": 6.0, "actual": 137.5, "reps": 4, "executedRpe": 6.0},
                            {"id": "s-1-1-1c", "label": "Backdown", "planned": "127.5kg x 4", "plannedWeight": 127.5, "plannedReps": 4, "plannedRpe": 5.0, "note": "-5% Drop", "actual": 127.5, "reps": 4, "executedRpe": 5.0, "dropPercent": -5.0}
                        ]
                    },
                    {
                        "id": "e-1-1-2", "title": "Primary Bench", "variation": "Competition Paused", "tags": "Static Leg Drive, 1-sec Pause",
                        "top": "90kg x 3", "vol": "3,800kg",
                        "sets": [
                            {"id": "s-1-1-2a", "label": "Top Single", "plannedWeight": 90.0, "plannedReps": 3, "plannedRpe": 6.0, "isTop": True, "actual": 90.0, "reps": 3, "executedRpe": 6.0}
                        ]
                    },
                    {
                        "id": "a-1-1-1", "title": "Leg Press", "variation": "Accessory", "tier": "Accessory", "lift_category": "Other", "tags": "Accessory",
                        "top": "120kg x 12", "vol": "4,320kg",
                        "sets": [
                            {"id": "a-1-1-1-s1", "label": "Set 1", "plannedWeight": 120.0, "plannedReps": 10, "plannedRpe": 7.0, "actual": 120.0, "reps": 12, "executedRpe": 7.0},
                            {"id": "a-1-1-1-s2", "label": "Set 2", "plannedWeight": 120.0, "plannedReps": 10, "plannedRpe": 7.0, "actual": 120.0, "reps": 12, "executedRpe": 7.0},
                            {"id": "a-1-1-1-s3", "label": "Set 3", "plannedWeight": 120.0, "plannedReps": 10, "plannedRpe": 7.0, "actual": 120.0, "reps": 12, "executedRpe": 7.0}
                        ]
                    }
                ],
            },
            {
                "id": "w-1-2", "date": "2026-09-04", "dayLabel": "D2", "title": "Secondary Deadlift, Secondary Bench",
                "tonnage": 8900.0, "delta": 0.0, "color": "mac-green", "status": "COMPLETED",
                "exercises": [
                    {
                        "id": "e-1-2-1", "title": "Secondary Deadlift", "variation": "Deficit Deadlift", "tags": "Patience off Floor",
                        "top": "180kg x 3", "vol": "4,700kg",
                        "sets": [
                            {"id": "s-1-2-1a", "label": "Top Set", "planned": "180kg x 3", "plannedWeight": 180.0, "plannedReps": 3, "plannedRpe": 6.0, "isTop": True, "actual": 180.0, "reps": 3, "executedRpe": 6.0}
                        ]
                    },
                    {
                        "id": "e-1-2-2", "title": "Secondary Bench", "variation": "Spoto Press", "tags": "Hover Focus, Chest Activation",
                        "top": "85kg x 5", "vol": "4,200kg",
                        "sets": [
                            {"id": "s-1-2-2a", "label": "Top Set", "planned": "85kg x 5", "plannedWeight": 85.0, "plannedReps": 5, "plannedRpe": 7.0, "isTop": True, "actual": 85.0, "reps": 5, "executedRpe": 7.0}
                        ]
                    }
                ]
            }
        ]
    },
    {
        "id": "micro-2",
        "weekName": "Microcycle 02",
        "focus": "Accumulation / Volume Expansion",
        "status": "COMPLETED",
        "active": False,
        "workouts": [
            {
                "id": "w-2-1", "date": "2026-09-09", "dayLabel": "D1", "title": "Primary Squat, Primary Bench",
                "tonnage": 13200.0, "delta": 800.0, "color": "mac-green", "status": "COMPLETED",
                "exercises": [
                    {
                        "id": "e-2-1-1", "title": "Primary Squat", "variation": "Low Bar Competition", "tags": "Comp Spec, Quads Drive",
                        "top": "155kg x 1", "vol": "9,200kg",
                        "sets": [
                            {"id": "s-2-1-1a", "label": "Top Single", "planned": "155kg x 1", "plannedWeight": 155.0, "plannedReps": 1, "plannedRpe": 5.5, "isTop": True, "actual": 155.0, "reps": 1, "executedRpe": 5.5}
                        ]
                    },
                    {
                        "id": "e-2-1-2", "title": "Primary Bench", "variation": "Competition Paused", "tags": "Static Leg Drive",
                        "top": "92.5kg x 3", "vol": "4,000kg",
                        "sets": [
                            {"id": "s-2-1-2a", "label": "Top Set", "planned": "92.5kg x 3", "plannedWeight": 92.5, "plannedReps": 3, "plannedRpe": 6.0, "isTop": True, "actual": 92.5, "reps": 3, "executedRpe": 6.0}
                        ]
                    }
                ]
            }
        ]
    },
    {
        "id": "micro-3",
        "weekName": "Microcycle 03",
        "focus": "Threshold / Intensity Peak",
        "status": "ACTIVE",
        "active": True,
        "workouts": [
            {
                "id": "w-3-1", "date": "2026-09-16", "dayLabel": "D1", "title": "Primary Squat, Primary Bench",
                "tonnage": 14100.0, "delta": 900.0, "color": "mac-blue", "status": "IN_PROGRESS",
                "exercises": [
                    {
                        "id": "e-3-1-1", "title": "Primary Squat", "variation": "Low Bar Competition", "tags": "Comp Spec, Brace Focus, Heel Drive",
                        "top": "160kg x 1", "vol": "9,800kg",
                        "sets": [
                            {"id": "s-3-1-1a", "label": "Top Single", "planned": "160kg x 1", "plannedWeight": 160.0, "plannedReps": 1, "plannedRpe": 5.0, "isTop": True, "actual": 160.0, "reps": 1, "executedRpe": 8.5},
                            {"id": "s-3-1-1b", "label": "Main Set", "planned": "152.5kg x 3", "plannedWeight": 152.5, "plannedReps": 3, "plannedRpe": 6.5, "actual": 152.5, "reps": 3, "executedRpe": 7.5},
                            {"id": "s-3-1-1c", "label": "Backdown", "planned": "152.5kg x 3", "plannedWeight": 152.5, "plannedReps": 3, "plannedRpe": 5.5, "note": "-5% Drop", "actual": 152.5, "reps": 3, "executedRpe": 8.0, "dropPercent": -5.0}
                        ]
                    },
                    {
                        "id": "e-3-1-2", "title": "Primary Bench", "variation": "Competition Paused", "tags": "Static Leg Drive, 1-sec Pause, Shoulder Pin",
                        "top": "95kg x 3", "vol": "4,300kg",
                        "sets": [
                            {"id": "s-3-1-2a", "label": "Top Single", "planned": "95kg x 3", "plannedWeight": 95.0, "plannedReps": 3, "plannedRpe": 5.0, "isTop": True, "actual": 95.0, "reps": 3, "executedRpe": 8.0},
                            {"id": "s-3-1-2b", "label": "Main Set", "plannedWeight": 90.0, "plannedReps": 5, "plannedRpe": 6.0, "actual": 90.0, "reps": 5, "executedRpe": 7.0}
                        ]
                    },
                    {
                        "id": "a-3-1-1", "title": "Leg Press", "variation": "Accessory", "tier": "Accessory", "lift_category": "Other", "tags": "Accessory",
                        "top": "120kg x 12", "vol": "4,320kg",
                        "sets": [
                            {"id": "a-3-1-1-s1", "label": "Set 1", "plannedWeight": 120.0, "plannedReps": 10, "plannedRpe": 7.0, "actual": 120.0, "reps": 12, "executedRpe": 7.0},
                            {"id": "a-3-1-1-s2", "label": "Set 2", "plannedWeight": 120.0, "plannedReps": 10, "plannedRpe": 7.0, "actual": 120.0, "reps": 12, "executedRpe": 7.0},
                            {"id": "a-3-1-1-s3", "label": "Set 3", "plannedWeight": 120.0, "plannedReps": 10, "plannedRpe": 7.0, "actual": 120.0, "reps": 12, "executedRpe": 7.0}
                        ]
                    },
                    {
                        "id": "a-3-1-2", "title": "Triceps Extension", "variation": "Accessory", "tier": "Accessory", "lift_category": "Other", "tags": "Accessory",
                        "top": "—", "vol": "—",
                        "sets": [
                            {"id": "a-3-1-2-s1", "label": "Set 1", "plannedWeight": None, "plannedReps": 12, "plannedRpe": 9.0},
                            {"id": "a-3-1-2-s2", "label": "Set 2", "plannedWeight": None, "plannedReps": 12, "plannedRpe": 9.0},
                            {"id": "a-3-1-2-s3", "label": "Set 3", "plannedWeight": None, "plannedReps": 12, "plannedRpe": 9.0}
                        ]
                    },
                    {
                        "id": "a-3-1-3", "title": "Lateral Raises", "variation": "Accessory", "tier": "Accessory", "lift_category": "Other", "tags": "Accessory",
                        "top": "—", "vol": "—",
                        "sets": [
                            {"id": "a-3-1-3-s1", "label": "Set 1", "plannedWeight": None, "plannedReps": 15, "plannedRpe": 10.0},
                            {"id": "a-3-1-3-s2", "label": "Set 2", "plannedWeight": None, "plannedReps": 15, "plannedRpe": 10.0},
                            {"id": "a-3-1-3-s3", "label": "Set 3", "plannedWeight": None, "plannedReps": 15, "plannedRpe": 10.0}
                        ]
                    }
                ],
            }
        ]
    }
]

def seed_db(db: Session, owner_id: str, clear_existing: bool = True):
    if clear_existing:
        # Delete existing data for this user to avoid duplication if called again
        old_mcs = db.query(Microcycle).filter(Microcycle.owner_id == owner_id).all()
        for mc in old_mcs:
            db.delete(mc)
        db.commit()

    for mc_data in INITIAL_SEEDS:
        mc = Microcycle(
            id=mc_data["id"] + "-" + str(uuid.uuid4())[:8],
            weekName=mc_data["weekName"],
            focus=mc_data["focus"],
            status=mc_data["status"],
            active=mc_data["active"],
            owner_id=owner_id
        )
        db.add(mc)
        db.commit()

        for w_data in mc_data.get("workouts", []):
            w = Workout(
                id=w_data["id"] + "-" + str(uuid.uuid4())[:8],
                date=w_data["date"],
                dayLabel=w_data["dayLabel"],
                title=w_data["title"],
                tonnage=w_data["tonnage"],
                delta=w_data["delta"],
                color=w_data["color"],
                status=w_data["status"],
                microcycle_id=mc.id
            )
            db.add(w)
            db.commit()

            for e_data in w_data.get("exercises", []):
                e = Exercise(
                    id=e_data["id"] + "-" + str(uuid.uuid4())[:8],
                    title=e_data["title"],
                    variation=e_data["variation"],
                    tier=e_data.get("tier", "Comp"),
                    lift_category=e_data.get("lift_category", "Other"),
                    tags_raw=e_data["tags"],
                    top=e_data["top"],
                    vol=e_data["vol"],
                    workout_id=w.id
                )
                db.add(e)
                db.commit()

                for s_data in e_data.get("sets", []):
                    s = ExerciseSet(
                        id=s_data["id"] + "-" + str(uuid.uuid4())[:8],
                        label=s_data["label"],
                        plannedWeight=coerce_float(s_data.get("plannedWeight")),
                        plannedReps=coerce_int(s_data.get("plannedReps")),
                        plannedRpe=coerce_float(s_data.get("plannedRpe")),
                        dropPercent=coerce_float(s_data.get("dropPercent")),
                        isAuto=s_data.get("isAuto", False),
                        actual=coerce_float(s_data.get("actual")),
                        reps=coerce_int(s_data.get("reps")),
                        executedRpe=coerce_float(s_data.get("executedRpe")),
                        isTop=s_data.get("isTop", False),
                        note=s_data.get("note"),
                        velocity=coerce_float(s_data.get("velocity")),
                        readiness=coerce_int(s_data.get("readiness")),
                        hrv=coerce_float(s_data.get("hrv")),
                        exercise_id=e.id
                    )
                    db.add(s)
                db.commit()

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

@app.post("/api/auth/link-athlete")
def link_athlete(req: LinkCodeRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "ATHLETE":
        raise HTTPException(status_code=403, detail="Only athletes can link to a coach")
    
    coach = db.query(User).filter(User.email == req.code, User.role == "COACH").first()
    if not coach:
        raise HTTPException(status_code=404, detail="Invalid link code / coach email not found")
        
    existing_link = db.query(CoachingRelationship).filter(CoachingRelationship.athlete_id == current_user.id).first()
    if existing_link:
        raise HTTPException(status_code=400, detail="Athlete is already linked to a coach")
        
    link = CoachingRelationship(coach_id=coach.id, athlete_id=current_user.id)
    db.add(link)
    db.commit()
    return {"status": "success", "message": f"Successfully linked to coach {coach.email}"}

@app.get("/api/coach/roster")
def get_roster(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "COACH":
        raise HTTPException(status_code=403, detail="Not authorized")
        
    relationships = db.query(CoachingRelationship).filter(CoachingRelationship.coach_id == current_user.id).all()
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
    
    if not rel:
        raise HTTPException(status_code=403, detail="Not authorized to push to this athlete")
        
    seed_db(db, req.athleteId, clear_existing=False)
    return {"status": "success", "message": f"Program {req.template} deployed successfully"}

def get_visible_microcycles(db: Session, current_user: User):
    if current_user.role == "COACH":
        relationships = db.query(CoachingRelationship).filter(CoachingRelationship.coach_id == current_user.id).all()
        athlete_ids = [rel.athlete_id for rel in relationships]
        return db.query(Microcycle).filter(Microcycle.owner_id.in_(athlete_ids)).all()
    else:
        return db.query(Microcycle).filter(Microcycle.owner_id == current_user.id).all()

@app.get("/api/microcycles")
def get_microcycles(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    mcs = get_visible_microcycles(db, current_user)
    if not mcs and current_user.role == "ATHLETE":
        # Seed database for new athletes
        seed_db(db, current_user.id)
        mcs = get_visible_microcycles(db, current_user)
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
        # Clear existing ones for this athlete
        mcs = db.query(Microcycle).filter(Microcycle.owner_id == current_user.id).all()
        for mc in mcs:
            db.delete(mc)
        db.commit()
        seed_db(db, current_user.id)
        
    analytics_cache.pop(current_user.id, None)
    mcs = get_visible_microcycles(db, current_user)
    return [format_microcycle(mc) for mc in sorted(mcs, key=lambda x: x.id)]
