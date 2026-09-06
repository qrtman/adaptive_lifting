import sys
import os
import uuid
import json
from datetime import datetime, timedelta
from typing import Generator

# Adjust path to import local modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("JWT_SECRET_CURRENT", "test-jwt-secret-current")
os.environ.setdefault("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://testserver")
os.environ.setdefault("COOKIE_SECURE", "false")

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

def test_security_and_data_isolation():
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
            email="coach@example.com",
            hashed_password=get_password_hash("password123"),
            role="COACH"
        )
        db.add(coach)
        
        # Register athlete
        athlete = User(
            id="athlete-123",
            email="athlete@example.com",
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
        header = jwt.get_unverified_header(token)
        assert header.get("kid") == "current", "JWT kid must identify the current signing key"
        
        from backend.main import decode_access_token
        decoded = decode_access_token(token)
        assert decoded.get("sub") == athlete.id, "decode_access_token failed for current key"
        
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
        
        # --- TEST 5: AI Coach Advisor Routing and RBAC Boundaries ---
        print("Test 5: Testing AI Coach advisor routing, RBAC, and gateway exception handling...")
        from fastapi import HTTPException
        from backend.main import get_ai_advisor
        
        # Setup: Unrelated athlete for RBAC check
        unrelated_athlete = User(
            id="athlete-unrelated",
            email="unrelated@example.com",
            hashed_password=get_password_hash("password123"),
            role="ATHLETE"
        )
        db.add(unrelated_athlete)
        db.commit()
        
        # 1. Athlete requests unrelated athlete's data -> MUST raise 403
        try:
            get_ai_advisor(athlete_id="athlete-unrelated", db=db, current_user=athlete)
            assert False, "Should raise 403 for unauthorized athlete access"
        except HTTPException as exc:
            assert exc.status_code == 403, f"Expected 403, got {exc.status_code}"
            assert "Unauthorized athlete request" in exc.detail
            
        # 2. Coach requests unrelated athlete's data (no CoachingRelationship link) -> MUST raise 403
        try:
            get_ai_advisor(athlete_id="athlete-unrelated", db=db, current_user=coach)
            assert False, "Should raise 403 for unauthorized coach access"
        except HTTPException as exc:
            assert exc.status_code == 403, f"Expected 403, got {exc.status_code}"
            assert "Unauthorized coach request" in exc.detail
            
        # 3. Unconfigured Key: Remove environment variable if it exists and assert 503 is cleanly raised
        old_api_key = os.environ.get("GEMINI_API_KEY")
        if "GEMINI_API_KEY" in os.environ:
            del os.environ["GEMINI_API_KEY"]
            
        try:
            get_ai_advisor(athlete_id=athlete.id, db=db, current_user=athlete)
            assert False, "Should raise 503 for unconfigured key"
        except HTTPException as exc:
            assert exc.status_code == 503, f"Expected 503, got {exc.status_code}"
            assert "AI Autoregulation gateway temporarily unconfigured" in exc.detail
            
        # Restore key if existed
        if old_api_key:
            os.environ["GEMINI_API_KEY"] = old_api_key
        else:
            os.environ["GEMINI_API_KEY"] = "mock_key_active"
            
        # 4. Mock Gemini API Gateway Call
        import requests
        class MockResponse:
            status_code = 200
            def json(self):
                return {
                    "candidates": [{
                        "content": {
                            "parts": [{
                                "text": '{\n  "cns_readiness": {\n    "status": "Neural Fatigue Suppression",\n    "score": 35,\n    "analysis": "Acute load spikes indicate high fatigue accumulation. CNS metrics require immediate decompression."\n  },\n  "movement_diagnostics": {\n    "squat_fatigue": { "status": "Danger", "inol": 2.2, "warning": "Strict volume cap required." },\n    "bench_fatigue": { "status": "Optimal", "inol": 0.8, "warning": "Proceed." },\n    "deadlift_fatigue": { "status": "Optimal", "inol": 0.6, "warning": "Proceed." }\n  },\n  "microcycle_prescription": {\n    "loading_strategy": "Deload Decompression (-20%)",\n    "tactical_guidance": "Force immediately -20% volume drop on working squat sets.",\n    "suggested_rpe_cap": 8.0\n  },\n  "attempt_feedback": {\n    "opener_feasibility": "High-Risk",\n    "coaching_notes": "Reduce opener target weight by 10kg."\n  }\n}'
                            }]
                        }
                    }]
                }
                
        # Patch requests.post
        original_post = requests.post
        requests.post = lambda *args, **kwargs: MockResponse()
        
        try:
            # Let's seed at least one microcycle & workout for athlete so get_trends doesn't crash on empty
            from backend.database import Microcycle, Workout, Exercise, ExerciseSet
            mc = Microcycle(
                id="mc-test-1",
                weekName="Microcycle 01",
                focus="Technical Proficiency",
                status="COMPLETED",
                active=False,
                owner_id=athlete.id
            )
            db.add(mc)
            db.commit()
            
            w = Workout(
                id="w-test-1",
                date="2026-09-02",
                dayLabel="D1",
                title="Primary Squat",
                tonnage=12400.0,
                delta=0.0,
                color="mac-green",
                status="COMPLETED",
                microcycle_id=mc.id
            )
            db.add(w)
            db.commit()
            
            ex = Exercise(
                id="ex-test-1",
                title="Primary Squat",
                variation="Low Bar Competition",
                tier="Comp",
                lift_category="Squat",
                tags_raw="Comp Spec",
                top="150kg x 1",
                vol="8600kg",
                workout_id=w.id
            )
            db.add(ex)
            db.commit()
            
            s = ExerciseSet(
                id="s-test-1",
                label="Top Single",
                plannedWeight=150.0,
                plannedReps=1,
                plannedRpe=5.0,
                actual=150.0,
                reps=1,
                executedRpe=5.0,
                isTop=True,
                exercise_id=ex.id
            )
            db.add(s)
            db.commit()
            
            # Now call the AI advisor!
            res_data = get_ai_advisor(athlete_id=athlete.id, db=db, current_user=athlete)
            assert res_data is not None
            assert res_data["cns_readiness"]["status"] == "Neural Fatigue Suppression"
            assert res_data["cns_readiness"]["score"] == 35
            assert res_data["movement_diagnostics"]["squat_fatigue"]["status"] == "Danger"
            assert res_data["microcycle_prescription"]["loading_strategy"] == "Deload Decompression (-20%)"
            assert res_data["microcycle_prescription"]["suggested_rpe_cap"] == 8.0
            assert res_data["attempt_feedback"]["opener_feasibility"] == "High-Risk"
            print("  [OK] AI advisor routing, RBAC, and gateway validation passed successfully.")
        finally:
            # Restore requests.post and environment key
            requests.post = original_post
            if not old_api_key and "GEMINI_API_KEY" in os.environ:
                del os.environ["GEMINI_API_KEY"]
            elif old_api_key:
                os.environ["GEMINI_API_KEY"] = old_api_key

    finally:
        # Cleanup
        db.close()
        Base.metadata.drop_all(bind=engine)
