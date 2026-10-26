"""Unit tests for per-user quotas and sliding-window rate limits.

Implements BUILD_PLAYBOOK.md Phase 8 Task 8B:
- Verifies sliding window rate limits for chat, upload, and Buddy-line endpoints.
- Verifies daily total LLM quota enforcement against USER_DAILY_LLM_CALLS.
- Verifies HTTP 429 responses with Retry-After header and user-facing error copy.
"""

from datetime import UTC, datetime

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.quota import (
    check_daily_llm_quota,
    check_rate_limit,
    reset_rate_limits,
)
from app.db.models import Course, LLMUsage, User


@pytest.fixture(autouse=True)
def clean_rate_limits():
    """Ensure in-memory rate limits are reset between test runs."""
    reset_rate_limits()
    yield
    reset_rate_limits()


def test_sliding_window_rate_limit_allows_under_threshold():
    """Requests below limit succeed without raising exceptions."""
    user_id = 999
    # Limit is 20 for chat, send 5 requests
    for _ in range(5):
        check_rate_limit(user_id, "chat")


def test_sliding_window_rate_limit_blocks_exceeded():
    """Requests exceeding RPM threshold raise HTTP 429 with Retry-After header."""
    user_id = 1001
    limit = settings.RATE_LIMIT_UPLOAD_RPM  # Default 5

    for _ in range(limit):
        check_rate_limit(user_id, "upload")

    # The next request must raise 429
    with pytest.raises(HTTPException) as exc_info:
        check_rate_limit(user_id, "upload")

    assert exc_info.value.status_code == 429
    assert "Rate limit exceeded for document uploads" in exc_info.value.detail
    assert "Retry-After" in exc_info.value.headers
    retry_after = int(exc_info.value.headers["Retry-After"])
    assert 1 <= retry_after <= 60


def test_daily_llm_quota_allows_within_budget(db_session):
    """Users with call count below USER_DAILY_LLM_CALLS proceed without error."""
    user = User(email="quota_ok@example.com", firebase_uid="uid_quota_ok")
    db_session.add(user)
    db_session.commit()

    today_utc = datetime.now(UTC).date()
    usage = LLMUsage(
        user_id=user.id,
        day=today_utc,
        provider="groq",
        model="llama-3.1-8b-instant",
        calls=10,
    )
    db_session.add(usage)
    db_session.commit()

    # Must not raise
    check_daily_llm_quota(db_session, user.id)


def test_daily_llm_quota_blocks_at_limit(db_session):
    """Users hitting USER_DAILY_LLM_CALLS receive 429 with reset time until midnight UTC."""
    user = User(email="quota_max@example.com", firebase_uid="uid_quota_max")
    db_session.add(user)
    db_session.commit()

    today_utc = datetime.now(UTC).date()
    usage = LLMUsage(
        user_id=user.id,
        day=today_utc,
        provider="groq",
        model="llama-3.1-8b-instant",
        calls=settings.USER_DAILY_LLM_CALLS,
    )
    db_session.add(usage)
    db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        check_daily_llm_quota(db_session, user.id)

    assert exc_info.value.status_code == 429
    assert f"Daily AI study assistant quota reached ({settings.USER_DAILY_LLM_CALLS} calls/day)" in exc_info.value.detail
    assert "Retry-After" in exc_info.value.headers
    retry_after = int(exc_info.value.headers["Retry-After"])
    assert retry_after > 0


def test_buddy_line_rate_limit_endpoint(client: TestClient, db_session):
    """GET /api/buddy/line enforces per-user rate limit."""
    user = User(email="buddy_rate@example.com", firebase_uid="firebase_uid_1")
    db_session.add(user)
    db_session.commit()

    headers = {"Authorization": "Bearer token_user_1"}

    # Rapidly call up to limit
    limit = settings.RATE_LIMIT_BUDDY_RPM
    for _ in range(limit):
        res = client.get("/api/buddy/line", headers=headers)
        assert res.status_code == 200

    # Limit exceeded call
    res_exceeded = client.get("/api/buddy/line", headers=headers)
    assert res_exceeded.status_code == 429
    assert "Rate limit exceeded" in res_exceeded.json()["detail"]
    assert "retry-after" in res_exceeded.headers


def test_chat_daily_quota_endpoint(client: TestClient, db_session):
    """POST /api/courses/{id}/chat returns 429 when user daily quota is exhausted."""
    user = User(email="chat_quota@example.com", firebase_uid="firebase_uid_1")
    db_session.add(user)
    db_session.commit()

    course = Course(user_id=user.id, name="Quota Test Course", goal_days=5)
    db_session.add(course)
    db_session.commit()

    # Exhaust quota
    usage = LLMUsage(
        user_id=user.id,
        day=datetime.now(UTC).date(),
        provider="groq",
        model="llama",
        calls=settings.USER_DAILY_LLM_CALLS + 1,
    )
    db_session.add(usage)
    db_session.commit()

    res = client.post(
        f"/api/courses/{course.id}/chat",
        json={"message": "Hello tutor!"},
        headers={"Authorization": "Bearer token_user_1"},
    )
    assert res.status_code == 429
    assert "Daily AI study assistant quota reached" in res.json()["detail"]
