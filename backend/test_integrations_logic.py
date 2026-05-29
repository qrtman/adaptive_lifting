import sys
import os
import hmac
import hashlib
import urllib.parse
import json
from datetime import datetime, timedelta

# Adjust Python path to load local modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.integrations import (
    encrypt_data, decrypt_data, verify_telegram_init_data, 
    INTEGRATION_ENCRYPTION_KEY
)
from backend.database import Base, engine, SessionLocal, IntegrationOutbox

def run_tests():
    print("==================================================")
    print("RUNNING PHASE 9 INTEGRATIONS OFFLINE UNIT TESTS")
    print("==================================================")

    # 1. Test Encryption/Decryption Symmetry
    print("Test 1: Testing Credentials Encryption Symmetry...")
    test_token = "google_refresh_token_abc123_xyz789"
    encrypted = encrypt_data(test_token, INTEGRATION_ENCRYPTION_KEY)
    decrypted = decrypt_data(encrypted, INTEGRATION_ENCRYPTION_KEY)
    
    print(f"  - Original:  {test_token}")
    print(f"  - Encrypted: {encrypted[:40]}...")
    print(f"  - Decrypted: {decrypted}")
    
    assert test_token == decrypted, "Decryption error: tokens do not match"
    print("  ✓ Encryption parity verification success.")

    # 2. Test Telegram initData Cryptographic Signature Verification
    print("Test 2: Testing Telegram WebApp initData verification...")
    
    bot_token = "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
    
    # Construct a valid initData query string
    user_payload = {"id": 8888, "first_name": "Lifter", "username": "powerlifter"}
    params = {
        "auth_date": "1700000000",
        "query_id": "AAHdFtQxAAAAAN0G1DE",
        "user": json.dumps(user_payload)
    }
    
    # Sort and sign
    sorted_params = sorted(params.items())
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted_params)
    
    secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
    correct_hash = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    
    # Form raw initData string
    params["hash"] = correct_hash
    raw_init_data = urllib.parse.urlencode(params)
    
    print("  - Verifying authentic initData payload...")
    result_user = verify_telegram_init_data(raw_init_data, bot_token)
    print(f"  - Verified User Payload: {result_user}")
    assert result_user["id"] == 8888, "User ID parsed improperly"
    assert result_user["username"] == "powerlifter", "Username parsed improperly"
    print("  ✓ Authentic signature accepted.")

    # Test Tampered payload
    print("  - Verifying tampered initData payload is rejected...")
    tampered_params = params.copy()
    tampered_params["auth_date"] = "1700000005" # skew auth_date slightly to simulate tampering
    raw_tampered = urllib.parse.urlencode(tampered_params)
    
    try:
        verify_telegram_init_data(raw_tampered, bot_token)
        print("  ❌ Bug: Tampered payload was accepted.")
        sys.exit(1)
    except ValueError as e:
        print(f"  ✓ Successfully rejected tampered payload: {str(e)}")

    # 3. Test Database Outbox Model Integration
    print("Test 3: Testing Database Outbox integration...")
    # Create tables on our test session (SQLite WAL or in-memory)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    
    try:
        # Queue dummy job
        dummy_job = IntegrationOutbox(
            id="test-job-uuid-1234",
            provider="google-sheets",
            connection_id="mock-conn-id",
            payload_json=json.dumps({"mesocycle_id": "meso-1"}),
            status="queued"
        )
        db.add(dummy_job)
        db.commit()
        
        # Verify persistence
        fetched = db.query(IntegrationOutbox).filter_by(id="test-job-uuid-1234").first()
        assert fetched is not None, "Failed to retrieve outbox job"
        assert fetched.provider == "google-sheets", "Incorrect provider"
        assert fetched.status == "queued", "Incorrect status"
        
        # Cleanup
        db.delete(fetched)
        db.commit()
        print("  ✓ Database Outbox integration success.")
    finally:
        db.close()

    print("==================================================")
    print("ALL PHASE 9 UNIT TESTS PASSED SUCCESSFULLY!")
    print("==================================================")

if __name__ == "__main__":
    run_tests()
