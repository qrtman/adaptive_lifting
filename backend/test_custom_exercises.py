import uuid

from fastapi.testclient import TestClient

from backend.main import app


def _register(client, role="COACH"):
    email = f"user-{uuid.uuid4().hex[:10]}@example.com"
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": "password123", "role": role},
    )
    assert resp.status_code == 200
    return email, dict(resp.cookies)


def test_create_and_list_custom_exercise():
    client = TestClient(app)
    _, cookies = _register(client)

    created = client.post(
        "/api/exercises/custom",
        json={
            "name": "Board Press",
            "liftCategory": "Bench",
            "tier": "Variation",
            "tempoId": "paused",
            "gear": ["Beltless", "SlingShot"],
        },
        cookies=cookies,
    )
    assert created.status_code == 200
    body = created.json()
    assert body["name"] == "Board Press"
    assert body["liftCategory"] == "Bench"
    assert body["tier"] == "Variation"
    assert body["gear"] == ["Beltless", "SlingShot"]
    assert body["id"]

    listing = client.get("/api/exercises/custom", cookies=cookies)
    assert listing.status_code == 200
    names = [r["name"] for r in listing.json()]
    assert "Board Press" in names


def test_custom_exercises_are_owner_scoped():
    client = TestClient(app)
    _, owner_cookies = _register(client)
    _, other_cookies = _register(client)

    client.post(
        "/api/exercises/custom",
        json={"name": "Anderson Squat", "liftCategory": "Squat"},
        cookies=owner_cookies,
    ).raise_for_status()

    # The other user must not see the owner's custom movement.
    other_list = client.get("/api/exercises/custom", cookies=other_cookies)
    assert other_list.status_code == 200
    assert all(r["name"] != "Anderson Squat" for r in other_list.json())

    owner_list = client.get("/api/exercises/custom", cookies=owner_cookies)
    assert any(r["name"] == "Anderson Squat" for r in owner_list.json())


def test_create_is_idempotent_by_name():
    client = TestClient(app)
    _, cookies = _register(client)

    first = client.post(
        "/api/exercises/custom",
        json={"name": "Pin Press", "liftCategory": "Bench", "tier": "Variation"},
        cookies=cookies,
    ).json()
    second = client.post(
        "/api/exercises/custom",
        json={"name": "Pin Press", "liftCategory": "Bench", "tier": "Accessory"},
        cookies=cookies,
    ).json()

    assert first["id"] == second["id"]
    assert second["tier"] == "Accessory"  # upsert updated metadata

    listing = client.get("/api/exercises/custom", cookies=cookies).json()
    assert sum(1 for r in listing if r["name"] == "Pin Press") == 1


def test_delete_custom_exercise():
    client = TestClient(app)
    _, cookies = _register(client)

    created = client.post(
        "/api/exercises/custom",
        json={"name": "Spoto Deadlift", "liftCategory": "Deadlift"},
        cookies=cookies,
    ).json()

    deleted = client.delete(f"/api/exercises/custom/{created['id']}", cookies=cookies)
    assert deleted.status_code == 200

    listing = client.get("/api/exercises/custom", cookies=cookies).json()
    assert all(r["name"] != "Spoto Deadlift" for r in listing)


def test_custom_exercise_requires_auth():
    client = TestClient(app)
    assert client.get("/api/exercises/custom").status_code == 401
    assert client.post("/api/exercises/custom", json={"name": "X"}).status_code == 401


def test_blank_name_rejected():
    client = TestClient(app)
    _, cookies = _register(client)
    resp = client.post("/api/exercises/custom", json={"name": "   "}, cookies=cookies)
    assert resp.status_code == 400
