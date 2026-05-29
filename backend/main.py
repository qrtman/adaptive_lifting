from fastapi import FastAPI, Depends, HTTPException, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import os

from sqlalchemy.orm import Session
from .database import engine, get_db, init_db, Mesocycle, Microcycle, Workout, Exercise, ExerciseSet, Accessory, User, CoachingRelationship

from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from passlib.context import CryptContext
import jwt
from datetime import datetime, timedelta
import uuid

from .math_utils import calculate_e1rm_linear_decay, calculate_inol, calculate_dots, calculate_attempt_jumps, calculate_acwr_series

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

migrate_db()

app = FastAPI(title="Iron Box Terminal Backend", version="1.0.0")

from .sse_broadcaster import router as sse_router
from .integrations import router as integrations_router
app.include_router(sse_router)
app.include_router(integrations_router)

@app.on_event("startup")
def on_startup():
    from .integrations import start_background_worker
    start_background_worker()


# CORS setup for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Permits standard local dev servers to connect
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

analytics_cache = {}

# --- Security Setup ---
SECRET_KEY = "iron_box_secret_key"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 # 1 week

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
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

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
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception
        
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception
    return user

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
        secure=False  # Set to True in production
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
        secure=False
    )
    
    return {"access_token": access_token, "token_type": "bearer", "user": {"id": user.id, "email": user.email, "role": user.role}}

@app.post("/api/auth/logout")
def logout(response: Response, request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get("session_id")
    if token:
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
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
    weight: str
    reps: str
    rpe: str
    note: Optional[str] = None
    velocity: Optional[str] = None
    readiness: Optional[str] = None
    hrv: Optional[str] = None

class LogAccessoryRequest(BaseModel):
    workoutId: str
    accessoryId: str
    weight: str
    reps: str
    rpe: str
    status: str

class PushProgramRequest(BaseModel):
    athleteId: str
    template: str

# --- Powerlifting Math Helpers ---

def calculate_e1rm(weight: float, reps: int, rpe: float) -> float:
    if weight <= 0 or reps <= 0:
        return 0.0
    rpe_val = rpe if rpe > 0 else 10.0
    effective_reps = reps + (10 - rpe_val)
    if effective_reps >= 37:
        return weight
    e1rm = weight / (1.0278 - (0.0278 * effective_reps))
    return round(e1rm, 1)

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
            try:
                wt = float(s.actual or s.plannedWeight or "0")
                rp = int(s.reps or s.plannedReps or "0")
                rp_val = float(s.executedRpe or s.plannedRpe or "0")
            except ValueError:
                wt, rp, rp_val = 0.0, 0, 0.0

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

    for acc in workout.accessories:
        if acc.status == "Done":
            try:
                wt = float(acc.weight or "0")
                rp = int(acc.reps or "0")
                total_tonnage += wt * rp
            except ValueError:
                pass

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
        for e in sorted(w.exercises, key=lambda x: x.id):
            sets_list = []
            for s in sorted(e.sets, key=lambda x: x.id):
                set_dict = {
                    "id": s.id,
                    "label": s.label,
                    "planned": s.planned,
                    "plannedWeight": s.plannedWeight,
                    "plannedReps": s.plannedReps,
                    "plannedRpe": s.plannedRpe,
                    "isAuto": s.isAuto,
                    "isTop": s.isTop,
                }
                if s.dropPercent is not None:
                    set_dict["dropPercent"] = s.dropPercent
                if s.actual is not None:
                    set_dict["actual"] = s.actual
                if s.reps is not None:
                    set_dict["reps"] = s.reps
                if s.executedRpe is not None:
                    set_dict["executedRpe"] = s.executedRpe
                if s.note is not None:
                    set_dict["note"] = s.note
                if s.velocity is not None:
                    set_dict["velocity"] = str(s.velocity)
                if s.readiness is not None:
                    set_dict["readiness"] = str(s.readiness)
                if s.hrv is not None:
                    set_dict["hrv"] = str(s.hrv)
                sets_list.append(set_dict)

            exercises_list.append({
                "id": e.id,
                "title": e.title,
                "variation": e.variation,
                "tags": e.tags,
                "top": e.top,
                "vol": e.vol,
                "sets": sets_list
            })

        acc_list = []
        for a in sorted(w.accessories, key=lambda x: x.id):
            acc_list.append({
                "id": a.id,
                "name": a.name,
                "prescribedSets": a.prescribedSets,
                "targetReps": a.targetReps,
                "targetRpe": a.targetRpe,
                "weight": a.weight,
                "reps": a.reps,
                "executedRpe": a.executedRpe,
                "status": a.status
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
            "accessories": acc_list
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
        "status": "Verified",
        "active": False,
        "workouts": [
            {
                "id": "w-1-1", "date": "2026-09-02", "dayLabel": "D1", "title": "Primary Squat, Primary Bench",
                "tonnage": 12400.0, "delta": 0.0, "color": "mac-green", "status": "Completed",
                "exercises": [
                    {
                        "id": "e-1-1-1", "title": "Primary Squat", "variation": "Low Bar Competition", "tags": "Comp Spec, Brace Focus",
                        "top": "150kg x 1", "vol": "8,600kg",
                        "sets": [
                            {"id": "s-1-1-1a", "label": "Top Single", "planned": "150kg x 1", "plannedWeight": "150", "plannedReps": "1", "plannedRpe": "5", "isTop": True, "actual": "150", "reps": "1", "executedRpe": "5"},
                            {"id": "s-1-1-1b", "label": "Main Set", "planned": "137.5kg x 4", "plannedWeight": "137.5", "plannedReps": "4", "plannedRpe": "6", "actual": "137.5", "reps": "4", "executedRpe": "6"},
                            {"id": "s-1-1-1c", "label": "Backdown", "planned": "127.5kg x 4", "plannedWeight": "127.5", "plannedReps": "4", "plannedRpe": "5", "note": "-5% Drop", "actual": "127.5", "reps": "4", "executedRpe": "5", "dropPercent": -5.0}
                        ]
                    },
                    {
                        "id": "e-1-1-2", "title": "Primary Bench", "variation": "Competition Paused", "tags": "Static Leg Drive, 1-sec Pause",
                        "top": "90kg x 3", "vol": "3,800kg",
                        "sets": [
                            {"id": "s-1-1-2a", "label": "Top Single", "planned": "90kg x 3", "plannedWeight": "90", "plannedReps": "3", "plannedRpe": "6", "isTop": True, "actual": "90", "reps": "3", "executedRpe": "6"}
                        ]
                    }
                ],
                "accessories": [
                    {"id": "a-1-1-1", "name": "Leg Press", "prescribedSets": "3", "targetReps": "10-12", "targetRpe": "7", "weight": "120", "reps": "12", "executedRpe": "7", "status": "Done"}
                ]
            },
            {
                "id": "w-1-2", "date": "2026-09-04", "dayLabel": "D2", "title": "Secondary Deadlift, Secondary Bench",
                "tonnage": 8900.0, "delta": 0.0, "color": "mac-green", "status": "Completed",
                "exercises": [
                    {
                        "id": "e-1-2-1", "title": "Secondary Deadlift", "variation": "Deficit Deadlift", "tags": "Patience off Floor",
                        "top": "180kg x 3", "vol": "4,700kg",
                        "sets": [
                            {"id": "s-1-2-1a", "label": "Top Set", "planned": "180kg x 3", "plannedWeight": "180", "plannedReps": "3", "plannedRpe": "6", "isTop": True, "actual": "180", "reps": "3", "executedRpe": "6"}
                        ]
                    },
                    {
                        "id": "e-1-2-2", "title": "Secondary Bench", "variation": "Spoto Press", "tags": "Hover Focus, Chest Activation",
                        "top": "85kg x 5", "vol": "4,200kg",
                        "sets": [
                            {"id": "s-1-2-2a", "label": "Top Set", "planned": "85kg x 5", "plannedWeight": "85", "plannedReps": "5", "plannedRpe": "7", "isTop": True, "actual": "85", "reps": "5", "executedRpe": "7"}
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
        "status": "Verified",
        "active": False,
        "workouts": [
            {
                "id": "w-2-1", "date": "2026-09-09", "dayLabel": "D1", "title": "Primary Squat, Primary Bench",
                "tonnage": 13200.0, "delta": 800.0, "color": "mac-green", "status": "Completed",
                "exercises": [
                    {
                        "id": "e-2-1-1", "title": "Primary Squat", "variation": "Low Bar Competition", "tags": "Comp Spec, Quads Drive",
                        "top": "155kg x 1", "vol": "9,200kg",
                        "sets": [
                            {"id": "s-2-1-1a", "label": "Top Single", "planned": "155kg x 1", "plannedWeight": "155", "plannedReps": "1", "plannedRpe": "5.5", "isTop": True, "actual": "155", "reps": "1", "executedRpe": "5.5"}
                        ]
                    },
                    {
                        "id": "e-2-1-2", "title": "Primary Bench", "variation": "Competition Paused", "tags": "Static Leg Drive",
                        "top": "92.5kg x 3", "vol": "4,000kg",
                        "sets": [
                            {"id": "s-2-1-2a", "label": "Top Set", "planned": "92.5kg x 3", "plannedWeight": "92.5", "plannedReps": "3", "plannedRpe": "6", "isTop": True, "actual": "92.5", "reps": "3", "executedRpe": "6"}
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
        "status": "In Progress",
        "active": True,
        "workouts": [
            {
                "id": "w-3-1", "date": "2026-09-16", "dayLabel": "D1", "title": "Primary Squat, Primary Bench",
                "tonnage": 14100.0, "delta": 900.0, "color": "mac-blue", "status": "Today",
                "exercises": [
                    {
                        "id": "e-3-1-1", "title": "Primary Squat", "variation": "Low Bar Competition", "tags": "Comp Spec, Brace Focus, Heel Drive",
                        "top": "160kg x 1", "vol": "9,800kg",
                        "sets": [
                            {"id": "s-3-1-1a", "label": "Top Single", "planned": "160kg x 1", "plannedWeight": "160", "plannedReps": "1", "plannedRpe": "5", "isTop": True, "actual": "160", "reps": "1", "executedRpe": "8.5"},
                            {"id": "s-3-1-1b", "label": "Main Set", "planned": "152.5kg x 3", "plannedWeight": "152.5", "plannedReps": "3", "plannedRpe": "6.5", "actual": "152.5", "reps": "3", "executedRpe": "7.5"},
                            {"id": "s-3-1-1c", "label": "Backdown", "planned": "152.5kg x 3", "plannedWeight": "152.5", "plannedReps": "3", "plannedRpe": "5.5", "note": "-5% Drop", "actual": "152.5", "reps": "3", "executedRpe": "8", "dropPercent": -5.0}
                        ]
                    },
                    {
                        "id": "e-3-1-2", "title": "Primary Bench", "variation": "Competition Paused", "tags": "Static Leg Drive, 1-sec Pause, Shoulder Pin",
                        "top": "95kg x 3", "vol": "4,300kg",
                        "sets": [
                            {"id": "s-3-1-2a", "label": "Top Single", "planned": "95kg x 3", "plannedWeight": "95", "plannedReps": "3", "plannedRpe": "5", "isTop": True, "actual": "95", "reps": "3", "executedRpe": "8"},
                            {"id": "s-3-1-2b", "label": "Main Set", "planned": "90kg x 5", "plannedWeight": "90", "plannedReps": "5", "plannedRpe": "6", "actual": "90", "reps": "5", "executedRpe": "7"}
                        ]
                    }
                ],
                "accessories": [
                    {"id": "a-3-1-1", "name": "Leg Press", "prescribedSets": "3", "targetReps": "10-12", "targetRpe": "7", "weight": "120", "reps": "12", "executedRpe": "7", "status": "Done"},
                    {"id": "a-3-1-2", "name": "Triceps Extension", "prescribedSets": "3", "targetReps": "12", "targetRpe": "9", "weight": "", "reps": "", "executedRpe": "", "status": "Pending"},
                    {"id": "a-3-1-3", "name": "Lateral Raises", "prescribedSets": "3", "targetReps": "15", "targetRpe": "10", "weight": "", "reps": "", "executedRpe": "", "status": "Pending"}
                ]
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
                        planned=s_data["planned"],
                        plannedWeight=s_data["plannedWeight"],
                        plannedReps=s_data["plannedReps"],
                        plannedRpe=s_data["plannedRpe"],
                        dropPercent=s_data.get("dropPercent"),
                        isAuto=s_data.get("isAuto", False),
                        actual=s_data.get("actual"),
                        reps=s_data.get("reps"),
                        executedRpe=s_data.get("executedRpe"),
                        isTop=s_data.get("isTop", False),
                        note=s_data.get("note"),
                        velocity=s_data.get("velocity"),
                        readiness=s_data.get("readiness"),
                        hrv=s_data.get("hrv"),
                        exercise_id=e.id
                    )
                    db.add(s)
                db.commit()

            for a_data in w_data.get("accessories", []):
                a = Accessory(
                    id=a_data["id"] + "-" + str(uuid.uuid4())[:8],
                    name=a_data["name"],
                    prescribedSets=a_data["prescribedSets"],
                    targetReps=a_data["targetReps"],
                    targetRpe=a_data["targetRpe"],
                    weight=a_data["weight"],
                    reps=a_data["reps"],
                    executedRpe=a_data["executedRpe"],
                    status=a_data["status"],
                    workout_id=w.id
                )
                db.add(a)
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
        secure=False
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
        try: s.velocity = float(req.velocity)
        except ValueError: s.velocity = None
    if req.readiness is not None:
        try: s.readiness = int(req.readiness)
        except ValueError: s.readiness = None
    if req.hrv is not None:
        try: s.hrv = float(req.hrv)
        except ValueError: s.hrv = None

    db.commit()
    recalculate_metrics(db, req.workoutId, db.query(Workout).filter(Workout.id == req.workoutId).first().dayLabel)
    
    analytics_cache.pop(current_user.id, None)
    mcs = get_visible_microcycles(db, current_user)
    return [format_microcycle(mc) for mc in sorted(mcs, key=lambda x: x.id)]

@app.post("/api/accessories/log")
def log_accessory(req: LogAccessoryRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    a = db.query(Accessory).filter(Accessory.id == req.accessoryId).first()
    if not a:
        raise HTTPException(status_code=404, detail="Accessory not found")

    a.weight = req.weight
    a.reps = req.reps
    a.executedRpe = req.rpe
    a.status = req.status
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
                try:
                    wt = float(s.actual or "0")
                    rp = int(s.reps or "0")
                    rpe = float(s.executedRpe or "0")
                except ValueError:
                    continue
                    
                if wt > 0.0 and rp > 0:
                    if e.tier == "Comp": comp_nl += rp
                    elif e.tier == "Variation": var_nl += rp
                    elif e.tier == "Accessory": acc_nl += rp
                    
                    if e.tier != "Accessory":
                        e1rm = calculate_e1rm_linear_decay(wt, rp, rpe)
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
