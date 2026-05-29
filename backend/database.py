import os
from sqlalchemy import create_engine, Column, String, Integer, Float, Boolean, ForeignKey, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "database.sqlite")
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{DB_PATH}")

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class TimestampMixin:
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    deleted_at = Column(DateTime, nullable=True)

class User(Base, TimestampMixin):
    __tablename__ = "users"
    id = Column(String, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, nullable=False, default="ATHLETE") # 'COACH' or 'ATHLETE'
    subscription_status = Column(String, nullable=True, default="active")

class CoachingRelationship(Base, TimestampMixin):
    __tablename__ = "coaching_relationships"
    id = Column(Integer, primary_key=True, autoincrement=True)
    coach_id = Column(String, ForeignKey("users.id"), nullable=False)
    athlete_id = Column(String, ForeignKey("users.id"), nullable=False, unique=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    ended_at = Column(DateTime, nullable=True)

class Mesocycle(Base, TimestampMixin):
    __tablename__ = "mesocycles"
    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    status = Column(String, nullable=False) # DRAFT, ACTIVE, COMPLETED, ARCHIVED
    color = Column(String, nullable=False)
    startDate = Column(String, nullable=False)
    endDate = Column(String, nullable=False)
    owner_id = Column(String, ForeignKey("users.id"), nullable=True)

class Microcycle(Base, TimestampMixin):
    __tablename__ = "microcycles"
    id = Column(String, primary_key=True, index=True)
    weekName = Column(String, nullable=False)
    focus = Column(String, nullable=False)
    status = Column(String, nullable=False) # DRAFT, ACTIVE, COMPLETED, LOCKED
    active = Column(Boolean, default=False)
    owner_id = Column(String, ForeignKey("users.id"), nullable=True)
    mesocycle_id = Column(String, ForeignKey("mesocycles.id"), nullable=True)
    
    workouts = relationship("Workout", back_populates="microcycle", cascade="all, delete-orphan")

class Workout(Base, TimestampMixin):
    __tablename__ = "workouts"
    id = Column(String, primary_key=True, index=True)
    date = Column(String, nullable=False)
    dayLabel = Column(String, nullable=False)
    title = Column(String, nullable=False)
    tonnage = Column(Float, default=0.0)
    delta = Column(Float, default=0.0)
    color = Column(String, nullable=False)
    status = Column(String, nullable=False) # PLANNED, IN_PROGRESS, COMPLETED, MISSED
    athlete_bw = Column(Float, nullable=True)
    microcycle_id = Column(String, ForeignKey("microcycles.id"))

    microcycle = relationship("Microcycle", back_populates="workouts")
    exercises = relationship("Exercise", back_populates="workout", cascade="all, delete-orphan")
    accessories = relationship("Accessory", back_populates="workout", cascade="all, delete-orphan")

class Exercise(Base, TimestampMixin):
    __tablename__ = "exercises"
    id = Column(String, primary_key=True, index=True)
    lexo_rank = Column(String, nullable=False, default="a0")
    title = Column(String, nullable=False)
    variation = Column(String, nullable=False)
    tier = Column(String, default="Comp") # "Comp", "Variation", "Accessory"
    lift_category = Column(String, default="Squat") # "Squat", "Bench", "Deadlift", "Other"
    tags_raw = Column(String, default="")  # Comma-separated list of tags
    top = Column(String, default="—")
    vol = Column(String, default="—")
    workout_id = Column(String, ForeignKey("workouts.id"))

    workout = relationship("Workout", back_populates="exercises")
    sets = relationship("ExerciseSet", back_populates="exercise", cascade="all, delete-orphan")

    @property
    def tags(self):
        return [t.strip() for t in self.tags_raw.split(",") if t.strip()] if self.tags_raw else []

    @tags.setter
    def tags(self, val_list):
        self.tags_raw = ",".join(val_list) if val_list else ""

class ExerciseSet(Base, TimestampMixin):
    __tablename__ = "exercise_sets"
    id = Column(String, primary_key=True, index=True)
    lexo_rank = Column(String, nullable=False, default="a0")
    label = Column(String, nullable=False)
    plannedWeight = Column(Float, nullable=True)
    plannedReps = Column(Integer, nullable=True)
    plannedRpe = Column(Float, nullable=True)
    dropPercent = Column(Float, nullable=True)
    isAuto = Column(Boolean, default=False)
    actual = Column(Float, nullable=True)
    reps = Column(Integer, nullable=True)
    executedRpe = Column(Float, nullable=True)
    isTop = Column(Boolean, default=False)
    note = Column(String, nullable=True)
    velocity = Column(Float, nullable=True)
    readiness = Column(Integer, nullable=True)
    hrv = Column(Float, nullable=True)
    exercise_id = Column(String, ForeignKey("exercises.id"))

    exercise = relationship("Exercise", back_populates="sets")

class Accessory(Base, TimestampMixin):
    __tablename__ = "accessories"
    id = Column(String, primary_key=True, index=True)
    lexo_rank = Column(String, nullable=False, default="a0")
    name = Column(String, nullable=False)
    prescribedSets = Column(String, nullable=False)
    targetReps = Column(String, nullable=False)
    targetRpe = Column(String, nullable=False)
    weight = Column(String, default="")
    reps = Column(String, default="")
    executedRpe = Column(String, default="")
    status = Column(String, default="Pending")
    workout_id = Column(String, ForeignKey("workouts.id"))

    workout = relationship("Workout", back_populates="accessories")

# --- Offline, Auth, and Audit Support Models ---

class ClientDevice(Base):
    __tablename__ = "client_devices"
    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("users.id"))
    device_label = Column(String, nullable=True)
    last_seen_at = Column(DateTime, default=datetime.datetime.utcnow)
    revoked_at = Column(DateTime, nullable=True)

class Session(Base):
    __tablename__ = "sessions"
    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("users.id"))
    jwt_id = Column(String, unique=True, index=True)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)

class SyncMutation(Base):
    __tablename__ = "sync_mutations"
    mutation_id = Column(String, primary_key=True, index=True)
    client_device_id = Column(String, ForeignKey("client_devices.id"), nullable=False)
    entity_type = Column(String, nullable=False)
    entity_id = Column(String, nullable=False)
    field_path = Column(String, nullable=False)
    updated_at = Column(DateTime, nullable=False)
    applied_at = Column(DateTime, nullable=True)
    result = Column(String, nullable=True)

class WorkoutLock(Base):
    __tablename__ = "workout_locks"
    workout_id = Column(String, ForeignKey("workouts.id"), primary_key=True)
    holder_user_id = Column(String, ForeignKey("users.id"), nullable=False)
    mode = Column(String, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    version = Column(Integer, default=1)

class AuditEvent(Base):
    __tablename__ = "audit_events"
    id = Column(String, primary_key=True, index=True)
    actor_user_id = Column(String, ForeignKey("users.id"), nullable=True)
    event_type = Column(String, nullable=False)
    resource_type = Column(String, nullable=False)
    resource_id = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    metadata_json = Column(String, nullable=True)

class InviteCode(Base):
    __tablename__ = "invite_codes"
    id = Column(String, primary_key=True, index=True)
    coach_id = Column(String, ForeignKey("users.id"), nullable=False)
    code_hash = Column(String, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)

class DomainEvent(Base):
    __tablename__ = "domain_events"
    id = Column(String, primary_key=True, index=True)
    workout_id = Column(String, ForeignKey("workouts.id"), nullable=False)
    event_type = Column(String, nullable=False)
    payload_json = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class IntegrationConnection(Base, TimestampMixin):
    __tablename__ = "integration_connections"
    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    provider = Column(String, nullable=False)
    external_account_id = Column(String, nullable=True)
    status = Column(String, nullable=False)
    scopes = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    revoked_at = Column(DateTime, nullable=True)

class IntegrationCredential(Base):
    __tablename__ = "integration_credentials"
    connection_id = Column(String, ForeignKey("integration_connections.id"), primary_key=True)
    credential_type = Column(String, primary_key=True)
    encrypted_payload = Column(String, nullable=False)
    expires_at = Column(DateTime, nullable=True)
    rotated_at = Column(DateTime, nullable=True)

class WebhookEvent(Base):
    __tablename__ = "webhook_events"
    id = Column(String, primary_key=True, index=True)
    provider = Column(String, nullable=False)
    external_event_id = Column(String, nullable=False, unique=True)
    received_at = Column(DateTime, default=datetime.datetime.utcnow)
    processed_at = Column(DateTime, nullable=True)
    status = Column(String, nullable=False)

class IntegrationOutbox(Base):
    __tablename__ = "integration_outbox"
    id = Column(String, primary_key=True, index=True)
    provider = Column(String, nullable=False)
    connection_id = Column(String, ForeignKey("integration_connections.id"), nullable=False)
    payload_json = Column(String, nullable=False)
    status = Column(String, nullable=False)
    retry_after = Column(DateTime, nullable=True)
    attempt_count = Column(Integer, default=0)

class SheetPublication(Base, TimestampMixin):
    __tablename__ = "sheet_publications"
    id = Column(String, primary_key=True, index=True)
    coach_id = Column(String, ForeignKey("users.id"), nullable=False)
    spreadsheet_id = Column(String, nullable=False)
    worksheet_name = Column(String, nullable=False)
    export_profile = Column(String, nullable=False)
    last_published_at = Column(DateTime, nullable=True)
    status = Column(String, nullable=False)

# Create tables
def init_db():
    Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
