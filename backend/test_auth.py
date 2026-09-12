import uuid

from fastapi.testclient import TestClient

from backend.main import app


def test_register_and_login_set_session_cookie():
    client = TestClient(app)
    email = f"coach-{uuid.uuid4().hex[:10]}@example.com"
    register_response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "password123", "role": "COACH"},
    )
    assert register_response.status_code == 200
    assert "session_id" in register_response.cookies

    login_response = client.post(
        "/api/auth/login",
        data={"username": email, "password": "password123"},
    )
    assert login_response.status_code == 200
    assert "session_id" in login_response.cookies
    assert login_response.cookies.get("session_id")


def _workout_ids(tree):
    return [w["id"] for mc in tree for w in mc.get("workouts", [])]


def test_coach_code_link_unlink_keeps_empty_plan():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    coach_email = f"coach-{suffix}@example.com"
    outsider_email = f"outsider-{suffix}@example.com"
    athlete1_email = f"athlete1-{suffix}@example.com"
    athlete2_email = f"athlete2-{suffix}@example.com"

    coach = client.post(
        "/api/auth/register",
        json={"email": coach_email, "password": "password123", "role": "COACH"},
    )
    assert coach.status_code == 200
    coach_cookies = dict(coach.cookies)

    outsider = client.post(
        "/api/auth/register",
        json={"email": outsider_email, "password": "password123", "role": "COACH"},
    )
    assert outsider.status_code == 200
    outsider_cookies = dict(outsider.cookies)

    athlete1 = client.post(
        "/api/auth/register",
        json={"email": athlete1_email, "password": "password123", "role": "ATHLETE"},
    )
    assert athlete1.status_code == 200
    athlete1_cookies = dict(athlete1.cookies)

    athlete2 = client.post(
        "/api/auth/register",
        json={"email": athlete2_email, "password": "password123", "role": "ATHLETE"},
    )
    assert athlete2.status_code == 200
    athlete2_cookies = dict(athlete2.cookies)

    code_resp = client.post("/api/auth/coach-code", cookies=coach_cookies)
    assert code_resp.status_code == 200
    coach_code = code_resp.json()["code"]
    assert coach_code

    # Email is no longer a valid link code
    bad = client.post(
        "/api/auth/link",
        json={"code": coach_email},
        cookies=athlete1_cookies,
    )
    assert bad.status_code == 404

    link = client.post(
        "/api/auth/link",
        json={"code": coach_code},
        cookies=athlete1_cookies,
    )
    assert link.status_code == 200

    athlete1_mcs = client.get("/api/microcycles", cookies=athlete1_cookies)
    assert athlete1_mcs.status_code == 200
    assert athlete1_mcs.json() == []

    athlete2_mcs = client.get("/api/microcycles", cookies=athlete2_cookies)
    assert athlete2_mcs.status_code == 200
    assert athlete2_mcs.json() == []

    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-11", "title": "Squat day", "blockLabel": "Block2", "weekLabel": "Week3"},
        cookies=athlete1_cookies,
    )
    assert created.status_code == 200
    session = created.json()
    assert session["blockLabel"] == "Block2"
    assert session["weekLabel"] == "Week3"
    session_id = session["id"]

    roster = client.get("/api/coach/roster", cookies=coach_cookies)
    assert roster.status_code == 200
    roster_data = roster.json()
    emails = [row["email"] for row in roster_data]
    assert athlete1_email in emails
    assert athlete2_email not in emails

    athlete_id = next(row["id"] for row in roster_data if row["email"] == athlete1_email)
    coach_mcs = client.get(f"/api/microcycles?athlete_id={athlete_id}", cookies=coach_cookies)
    assert coach_mcs.status_code == 200
    assert session_id in _workout_ids(coach_mcs.json())

    outsider_mcs = client.get(f"/api/microcycles?athlete_id={athlete_id}", cookies=outsider_cookies)
    assert outsider_mcs.status_code == 403
    outsider_write = client.patch(
        f"/api/sessions/{session_id}",
        json={"title": "Hijack"},
        cookies=outsider_cookies,
    )
    assert outsider_write.status_code == 403

    stranger_mcs = client.get(f"/api/microcycles?athlete_id={athlete_id}", cookies=athlete2_cookies)
    assert stranger_mcs.status_code == 403
    stranger_own = client.get("/api/microcycles", cookies=athlete2_cookies)
    assert stranger_own.status_code == 200
    assert session_id not in _workout_ids(stranger_own.json())

    unlink = client.delete("/api/auth/link", cookies=athlete1_cookies)
    assert unlink.status_code == 200

    roster_after = client.get("/api/coach/roster", cookies=coach_cookies)
    assert athlete1_email not in [row["email"] for row in roster_after.json()]

    lost = client.get(f"/api/microcycles?athlete_id={athlete_id}", cookies=coach_cookies)
    assert lost.status_code == 403
    lost_write = client.patch(
        f"/api/sessions/{session_id}",
        json={"title": "After unlink"},
        cookies=coach_cookies,
    )
    assert lost_write.status_code == 403

    # Plan stays in athlete space after unlink
    athlete1_after = client.get("/api/microcycles", cookies=athlete1_cookies)
    assert athlete1_after.status_code == 200
    assert session_id in _workout_ids(athlete1_after.json())


def test_coach_create_session_requires_linked_athlete():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    coach = client.post(
        "/api/auth/register",
        json={"email": f"coach-{suffix}@example.com", "password": "password123", "role": "COACH"},
    )
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    coach_cookies = dict(coach.cookies)
    athlete_cookies = dict(athlete.cookies)

    missing = client.post(
        "/api/sessions",
        json={"date": "2026-09-12", "title": "Squat"},
        cookies=coach_cookies,
    )
    assert missing.status_code == 400
    assert missing.json()["detail"] == "athlete_id is required for coaches"

    bad_date = client.post(
        "/api/sessions",
        json={"date": "12-09-2026", "title": "Squat"},
        cookies=athlete_cookies,
    )
    assert bad_date.status_code == 400
    assert bad_date.json()["detail"] == "date must be YYYY-MM-DD"

    unknown = client.post(
        "/api/sessions",
        json={"date": "2026-09-12", "title": "Squat", "athleteId": "not-linked"},
        cookies=coach_cookies,
    )
    assert unknown.status_code == 403

    login = client.post(
        "/api/auth/login",
        data={"username": f"coach-{suffix}@example.com", "password": "password123"},
    )
    coach_id = login.json()["user"]["id"]
    own = client.post(
        "/api/sessions",
        json={"date": "2026-09-12", "title": "Squat", "athleteId": coach_id},
        cookies=coach_cookies,
    )
    assert own.status_code == 403

    code = client.post("/api/auth/coach-code", cookies=coach_cookies).json()["code"]
    linked = client.post("/api/auth/link-athlete", json={"code": code}, cookies=athlete_cookies)
    assert linked.status_code == 200
    roster = client.get("/api/coach/roster", cookies=coach_cookies)
    athlete_id = next(row["id"] for row in roster.json() if row["email"] == f"athlete-{suffix}@example.com")

    created = client.post(
        "/api/sessions",
        json={
            "date": "2026-09-12",
            "title": "Squat day",
            "blockLabel": "  Hypertrophy  ",
            "weekLabel": "Week1",
            "athleteId": athlete_id,
        },
        cookies=coach_cookies,
    )
    assert created.status_code == 200
    body = created.json()
    assert body["date"] == "2026-09-12"
    assert body["blockLabel"] == "Hypertrophy"
    assert body["weekLabel"] == "Week1"
    assert body["ownerId"] == athlete_id

    tree = client.get(f"/api/microcycles?athlete_id={athlete_id}", cookies=coach_cookies)
    workouts = [w for mc in tree.json() for w in mc["workouts"]]
    assert any(w["id"] == body["id"] for w in workouts)

    athlete_tree = client.get("/api/microcycles", cookies=athlete_cookies)
    assert athlete_tree.status_code == 200
    assert any(w["id"] == body["id"] for mc in athlete_tree.json() for w in mc["workouts"])

    athlete_own = client.get(f"/api/microcycles?athlete_id={athlete_id}", cookies=athlete_cookies)
    assert athlete_own.status_code == 200
    assert any(w["id"] == body["id"] for mc in athlete_own.json() for w in mc["workouts"])


def test_session_labels_anytime_and_reset_stays_empty():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)

    empty = client.get("/api/microcycles", cookies=cookies)
    assert empty.status_code == 200
    assert empty.json() == []

    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-12", "title": "Bench"},
        cookies=cookies,
    )
    assert created.status_code == 200
    sid = created.json()["id"]
    assert created.json()["blockLabel"] is None

    labeled = client.patch(
        f"/api/sessions/{sid}",
        json={"title": "Heavy Bench", "blockLabel": "Block1", "weekLabel": "Week1"},
        cookies=cookies,
    )
    assert labeled.status_code == 200
    assert labeled.json()["title"] == "Heavy Bench"
    assert labeled.json()["blockLabel"] == "Block1"
    assert labeled.json()["weekLabel"] == "Week1"

    removed = client.delete(f"/api/sessions/{sid}", cookies=cookies)
    assert removed.status_code == 200

    reset = client.post("/api/reset", cookies=cookies)
    assert reset.status_code == 200
    assert reset.json() == []


def test_copy_week_shifts_dates_and_increments_week_label():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)

    squat = client.post(
        "/api/sessions",
        json={"date": "2026-09-15", "title": "Squat", "blockLabel": "Block2", "weekLabel": "Week3"},
        cookies=cookies,
    )
    bench = client.post(
        "/api/sessions",
        json={"date": "2026-09-17", "title": "Bench", "blockLabel": "Block2", "weekLabel": "Week3"},
        cookies=cookies,
    )
    assert squat.status_code == 200
    assert bench.status_code == 200

    copied = client.post(
        "/api/sessions/copy-week",
        json={"sessionIds": [squat.json()["id"], bench.json()["id"]], "dateOffsetDays": 3},
        cookies=cookies,
    )
    assert copied.status_code == 200
    payload = copied.json()
    assert payload["status"] == "success"
    assert len(payload["copied"]) == 2
    dates = sorted(row["date"] for row in payload["copied"])
    assert dates == ["2026-09-18", "2026-09-20"]
    assert all(row["blockLabel"] == "Block2" for row in payload["copied"])
    assert all(row["weekLabel"] == "Week4" for row in payload["copied"])

    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = [w for mc in tree.json() for w in mc["workouts"]]
    assert len(workouts) == 4

    copied_id = payload["copied"][0]["id"]
    relabeled = client.patch(
        f"/api/sessions/{copied_id}",
        json={"blockLabel": "Meet", "weekLabel": "Week1"},
        cookies=cookies,
    )
    assert relabeled.status_code == 200
    assert relabeled.json()["blockLabel"] == "Meet"
    assert relabeled.json()["weekLabel"] == "Week1"
    cleared = client.patch(
        f"/api/sessions/{copied_id}",
        json={"blockLabel": "", "weekLabel": ""},
        cookies=cookies,
    )
    assert cleared.status_code == 200
    assert cleared.json()["blockLabel"] is None
    assert cleared.json()["weekLabel"] is None


def test_plan_sets_persist_typed_weight_and_empty_backoff():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"plan-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)
    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-15", "title": "Squat"},
        cookies=cookies,
    )
    sid = created.json()["id"]
    squat = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Squat", "liftCategory": "Squat"},
        cookies=cookies,
    )
    assert squat.status_code == 200
    eid = squat.json()["id"]
    top_id = squat.json()["sets"][0]["id"]
    saved = client.put(
        f"/api/sessions/{sid}/exercises/{eid}/sets",
        json={
            "sets": [
                {"id": top_id, "plannedWeight": 180, "plannedReps": 5, "plannedRpe": 8, "intensityType": "RPE", "isTop": True},
                {"plannedWeight": None, "plannedReps": 5, "plannedRpe": 8, "intensityType": "PERCENT"},
            ]
        },
        cookies=cookies,
    )
    assert saved.status_code == 200
    rows = saved.json()["sets"]
    assert rows[0]["plannedWeight"] == 180.0
    assert rows[1]["plannedWeight"] is None
    assert rows[1]["intensityType"] == "PERCENT"

    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = [w for mc in tree.json() for w in mc["workouts"]]
    sets = next(ex["sets"] for w in workouts for ex in w["exercises"] if ex["id"] == eid)
    assert sets[0]["plannedWeight"] == 180.0
    assert sets[1]["plannedWeight"] is None


def test_copy_lifts_clears_logs_copy_with_logs_keeps_them():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)
    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-15", "title": "Squat", "blockLabel": "Block2", "weekLabel": "Week3"},
        cookies=cookies,
    )
    sid = created.json()["id"]
    squat = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Squat", "liftCategory": "Squat", "plannedWeight": 180, "plannedReps": 5, "plannedRpe": 8},
        cookies=cookies,
    )
    set_id = squat.json()["sets"][0]["id"]
    logged = client.post(
        "/api/sets/log",
        json={"workoutId": sid, "exerciseId": squat.json()["id"], "setId": set_id, "weight": 182.5, "reps": 5, "rpe": 8.5},
        cookies=cookies,
    )
    assert logged.status_code == 200

    lifts_only = client.post(
        "/api/sessions/copy-week",
        json={"sessionIds": [sid], "dateOffsetDays": 7, "includeLogs": False},
        cookies=cookies,
    )
    with_logs = client.post(
        "/api/sessions/copy-week",
        json={"sessionIds": [sid], "dateOffsetDays": 14, "includeLogs": True},
        cookies=cookies,
    )
    assert lifts_only.status_code == 200
    assert with_logs.status_code == 200

    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = {w["id"]: w for mc in tree.json() for w in mc["workouts"]}
    lifts_copy = workouts[lifts_only.json()["copied"][0]["id"]]
    logs_copy = workouts[with_logs.json()["copied"][0]["id"]]
    assert lifts_copy["exercises"][0]["sets"][0]["plannedWeight"] == 180.0
    assert lifts_copy["exercises"][0]["sets"][0]["actual"] is None
    assert logs_copy["exercises"][0]["sets"][0]["plannedWeight"] == 180.0
    assert logs_copy["exercises"][0]["sets"][0]["actual"] == 182.5
    assert logs_copy["exercises"][0]["sets"][0]["reps"] == 5
    assert logs_copy["exercises"][0]["sets"][0]["executedRpe"] == 8.5


def test_add_lift_to_empty_session():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)

    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-12", "title": "Session"},
        cookies=cookies,
    )
    assert created.status_code == 200
    sid = created.json()["id"]
    assert created.json()["exercises"] == []

    squat = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Squat", "liftCategory": "Squat", "tier": "Comp", "plannedReps": 5, "plannedRpe": 8},
        cookies=cookies,
    )
    assert squat.status_code == 200
    body = squat.json()
    assert body["title"] == "Squat"
    assert body["liftCategory"] == "Squat"
    assert body["tier"] == "Comp"
    assert len(body["sets"]) == 1
    assert body["sets"][0]["plannedReps"] == 5
    assert body["sets"][0]["plannedRpe"] == 8.0
    assert body["sets"][0]["actual"] is None

    done = client.patch(f"/api/sessions/{sid}", json={"status": "COMPLETED"}, cookies=cookies)
    assert done.status_code == 200
    bench = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Bench", "liftCategory": "Bench"},
        cookies=cookies,
    )
    assert bench.status_code == 200

    other = client.post(
        "/api/auth/register",
        json={"email": f"other-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    other_cookies = dict(other.cookies)
    forbidden = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Bench", "liftCategory": "Bench"},
        cookies=other_cookies,
    )
    assert forbidden.status_code == 403

    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = [w for mc in tree.json() for w in mc["workouts"]]
    match = next(w for w in workouts if w["id"] == sid)
    assert len(match["exercises"]) == 2
    assert [e["title"] for e in match["exercises"]] == ["Squat", "Bench"]


def test_remove_lift_from_session():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)

    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-12", "title": "Session"},
        cookies=cookies,
    )
    sid = created.json()["id"]
    squat = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Squat", "liftCategory": "Squat"},
        cookies=cookies,
    )
    bench = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Bench", "liftCategory": "Bench"},
        cookies=cookies,
    )
    assert squat.status_code == 200
    assert bench.status_code == 200
    squat_id = squat.json()["id"]

    removed = client.delete(f"/api/sessions/{sid}/exercises/{squat_id}", cookies=cookies)
    assert removed.status_code == 200

    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = [w for mc in tree.json() for w in mc["workouts"]]
    match = next(w for w in workouts if w["id"] == sid)
    titles = [e["title"] for e in match["exercises"]]
    assert titles == ["Bench"]

    missing = client.delete(f"/api/sessions/{sid}/exercises/{squat_id}", cookies=cookies)
    assert missing.status_code == 404

    done = client.patch(f"/api/sessions/{sid}", json={"status": "COMPLETED"}, cookies=cookies)
    assert done.status_code == 200
    removed_after = client.delete(
        f"/api/sessions/{sid}/exercises/{bench.json()['id']}",
        cookies=cookies,
    )
    assert removed_after.status_code == 200


def test_completed_session_stays_writable():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)

    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-12", "title": "Session"},
        cookies=cookies,
    )
    sid = created.json()["id"]
    client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Squat", "liftCategory": "Squat"},
        cookies=cookies,
    )
    done = client.patch(f"/api/sessions/{sid}", json={"status": "COMPLETED"}, cookies=cookies)
    assert done.status_code == 200
    assert done.json()["status"] == "COMPLETED"

    bench = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Bench", "liftCategory": "Bench"},
        cookies=cookies,
    )
    assert bench.status_code == 200

    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = [w for mc in tree.json() for w in mc["workouts"]]
    match = next(w for w in workouts if w["id"] == sid)
    assert [e["title"] for e in match["exercises"]] == ["Squat", "Bench"]
    assert match["status"] == "COMPLETED"


def test_completed_session_allows_set_writes():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)
    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-12", "title": "Session"},
        cookies=cookies,
    )
    sid = created.json()["id"]
    squat = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Squat", "liftCategory": "Squat"},
        cookies=cookies,
    )
    eid = squat.json()["id"]
    set_id = squat.json()["sets"][0]["id"]
    done = client.patch(f"/api/sessions/{sid}", json={"status": "COMPLETED"}, cookies=cookies)
    assert done.status_code == 200

    logged = client.post(
        "/api/sets/log",
        json={"workoutId": sid, "exerciseId": eid, "setId": set_id, "weight": 180, "reps": 5, "rpe": 8},
        cookies=cookies,
    )
    assert logged.status_code == 200

    replaced = client.put(
        f"/api/sessions/{sid}/exercises/{eid}/sets",
        json={"sets": [{"id": set_id, "label": "Set 1", "plannedWeight": 185, "plannedReps": 5, "plannedRpe": 8}]},
        cookies=cookies,
    )
    assert replaced.status_code == 200
    assert replaced.json()["sets"][0]["plannedWeight"] == 185.0

    other = client.post(
        "/api/sessions",
        json={"date": "2026-09-13", "title": "Open day"},
        cookies=cookies,
    )
    other_id = other.json()["id"]
    hijack = client.post(
        "/api/sets/log",
        json={"workoutId": other_id, "exerciseId": eid, "setId": set_id, "weight": 180, "reps": 5, "rpe": 8},
        cookies=cookies,
    )
    assert hijack.status_code == 404

    completed_sync = client.post(
        f"/api/workouts/{sid}/sync",
        json={
            "schema_version": 1,
            "client_device_id": "dev-lock-test",
            "workout_id": sid,
            "last_updated_at": "2026-09-12T00:00:00Z",
            "changes": [{
                "entity": "ExerciseSet",
                "id": set_id,
                "mutation_id": "mut-completed-1",
                "updated_at": "2026-09-12T00:00:00Z",
                "fields": {"actual": 200, "reps": 5, "executedRpe": 8},
            }],
        },
        cookies=cookies,
    )
    assert completed_sync.status_code == 200
    completed_body = completed_sync.json()
    assert "mut-completed-1" in completed_body.get("accepted_mutation_ids", [])

    mismatch_sync = client.post(
        f"/api/workouts/{other_id}/sync",
        json={
            "schema_version": 1,
            "client_device_id": "dev-lock-test",
            "workout_id": other_id,
            "last_updated_at": "2026-09-12T00:00:00Z",
            "changes": [{
                "entity": "ExerciseSet",
                "id": set_id,
                "mutation_id": "mut-mismatch-1",
                "updated_at": "2026-09-12T00:00:00Z",
                "fields": {"actual": 200, "reps": 5, "executedRpe": 8},
            }],
        },
        cookies=cookies,
    )
    assert mismatch_sync.status_code == 200
    body = mismatch_sync.json()
    assert "mut-mismatch-1" in body.get("rejected_mutations", [])
    assert any(item.get("reason") == "WORKOUT_MISMATCH" for item in body.get("conflicts", []))


def test_reorder_lifts_in_session():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)
    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-12", "title": "Session"},
        cookies=cookies,
    )
    sid = created.json()["id"]
    squat = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Squat", "liftCategory": "Squat"},
        cookies=cookies,
    )
    bench = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Bench", "liftCategory": "Bench"},
        cookies=cookies,
    )
    deadlift = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Deadlift", "liftCategory": "Deadlift"},
        cookies=cookies,
    )
    assert squat.status_code == 200
    assert bench.status_code == 200
    assert deadlift.status_code == 200
    bench_id = bench.json()["id"]

    moved = client.patch(
        f"/api/sessions/{sid}/exercises/{bench_id}",
        json={"move": "up"},
        cookies=cookies,
    )
    assert moved.status_code == 200

    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = [w for mc in tree.json() for w in mc["workouts"]]
    match = next(w for w in workouts if w["id"] == sid)
    assert [e["title"] for e in match["exercises"]] == ["Bench", "Squat", "Deadlift"]

    end = client.patch(
        f"/api/sessions/{sid}/exercises/{bench_id}",
        json={"move": "up"},
        cookies=cookies,
    )
    assert end.status_code == 200
    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = [w for mc in tree.json() for w in mc["workouts"]]
    match = next(w for w in workouts if w["id"] == sid)
    assert [e["title"] for e in match["exercises"]] == ["Bench", "Squat", "Deadlift"]

    done = client.patch(f"/api/sessions/{sid}", json={"status": "COMPLETED"}, cookies=cookies)
    assert done.status_code == 200
    moved_after = client.patch(
        f"/api/sessions/{sid}/exercises/{bench_id}",
        json={"move": "down"},
        cookies=cookies,
    )
    assert moved_after.status_code == 200
    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = [w for mc in tree.json() for w in mc["workouts"]]
    match = next(w for w in workouts if w["id"] == sid)
    assert [e["title"] for e in match["exercises"]] == ["Squat", "Bench", "Deadlift"]


def test_name_lift_variation():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)
    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-12", "title": "Session"},
        cookies=cookies,
    )
    sid = created.json()["id"]
    squat = client.post(
        f"/api/sessions/{sid}/exercises",
        json={"title": "Squat", "liftCategory": "Squat"},
        cookies=cookies,
    )
    eid = squat.json()["id"]
    named = client.patch(
        f"/api/sessions/{sid}/exercises/{eid}",
        json={"variation": "Pause High Bar Squat (3-2-0)", "tier": "Variation"},
        cookies=cookies,
    )
    assert named.status_code == 200
    assert named.json()["variation"] == "Pause High Bar Squat (3-2-0)"
    assert named.json()["tier"] == "Variation"
    assert named.json()["title"] == "Squat"

    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = [w for mc in tree.json() for w in mc["workouts"]]
    match = next(w for w in workouts if w["id"] == sid)
    assert match["exercises"][0]["variation"] == "Pause High Bar Squat (3-2-0)"


def test_athlete_sees_coach_created_session_on_own_id_fetch():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    coach = client.post(
        "/api/auth/register",
        json={"email": f"coach-{suffix}@example.com", "password": "password123", "role": "COACH"},
    )
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    coach_cookies = dict(coach.cookies)
    athlete_cookies = dict(athlete.cookies)
    athlete_id = athlete.json()["user"]["id"]

    code = client.post("/api/auth/coach-code", cookies=coach_cookies).json()["code"]
    linked = client.post("/api/auth/link", json={"code": code}, cookies=athlete_cookies)
    assert linked.status_code == 200

    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-08", "title": "Coach squat", "blockLabel": "Block1", "weekLabel": "Week1", "athleteId": athlete_id},
        cookies=coach_cookies,
    )
    assert created.status_code == 200
    session_id = created.json()["id"]

    own = client.get("/api/microcycles", cookies=athlete_cookies)
    assert own.status_code == 200
    assert session_id in _workout_ids(own.json())

    explicit = client.get(f"/api/microcycles?athlete_id={athlete_id}", cookies=athlete_cookies)
    assert explicit.status_code == 200
    assert session_id in _workout_ids(explicit.json())


def test_sync_mixed_workout_payload_rejects_foreign_entities():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)
    first = client.post("/api/sessions", json={"date": "2026-09-12", "title": "A"}, cookies=cookies).json()
    second = client.post("/api/sessions", json={"date": "2026-09-13", "title": "B"}, cookies=cookies).json()
    squat = client.post(
        f"/api/sessions/{first['id']}/exercises",
        json={"title": "Squat", "liftCategory": "Squat"},
        cookies=cookies,
    ).json()
    bench = client.post(
        f"/api/sessions/{second['id']}/exercises",
        json={"title": "Bench", "liftCategory": "Bench"},
        cookies=cookies,
    ).json()
    squat_set = squat["sets"][0]["id"]
    bench_set = bench["sets"][0]["id"]

    mixed = client.post(
        f"/api/workouts/{second['id']}/sync",
        json={
            "schema_version": 1,
            "client_device_id": "dev-mixed",
            "workout_id": second["id"],
            "last_updated_at": "2026-09-12T00:00:00Z",
            "changes": [
                {
                    "entity": "ExerciseSet",
                    "id": bench_set,
                    "mutation_id": f"mut-own-{suffix}",
                    "updated_at": "2026-09-12T00:00:00Z",
                    "fields": {"actual": 110, "reps": 5, "executedRpe": 8},
                },
                {
                    "entity": "ExerciseSet",
                    "id": squat_set,
                    "mutation_id": f"mut-foreign-{suffix}",
                    "updated_at": "2026-09-12T00:00:00Z",
                    "fields": {"actual": 999, "reps": 1, "executedRpe": 10},
                },
            ],
        },
        cookies=cookies,
    )
    assert mixed.status_code == 200
    body = mixed.json()
    assert f"mut-own-{suffix}" in body.get("accepted_mutation_ids", [])
    assert f"mut-foreign-{suffix}" in body.get("rejected_mutations", [])
    assert any(item.get("reason") == "WORKOUT_MISMATCH" for item in body.get("conflicts", []))

    tree = client.get("/api/microcycles", cookies=cookies)
    workouts = {w["id"]: w for mc in tree.json() for w in mc["workouts"]}
    squat_row = next(e for e in workouts[first["id"]]["exercises"] if e["id"] == squat["id"])
    bench_row = next(e for e in workouts[second["id"]]["exercises"] if e["id"] == bench["id"])
    assert squat_row["sets"][0]["actual"] != 999
    assert bench_row["sets"][0]["actual"] == 110


def test_auth_link_reset_is_not_a_plan_conflict():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    athlete = client.post(
        "/api/auth/register",
        json={"email": f"athlete-{suffix}@example.com", "password": "password123", "role": "ATHLETE"},
    )
    cookies = dict(athlete.cookies)
    created = client.post(
        "/api/sessions",
        json={"date": "2026-09-08", "title": "Keep me"},
        cookies=cookies,
    )
    session_id = created.json()["id"]

    reset = client.post("/api/auth/link/reset", cookies=cookies)
    assert reset.status_code != 409
    tree = client.get("/api/microcycles", cookies=cookies)
    assert tree.status_code == 200
    assert session_id in _workout_ids(tree.json())
