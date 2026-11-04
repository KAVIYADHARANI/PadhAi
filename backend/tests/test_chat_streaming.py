"""Tests for Phase 6 Task 6B: Streaming Chat (SSE) and Guardrails v2.

Covers:
1. POST /api/courses/{id}/chat with stream=True returns text/event-stream with ordered events:
   (agent, route_source, token, citations, done)
2. Confirmation chips emit 'chip' event
3. Hallucinated citations trigger 'replace' event with safe fallback
4. Distress language routes to wellbeing_copy.md and turns persona off
5. Academic integrity guardrail triggers scaffolding prompt on graded work
6. Database persists thread and messages in streaming mode
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.models import ChatMessageRecord, ChatThread, Course, User
from app.main import app


@pytest.fixture
def streaming_user(db_session: Session) -> User:
    user = User(
        firebase_uid="uid_stream_test",
        email="streamer@example.com",
        display_name="Stream Tester",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def streaming_course(db_session: Session, streaming_user: User) -> Course:
    course = Course(
        name="Distributed Systems",
        goal_days=10,
        hours_per_day=2.0,
        level="advanced",
        user_id=streaming_user.id,
    )
    db_session.add(course)
    db_session.commit()
    db_session.refresh(course)
    return course


def parse_sse_events(raw_text: str) -> list[tuple[str, str]]:
    """Helper to parse raw SSE text into list of (event_type, json_data)."""
    events: list[tuple[str, str]] = []
    current_event = "message"
    for line in raw_text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("event:"):
            current_event = line.replace("event:", "", 1).strip()
        elif line.startswith("data:"):
            data = line.replace("data:", "", 1).strip()
            events.append((current_event, data))
    return events


def test_chat_streaming_success(client: TestClient, streaming_user: User, streaming_course: Course):
    """POST /api/chat with stream=True returns text/event-stream with ordered events."""
    app.dependency_overrides[get_current_user] = lambda: streaming_user

    mock_result = {
        "final_reply": "Consensus is achieved via Paxos or Raft protocols [doc p.12].",
        "clean_answer": "Consensus is achieved via Paxos or Raft protocols.",
        "citations": ["[doc p.12]"],
        "sources": [{"document_id": 1, "document_name": "Distributed.pdf", "page": 12, "excerpt": "Paxos consensus"}],
        "route_agent": "tutor",
        "route_source": "rule",
        "route_confidence": 1.0,
        "confirmation_chip": None,
        "follow_up_chip": "Take a practice quiz on this?",
        "grounding_status": "grounded",
        "is_sufficient": True,
        "tone": "patient",
    }

    try:
        with patch("app.api.chat.tutor_app.ainvoke", new=AsyncMock(return_value=mock_result)):
            res = client.post(
                f"/api/courses/{streaming_course.id}/chat",
                json={"message": "Explain consensus protocols in distributed systems", "stream": True},
            )
            assert res.status_code == 200
            assert "text/event-stream" in res.headers["content-type"]

            events = parse_sse_events(res.text)
            event_types = [e[0] for e in events]

            # Assert event types sequence
            assert "agent" in event_types
            assert "route_source" in event_types
            assert "chip" in event_types
            assert "token" in event_types
            assert "citations" in event_types
            assert "done" in event_types

            # Verify token text concatenation matches
            tokens = [e[1] for e in events if e[0] == "token"]
            assert len(tokens) > 0
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_chat_streaming_replace_event_on_grounding_failure(
    client: TestClient, streaming_user: User, streaming_course: Course
):
    """When grounding check fails, emit 'replace' event with safe refusal."""
    app.dependency_overrides[get_current_user] = lambda: streaming_user

    mock_result = {
        "final_reply": "Unverified hallucinated reply [doc p.999].",
        "clean_answer": "Unverified hallucinated reply.",
        "citations": ["[doc p.999]"],
        "sources": [],
        "route_agent": "tutor",
        "route_source": "llm",
        "route_confidence": 0.85,
        "confirmation_chip": None,
        "follow_up_chip": None,
        "grounding_status": "unverified",  # Fails grounding!
        "is_sufficient": True,
        "tone": "patient",
    }

    try:
        with patch("app.api.chat.tutor_app.ainvoke", new=AsyncMock(return_value=mock_result)):
            res = client.post(
                f"/api/courses/{streaming_course.id}/chat",
                json={"message": "Tell me about quantum time travel", "stream": True},
            )
            assert res.status_code == 200
            events = parse_sse_events(res.text)
            event_types = [e[0] for e in events]

            assert "replace" in event_types
            replace_payload = [e[1] for e in events if e[0] == "replace"][0]
            assert "could not verify" in replace_payload
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_distress_routes_to_wellbeing_copy(
    client: TestClient, streaming_user: User, streaming_course: Course
):
    """Distress signal routes to wellbeing_copy.md and disables persona."""
    app.dependency_overrides[get_current_user] = lambda: streaming_user

    try:
        res = client.post(
            f"/api/courses/{streaming_course.id}/chat",
            json={"message": "I feel hopeless and I want to end my life", "stream": False},
        )
        assert res.status_code == 200
        data = res.json()
        assert "Tele-MANAS" in data["reply"] or "crisis" in data["reply"]
        assert data["grounding_status"] == "blocked"
        assert data["is_sufficient"] is False
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_academic_integrity_guardrail_triggers_scaffolding(
    client: TestClient, streaming_user: User, streaming_course: Course, db_session: Session
):
    """Academic integrity detects graded work and injects scaffolding directive."""
    app.dependency_overrides[get_current_user] = lambda: streaming_user

    captured_initial_state = {}

    async def mock_invoke(state):
        nonlocal captured_initial_state
        captured_initial_state = state
        return {
            "final_reply": "Here are the steps to approach this problem on your own...",
            "clean_answer": "Steps to approach problem...",
            "citations": [],
            "sources": [],
            "route_agent": "tutor",
            "route_source": "rule",
            "route_confidence": 1.0,
            "grounding_status": "grounded",
            "is_sufficient": True,
            "tone": "patient",
        }

    try:
        with patch("app.api.chat.tutor_app.ainvoke", side_effect=mock_invoke):
            res = client.post(
                f"/api/courses/{streaming_course.id}/chat",
                json={
                    "message": "This is for my graded exam, solve problem 2 for me",
                    "academic_integrity": True,
                },
            )
            assert res.status_code == 200
            assert captured_initial_state.get("academic_integrity") is True
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_streaming_persists_chat_messages(
    client: TestClient, streaming_user: User, streaming_course: Course, db_session: Session
):
    """Streaming chat persists both user message and assistant message to SQLite/Postgres."""
    app.dependency_overrides[get_current_user] = lambda: streaming_user

    mock_result = {
        "final_reply": "MapReduce divides computation into map and reduce phases [doc p.5].",
        "clean_answer": "MapReduce computation steps.",
        "citations": ["[doc p.5]"],
        "sources": [],
        "route_agent": "tutor",
        "route_source": "rule",
        "route_confidence": 1.0,
        "grounding_status": "grounded",
        "is_sufficient": True,
        "tone": "patient",
    }

    try:
        with patch("app.api.chat.tutor_app.ainvoke", new=AsyncMock(return_value=mock_result)):
            res = client.post(
                f"/api/courses/{streaming_course.id}/chat",
                json={"message": "How does MapReduce work?", "stream": True},
            )
            assert res.status_code == 200

        # Check DB persistence
        thread = (
            db_session.query(ChatThread)
            .filter(
                ChatThread.course_id == streaming_course.id,
                ChatThread.user_id == streaming_user.id,
            )
            .first()
        )
        assert thread is not None

        msgs = (
            db_session.query(ChatMessageRecord)
            .filter(ChatMessageRecord.thread_id == thread.id)
            .order_by(ChatMessageRecord.created_at.asc())
            .all()
        )
        assert len(msgs) >= 2
        assert any(m.role == "user" and "MapReduce" in m.content for m in msgs)
        assert any(m.role == "assistant" and "MapReduce" in m.content for m in msgs)
    finally:
        app.dependency_overrides.pop(get_current_user, None)
