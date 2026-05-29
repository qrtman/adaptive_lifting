from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

def test_login_sets_cookie():
    # First register a user
    register_response = client.post(
        "/api/auth/register",
        json={"email": "test@example.com", "password": "password123", "role": "COACH"}
    )
    assert register_response.status_code == 200
    assert "session_id" in register_response.cookies
    
    # Then login
    login_response = client.post(
        "/api/auth/login",
        data={"username": "test@example.com", "password": "password123"}
    )
    assert login_response.status_code == 200
    assert "session_id" in login_response.cookies
    cookie = login_response.cookies.get_dict()["session_id"]
    assert cookie is not None
