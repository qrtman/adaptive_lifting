import os
from sqlalchemy import create_engine, Column, String, Integer, Float, Boolean, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

DB_PATH = os.path.join(os.path.dirname(__file__), "database.sqlite")
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{DB_PATH}")

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, nullable=False, default="ATHLETE") # 'COACH' or 'ATHLETE'
    subscription_status = Column(String, nullable=True, default="active")

class CoachingRelationship(Base):
    __tablename__ = "coaching_relationships"
    id = Column(Integer, primary_key=True, autoincrement=True)
    coach_id = Column(String, ForeignKey("users.id"), nullable=False)
    athlete_id = Column(String, ForeignKey("users.id"), nullable=False, unique=True)

class Mesocycle(Base):
    __tablename__ = "mesocycles"
    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    status = Column(String, nullable=False)
    color = Column(String, nullable=False)
    startDate = Column(String, nullable=False)
    endDate = Column(String, nullable=False)

class Microcycle(Base):
    __tablename__ = "microcycles"
    id = Column(String, primary_key=True, index=True)
    weekName = Column(String, nullable=False)
    focus = Column(String, nullable=False)
    status = Column(String, nullable=False)
    active = Column(Boolean, default=False)
    owner_id = Column(String, ForeignKey("users.id"), nullable=True)
    
    workouts = relationship("Workout", back_populates="microcycle", cascade="all, delete-orphan")

class Workout(Base):
    __tablename__ = "workouts"
    id = Column(String, primary_key=True, index=True)
    date = Column(String, nullable=False)
    dayLabel = Column(String, nullable=False)
    title = Column(String, nullable=False)
    tonnage = Column(Float, default=0.0)
    delta = Column(Float, default=0.0)
    color = Column(String, nullable=False)
    status = Column(String, nullable=False)
    athlete_bw = Column(Float, nullable=True)
    microcycle_id = Column(String, ForeignKey("microcycles.id"))

    microcycle = relationship("Microcycle", back_populates="workouts")
    exercises = relationship("Exercise", back_populates="workout", cascade="all, delete-orphan")
    accessories = relationship("Accessory", back_populates="workout", cascade="all, delete-orphan")

class Exercise(Base):
    __tablename__ = "exercises"
    id = Column(String, primary_key=True, index=True)
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

class ExerciseSet(Base):
    __tablename__ = "exercise_sets"
    id = Column(String, primary_key=True, index=True)
    label = Column(String, nullable=False)
    planned = Column(String, default="")
    plannedWeight = Column(String, default="")
    plannedReps = Column(String, default="")
    plannedRpe = Column(String, default="")
    dropPercent = Column(Float, nullable=True)
    isAuto = Column(Boolean, default=False)
    actual = Column(String, nullable=True)
    reps = Column(String, nullable=True)
    executedRpe = Column(String, nullable=True)
    isTop = Column(Boolean, default=False)
    note = Column(String, nullable=True)
    velocity = Column(Float, nullable=True)
    readiness = Column(Integer, nullable=True)
    hrv = Column(Float, nullable=True)
    exercise_id = Column(String, ForeignKey("exercises.id"))

    exercise = relationship("Exercise", back_populates="sets")

class Accessory(Base):
    __tablename__ = "accessories"
    id = Column(String, primary_key=True, index=True)
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

# Create tables
def init_db():
    Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
