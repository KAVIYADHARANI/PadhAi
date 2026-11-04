"""Tests for Weekly Recap Generator and API endpoint."""

import pytest
from fastapi.testclient import TestClient

from app.ai.harness.fake import FakeLLM
from app.ai.harness.gateway import LLMGateway
from app.ai.recap.recap_gen import (
    compute_weekly_aggregates,
    deterministic_recap_fallback,
    generate_weekly_recap,
)
from app.db.models import Course, StudySession, User


def test_compute_weekly_aggregates_empty(db_session):
    """Empty sessions and attempts return valid 0-default numeric aggregates."""
    user = User(email="recap_empty@example.com", firebase_uid="uid_recap_empty")
    db_session.add(user)
    db_session.commit()

    course = Course(user_id=user.id, name="Recap Test 1")
    db_session.add(course)
    db_session.commit()

    aggs = compute_weekly_aggregates(course.id, user.id, db_session)
    assert aggs["session_count"] == 0
    assert aggs["total_minutes"] == 0.0
    assert aggs["quizzes_taken"] == 0
    assert aggs["accuracy_pct"] == 0.0


def test_deterministic_recap_fallback():
    """Fallback produces inspiring, guilt-free copy with no LLM."""
    aggs = {
        "session_count": 3,
        "total_minutes": 75.0,
        "avg_focus": 0.88,
        "drowsy_minutes": 4.0,
        "quizzes_taken": 12,
        "accuracy_pct": 83.3,
        "flashcards_reviewed": 15,
        "mastered_topics": 2,
    }
    recap = deterministic_recap_fallback(aggs)
    assert recap.is_fallback is True
    assert "75.0 minutes" in recap.headline
    assert "88%" in recap.focus_highlight
    assert "Pomodoro" not in recap.headline  # Clean copy


@pytest.mark.asyncio
async def test_generate_weekly_recap_with_llm(db_session):
    """LLM gateway correctly structures weekly recap from aggregates."""
    user = User(email="recap_llm@example.com", firebase_uid="uid_recap_llm")
    db_session.add(user)
    db_session.commit()

    course = Course(user_id=user.id, name="Recap Test 2")
    db_session.add(course)
    db_session.commit()

    # Seed study session
    sess = StudySession(
        course_id=course.id,
        user_id=user.id,
        pomodoros=2,
        focus_avg=0.92,
        drowsy_minutes=1.0,
    )
    db_session.add(sess)
    db_session.commit()

    fake = FakeLLM()
    fake.add_response(
        """{
            "headline": "Incredible focus this week!",
            "summary": "You logged 50 minutes of high-quality study. Consistency is paying off.",
            "focus_highlight": "Average focus of 92% shows deep concentration.",
            "next_week_goal": "Keep reviewing due cards to reinforce weak topics."
        }"""
    )
    gateway = LLMGateway(caller=fake.complete, base_backoff_s=0.0)

    recap = await generate_weekly_recap(course.id, user.id, db_session, gateway=gateway)
    assert recap.is_fallback is False
    assert "Incredible focus" in recap.headline
    assert "92%" in recap.focus_highlight


def test_recap_api_cross_user_isolation(client: TestClient, db_session, auth_headers_user1, auth_headers_user2):
    """User 2 cannot access course recap for User 1's course (returns 404)."""
    # 1. Create User 1's course via user 1
    resp_create = client.post(
        "/api/courses",
        headers=auth_headers_user1,
        json={"name": "User 1 Course", "goal_days": 14, "hours_per_day": 1.5, "level": "intermediate"},
    )
    assert resp_create.status_code == 201
    course_id = resp_create.json()["id"]

    # 2. Access as User 2 (authenticated) -> Must return 404
    resp = client.get(
        f"/api/courses/{course_id}/recap",
        headers=auth_headers_user2,
    )
    assert resp.status_code == 404

    # 3. Access as User 1 (authenticated) -> Must return 200
    resp_ok = client.get(
        f"/api/courses/{course_id}/recap",
        headers=auth_headers_user1,
    )
    assert resp_ok.status_code == 200
    assert "headline" in resp_ok.json()
