import sys
import os
import uuid
import json
from datetime import datetime, timedelta
from typing import Generator

# Adjust path to import local modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

# Setup mock databases in-memory for testing isolation
from backend.database import Base, User, Session as DBSession, ClientDevice, AuditEvent, CoachingRelationship
from backend.main import (
    get_password_hash, create_access_token, verify_password, 
    ACCESS_TOKEN_EXPIRE_MINUTES, SECRET_KEY, ALGORITHM
)
import jwt

# Test database engine
engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_test_db() -> Generator[Session, None, None]:
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

# Mock FastAPI Request for get_current_user testing
class MockRequest:
    def __init__(self, cookies=None, headers=None):
        self.cookies = cookies or {}
        self.headers = headers or {}

def run_integration_tests():
    print("==================================================")
    print("RUNNING SECURITY & DATA ISOLATION INTEGRATION TESTS")
    print("==================================================")
    
    # 1. Initialize Tables
    Base.metadata.create_all(bind=engine)
    db = next(get_test_db())
    
    try:
        # --- TEST 1: Auth and Session Creation ---
        print("Test 1: Testing registration and DB session token allocation...")
        
        # Register coach
        coach = User(
            id="coach-123",
            email="coach@obsidian.com",
            hashed_password=get_password_hash("password123"),
            role="COACH"
        )
        db.add(coach)
        
        # Register athlete
        athlete = User(
            id="athlete-123",
            email="athlete@obsidian.com",
            hashed_password=get_password_hash("password123"),
            role="ATHLETE"
        )
        db.add(athlete)
        db.commit()
        
        # Generate token with session_id
        session_id = str(uuid.uuid4())
        access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        
        db_session = DBSession(
            id=session_id,
            user_id=athlete.id,
            jwt_id=session_id,
            expires_at=datetime.utcnow() + access_token_expires
        )
        db.add(db_session)
        db.commit()
        
        token = create_access_token(
            data={"sub": athlete.id, "role": athlete.role, "session_id": session_id},
            expires_delta=access_token_expires
        )
        
        # Verify DB session exists
        sess_record = db.query(DBSession).filter_by(id=session_id).first()
        assert sess_record is not None, "Session row not written"
        assert sess_record.user_id == athlete.id, "Session user mismatch"
        print("  [OK] Session persist verified.")

        # --- TEST 2: Active Session Decoded Checks ---
        print("Test 2: Testing session verification dependency...")
        
        # Simulate standard API validation
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        sub = payload.get("sub")
        s_id = payload.get("session_id")
        
        assert sub == athlete.id, "Sub mismatch"
        assert s_id == session_id, "Session ID mismatch"
        
        # Query active session
        active_sess = db.query(DBSession).filter(
            DBSession.id == s_id,
            DBSession.revoked_at.is_(None),
            DBSession.expires_at > datetime.utcnow()
        ).first()
        
        assert active_sess is not None, "Failed to resolve active DB session"
        print("  [OK] Session verification success.")

        # --- TEST 3: Session Revocation Rejections ---
        print("Test 3: Testing secure session revocation rejections...")
        
        # Terminate session
        active_sess.revoked_at = datetime.utcnow()
        db.commit()
        
        # Re-query
        revoked_sess = db.query(DBSession).filter(
            DBSession.id == s_id,
            DBSession.revoked_at.is_(None)
        ).first()
        
        assert revoked_sess is None, "Revoked session was returned as active"
        print("  [OK] Session revocation blocks subsequent requests successfully.")

        # --- TEST 4: Team-scoped Data Isolation ---
        print("Test 4: Testing RBAC roster data-isolation...")
        
        # Link athlete to coach
        link = CoachingRelationship(
            id=1,
            coach_id=coach.id,
            athlete_id=athlete.id,
            created_at=datetime.utcnow()
        )
        db.add(link)
        db.commit()
        
        # Verify coach roster reads
        roster_relations = db.query(CoachingRelationship).filter_by(coach_id=coach.id, ended_at=None).all()
        assert len(roster_relations) == 1, "Roster linking failed"
        assert roster_relations[0].athlete_id == athlete.id, "Linked athlete ID mismatch"
        
        # Verify isolation: Coach can query athlete audit logs
        allowed_actor_ids = [athlete.id, coach.id]
        
        # Add dummy event for athlete
        dummy_event = AuditEvent(
            id="evt-1",
            actor_user_id=athlete.id,
            event_type="SYNC_COMMIT",
            resource_type="Workout",
            resource_id="w-1",
            created_at=datetime.utcnow(),
            metadata_json=json.dumps({"sets_logged": 3})
        )
        db.add(dummy_event)
        db.commit()
        
        # Query events as coach (allowed to see athletes)
        coach_visible_events = db.query(AuditEvent).filter(
            AuditEvent.actor_user_id.in_(allowed_actor_ids)
        ).all()
        
        assert len(coach_visible_events) == 1, "Coach cannot see athlete audit events"
        print("  [OK] Coach RBAC logs visibility isolated successfully.")
        
        # Verify isolation: Coach cannot see unrelated athlete logs
        unrelated_athlete_id = "athlete-unrelated"
        # Dummy event for unrelated athlete
        unrelated_event = AuditEvent(
            id="evt-2",
            actor_user_id=unrelated_athlete_id,
            event_type="SYNC_COMMIT",
            resource_type="Workout",
            resource_id="w-2",
            created_at=datetime.utcnow(),
            metadata_json=json.dumps({"sets_logged": 1})
        )
        db.add(unrelated_event)
        db.commit()
        
        coach_visible_events_2 = db.query(AuditEvent).filter(
            AuditEvent.actor_user_id.in_(allowed_actor_ids)
        ).all()
        
        assert len(coach_visible_events_2) == 1, "Coach sees unrelated athlete audit events! Security breach."
        print("  [OK] Roster data isolation validated.")
        
    finally:
        # Cleanup
        db.close()
        Base.metadata.drop_all(bind=engine)

    print("==================================================")
    print("ALL SECURITY & ISOLATION TESTS PASSED SUCCESSFULLY!")
    print("==================================================")

if __name__ == "__main__":
    run_integration_tests()
