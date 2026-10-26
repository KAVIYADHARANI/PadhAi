"""Tests for study session tracking and companion settings."""

from fastapi.testclient import TestClient


def test_start_study_session_and_course_ownership(
    client: TestClient,
    auth_headers_user1: dict,
    auth_headers_user2: dict,
):
    # 1. Create a course with user 1
    course_res = client.post(
        "/api/courses",
        json={"name": "Biology 101", "goal_days": 30, "hours_per_day": 1.0, "level": "beginner"},
        headers=auth_headers_user1,
    )
    assert course_res.status_code == 201
    course = course_res.json()

    # 2. Successful session creation by user 1
    res = client.post("/api/sessions", json={"course_id": course["id"]}, headers=auth_headers_user1)
    assert res.status_code == 201
    data = res.json()
    assert data["course_id"] == course["id"]
    assert data["pomodoros"] == 0
    assert data["ended_at"] is None

    # 3. Cross-user course protection (user 2 cannot start session on user 1's course)
    res_forbidden = client.post(
        "/api/sessions", json={"course_id": course["id"]}, headers=auth_headers_user2
    )
    assert res_forbidden.status_code == 404


def test_update_study_session_and_record_break_events(
    client: TestClient,
    auth_headers_user1: dict,
):
    # Create course and session
    course_res = client.post(
        "/api/courses",
        json={"name": "Physics", "goal_days": 30, "hours_per_day": 1.0, "level": "beginner"},
        headers=auth_headers_user1,
    )
    course_id = course_res.json()["id"]

    res_start = client.post(
        "/api/sessions", json={"course_id": course_id}, headers=auth_headers_user1
    )
    session_id = res_start.json()["id"]

    # Record break event
    break_payload = {
        "break_type": "pomodoro",
        "outcome": "accepted",
        "cooldown_at_time_s": 900,
    }
    res_break = client.post(
        f"/api/sessions/{session_id}/breaks", json=break_payload, headers=auth_headers_user1
    )
    assert res_break.status_code == 201
    break_data = res_break.json()
    assert break_data["break_type"] == "pomodoro"
    assert break_data["outcome"] == "accepted"

    # Conclude session with aggregates
    update_payload = {
        "pomodoros": 2,
        "focus_avg": 0.88,
        "drowsy_minutes": 2.5,
        "ended": True,
    }
    res_update = client.patch(
        f"/api/sessions/{session_id}", json=update_payload, headers=auth_headers_user1
    )
    assert res_update.status_code == 200
    update_data = res_update.json()
    assert update_data["pomodoros"] == 2
    assert update_data["focus_avg"] == 0.88
    assert update_data["ended_at"] is not None


def test_companion_settings_get_and_patch(
    client: TestClient,
    auth_headers_user1: dict,
):
    # 1. Initial GET creates default settings
    res_get = client.get("/api/buddy/settings", headers=auth_headers_user1)
    assert res_get.status_code == 200
    data = res_get.json()
    assert data["persona_pack"] == "tanglish"
    assert data["address_term"] == "boss"
    assert data["camera_enabled"] is False

    # 2. PATCH updates settings
    patch_payload = {
        "persona_pack": "english",
        "tone_mode": "serious",
        "address_term": "scholar",
        "camera_enabled": True,
    }
    res_patch = client.patch("/api/buddy/settings", json=patch_payload, headers=auth_headers_user1)
    assert res_patch.status_code == 200
    patch_data = res_patch.json()
    assert patch_data["persona_pack"] == "english"
    assert patch_data["tone_mode"] == "serious"
    assert patch_data["address_term"] == "scholar"
    assert patch_data["camera_enabled"] is True
